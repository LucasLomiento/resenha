import { SELF, abortAllDurableObjects, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { dmChannelId } from '../../shared/protocol'
import { hashPassword, hashToken, randomToken, toBase64Url } from '../src/auth'
import { newId } from '../src/ids'
import { BASE, api, guildSocket, homeSocket, legacySocket, post } from './helpers'

// O banco do "main" exatamente como a 0.5 deixou (é o que está em produção).
const LEGACY_SCHEMA = [
  `CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT NOT NULL,
   pass_salt TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  'CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL)',
  `CREATE TABLE invites (code TEXT PRIMARY KEY, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, used_by TEXT,
   used_at INTEGER)`,
  `CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('text', 'voice')),
   position INTEGER NOT NULL)`,
  `CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author_id TEXT NOT NULL, content TEXT NOT NULL,
   created_at INTEGER NOT NULL, edited_at INTEGER)`,
  'CREATE INDEX messages_by_channel ON messages (channel_id, id)',
  `CREATE TABLE attachments (id TEXT PRIMARY KEY, message_id TEXT, uploader_id TEXT NOT NULL, name TEXT NOT NULL,
   size INTEGER NOT NULL, type TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  'CREATE INDEX attachments_by_message ON attachments (message_id)',
  'CREATE TABLE file_chunks (file_id TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (file_id, seq))',
]

const encoder = new TextEncoder()

/** Assinatura de link no formato da 0.5 (`<id>:<exp>`). */
async function legacyUrl(id: string, name: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.FILE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}:${exp}`))))
  return `/api/files/${id}/${encodeURIComponent(name)}?exp=${exp}&sig=${sig}`
}

async function seedLegacy() {
  const now = Date.now()
  const lucas = { id: newId(), name: 'Lucas', token: randomToken() }
  const duarte = { id: newId(), name: 'Duarte Zé', token: randomToken() }
  const pass = await hashPassword('senha123') // a 0.5 aceitava senha de 6+
  const general = newId()
  const voice = newId()
  const dm = dmChannelId(lucas.id, duarte.id)
  const photo = { id: randomToken(12), bytes: new Uint8Array(1500).map((_, i) => i % 256), name: 'foto.png' }
  const dmFile = { id: randomToken(12), bytes: new Uint8Array(2 * 1024 * 1024 + 3).map((_, i) => (i * 7) % 256), name: 'video.mp4' }
  const messages = [
    { id: newId(), channel: general, author: lucas.id, content: 'Bora tomar um café?' },
    { id: newId(), channel: general, author: duarte.id, content: 'bora' },
    { id: newId(), channel: general, author: lucas.id, content: '' },
    { id: newId(), channel: dm, author: lucas.id, content: 'segredo nosso' },
    { id: newId(), channel: dm, author: duarte.id, content: 'olha o vídeo' },
  ]

  const stub = env.GUILD.get(env.GUILD.idFromName('main'))
  await runInDurableObject(stub, async (_, state) => {
    await state.storage.deleteAll()
    const sql = state.storage.sql
    for (const q of LEGACY_SCHEMA) sql.exec(q)
    sql.exec('INSERT INTO users VALUES (?, ?, ?, ?, 1, ?)', lucas.id, lucas.name, pass.hash, pass.salt, now - 5000)
    sql.exec('INSERT INTO users VALUES (?, ?, ?, ?, 0, ?)', duarte.id, duarte.name, pass.hash, pass.salt, now - 4000)
    sql.exec('INSERT INTO sessions VALUES (?, ?, ?)', await hashToken(lucas.token), lucas.id, now - 3000)
    sql.exec('INSERT INTO sessions VALUES (?, ?, ?)', await hashToken(duarte.token), duarte.id, now - 3000)
    sql.exec('INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)', 'velho123', lucas.id, now - 1000)
    sql.exec("INSERT INTO channels VALUES (?, 'geral', 'text', 0)", general)
    sql.exec("INSERT INTO channels VALUES (?, 'Resenha', 'voice', 1)", voice)
    for (const m of messages) {
      sql.exec('INSERT INTO messages VALUES (?, ?, ?, ?, ?, NULL)', m.id, m.channel, m.author, m.content, now - 2000)
    }
    const attach = (file: typeof photo, messageId: string, uploader: string, type: string) => {
      sql.exec('INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?, ?)', file.id, messageId, uploader, file.name, file.bytes.length, type, now - 2000)
      for (let seq = 0; seq * 1024 * 1024 < file.bytes.length; seq++) {
        sql.exec('INSERT INTO file_chunks VALUES (?, ?, ?)', file.id, seq, file.bytes.slice(seq * 1024 * 1024, (seq + 1) * 1024 * 1024).buffer)
      }
    }
    attach(photo, messages[2].id, lucas.id, 'image/png')
    attach(dmFile, messages[4].id, duarte.id, 'video/mp4')
  })
  // O Guild sobe de novo, agora em cima do banco antigo (como no deploy).
  await abortAllDurableObjects()
  return { lucas, duarte, general, voice, dm, photo, dmFile, messages }
}

async function finishDmMigration() {
  const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'))
  for (let i = 0; i < 10; i++) {
    await runDurableObjectAlarm(dir)
    const state = await runInDurableObject(dir, (_, s) =>
      s.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'legacy'").one().value,
    )
    if (state === 'done') return
  }
  throw new Error('a migração das conversas não terminou')
}

describe('migração da 0.5', () => {
  it('ninguém precisa entrar de novo e o app 0.5 continua funcionando', async () => {
    const { lucas, duarte, general, photo, dm } = await seedLegacy()
    expect((await api('/api/status')).body).toMatchObject({ needsInvite: true, signup: 'invite' })

    const old = await legacySocket(lucas.token)
    const ready = await old.next('ready')
    expect(ready.me).toMatchObject({ id: lucas.id, name: 'Lucas', admin: true })
    expect(ready.users.find((u) => u.id === duarte.id)).toMatchObject({ name: 'Duarte Zé', admin: false, username: 'duarte_ze' })
    expect(ready.channels.map((c) => [c.name, c.kind])).toEqual([
      ['geral', 'text'],
      ['Resenha', 'voice'],
    ])

    old.send({ t: 'chat.history', reqId: 'h', channelId: general })
    const history = await old.next('chat.history')
    expect(history.messages.map((m) => m.content)).toEqual(['Bora tomar um café?', 'bora', ''])
    const file = history.messages[2].attachments[0]
    expect(file.url).toMatch(/^\/api\/g\/main\/files\//)
    expect(new Uint8Array(await (await SELF.fetch(BASE + file.url)).arrayBuffer())).toEqual(photo.bytes)
    // Link no formato antigo (que o app 0.5 tem guardado) ainda abre.
    const legacy = await SELF.fetch(BASE + (await legacyUrl(photo.id, photo.name)))
    expect(legacy.status).toBe(200)

    // Mensagem nova chega pro app antigo; DM pede pra atualizar.
    const fresh = await legacySocket(duarte.token)
    await fresh.next('ready')
    fresh.send({ t: 'chat.send', channelId: general, content: 'cheguei', attachmentIds: [], nonce: 'n' })
    expect((await old.next('chat.message')).message.content).toBe('cheguei')
    old.send({ t: 'chat.send', channelId: dm, content: 'oi', attachmentIds: [], nonce: 'd' })
    expect((await old.next('error')).message).toMatch(/Atualize o app/)

    // Convite pelo app antigo e cadastro no formato antigo.
    old.send({ t: 'invite.create' })
    const { code } = await old.next('invite.created')
    const signup = await post('/api/register', { name: 'Novo Amigo', password: 'senha-forte-1', invite: code })
    expect(signup.status).toBe(200)
    expect(signup.body.user.username).toBe('novo_amigo')
    expect((await old.next('user.upsert')).user.name).toBe('Novo Amigo')
    // Convite antigo que ainda não tinha sido usado continua valendo.
    expect((await post('/api/register', { name: 'Outro', password: 'senha-forte-1', invite: 'velho123' })).status).toBe(200)
  })

  it('o app 0.5 reconectando primeiro, logo depois do deploy, também entra', async () => {
    const { lucas, duarte, general } = await seedLegacy()
    // Nada antes: quem acorda primeiro é o "main", e a autenticação acorda o cadastro central no meio.
    const [a, b] = await Promise.all([legacySocket(lucas.token), legacySocket(duarte.token)])
    expect((await a.next('ready')).me.id).toBe(lucas.id)
    expect((await b.next('ready')).me.id).toBe(duarte.id)
    a.send({ t: 'chat.history', reqId: 'h', channelId: general })
    expect((await a.next('chat.history')).messages.map((m) => m.content)).toEqual(['Bora tomar um café?', 'bora', ''])
  })

  it('entra com o apelido antigo ou com o nome de usuário novo', async () => {
    await seedLegacy()
    expect((await post('/api/login', { name: 'Duarte Zé', password: 'senha123' })).status).toBe(200)
    expect((await post('/api/login', { name: 'duarte zé', password: 'senha123' })).status).toBe(200)
    expect((await post('/api/login', { username: 'duarte_ze', password: 'senha123' })).status).toBe(200)
    expect((await post('/api/login', { username: 'lucas', password: 'senha123' })).status).toBe(200)
    expect((await post('/api/login', { username: 'lucas', password: 'errada-123' })).status).toBe(401)
  })

  it('o grupo vira o primeiro servidor, com tudo lido e busca funcionando', async () => {
    const { lucas, duarte, general } = await seedLegacy()
    const home = await homeSocket(lucas.id, lucas.token)
    const ready = await home.next('ready')
    expect(ready.me).toMatchObject({ username: 'lucas', staff: true })
    expect(ready.guilds).toEqual([{ id: 'main', name: 'Resenha', icon: null, ownerId: lucas.id }])

    const s = await guildSocket('main', duarte.token)
    const g = await s.next('ready')
    expect(g.members?.map((m) => m.userId).sort()).toEqual([lucas.id, duarte.id].sort())
    const read = g.readStates?.find((r) => r.channelId === general)
    expect(read?.lastReadId).toBe(g.lastMessageIds?.[general])
    s.send({ t: 'chat.search', reqId: 's', query: 'cafe' })
    expect((await s.next('chat.search')).messages.map((m) => m.content)).toEqual(['Bora tomar um café?'])
    // A tabela nova de canais aceita categoria.
    const owner = await guildSocket('main', lucas.token)
    await owner.next('ready')
    owner.send({ t: 'channel.create', name: 'Papo', kind: 'category' })
    expect((await s.next('channel.upsert')).channel.kind).toBe('category')
  })

  it('as conversas privadas mudam de lugar com os arquivos', async () => {
    const { lucas, duarte, dm, dmFile, messages } = await seedLegacy()
    await api('/api/status') // sobe o Directory (migra as contas)
    await finishDmMigration()

    const home = await homeSocket(duarte.id, duarte.token)
    const ready = await home.next('ready')
    expect(ready.dms).toEqual([
      expect.objectContaining({ id: dm, user: expect.objectContaining({ id: lucas.id }), lastMessageId: messages[4].id, unread: 0 }),
    ])
    home.send({ t: 'dm.history', reqId: 'h', channelId: dm })
    const history = await home.next('dm.history')
    expect(history.messages.map((m) => m.content)).toEqual(['segredo nosso', 'olha o vídeo'])
    const file = history.messages[1].attachments[0]
    expect(file.url).toMatch(/^\/api\/c\//)
    expect(new Uint8Array(await (await SELF.fetch(BASE + file.url)).arrayBuffer())).toEqual(dmFile.bytes)

    // O "main" não guarda mais a conversa.
    const left = await runInDurableObject(env.GUILD.get(env.GUILD.idFromName('main')), (_, state) =>
      state.storage.sql.exec("SELECT COUNT(*) AS n FROM messages WHERE channel_id LIKE 'dm:%'").one().n,
    )
    expect(left).toBe(0)

    // E a conversa continua: mensagem nova chega pros dois.
    const other = await homeSocket(lucas.id, lucas.token)
    await other.next('ready')
    home.send({ t: 'dm.send', channelId: dm, content: 'migrou!', attachmentIds: [], nonce: 'm' })
    expect((await other.next('dm.message')).message.content).toBe('migrou!')
  })
})
