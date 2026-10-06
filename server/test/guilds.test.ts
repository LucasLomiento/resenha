import { SELF, env, evictAllDurableObjects, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, P, type Channel } from '../../shared/protocol'
import {
  BASE,
  PASSWORD,
  api,
  call,
  createGuild,
  guildSocket,
  homeSocket,
  invite,
  post,
  signup,
  tick,
  upload,
  world,
} from './helpers'

describe('servidores', () => {
  it('servidor novo vem com categorias, canais e o cargo @everyone', async () => {
    const owner = await signup('lucas')
    const home = await homeSocket(owner.user.id, owner.token)
    const homeReady = await home.next('ready')
    expect(homeReady.guilds).toEqual([])

    const guild = await createGuild(owner.token, 'Turma do Fundão')
    expect((await home.next('guild.joined')).guild).toEqual(guild)
    const s = await guildSocket(guild.id, owner.token)
    const ready = await s.next('ready')
    expect(ready.guild).toEqual(guild)
    expect(ready.channels.map((c) => [c.kind, c.name])).toEqual(
      expect.arrayContaining([
        ['category', 'Canais de texto'],
        ['category', 'Canais de voz'],
        ['text', 'geral'],
        ['voice', 'Geral'],
      ]),
    )
    expect(ready.roles).toEqual([expect.objectContaining({ id: guild.id, name: '@everyone', permissions: DEFAULT_PERMISSIONS })])
    expect(Object.values(ready.permissions!).every((p) => p === ALL_PERMISSIONS)).toBe(true)
    expect(ready.me.admin).toBe(true)
  })

  it('convite: prévia, limite de usos e quem entra aparece pra todo mundo', async () => {
    const owner = await signup('lucas')
    const guild = await createGuild(owner.token, 'Turma')
    const a = await guildSocket(guild.id, owner.token)
    await a.next('ready')
    a.send({ t: 'invite.create', maxAge: 3600, maxUses: 1 })
    const { code, invite: info } = await a.next('invite.created')
    expect(info).toMatchObject({ guildId: guild.id, maxUses: 1, uses: 0 })

    const preview = await api(`/api/invites/${code}`)
    expect(preview.body).toMatchObject({ code, guild: { name: 'Turma' }, memberCount: 1, inviter: { username: 'lucas' } })

    const friend = await signup('duarte', code)
    const joined = await a.next('member.upsert')
    expect(joined.user.username).toBe('duarte')
    expect((await post('/api/register', { username: 'terceiro', password: PASSWORD, invite: code })).status).toBe(403)
    expect((await api(`/api/invites/${code}`)).status).toBe(404)

    // Quem já tem conta entra com outro convite.
    const other = await signup('zeca', await invite(a))
    const second = await createGuild(other.token, 'Outro')
    const z = await guildSocket(second.id, other.token)
    await z.next('ready')
    const code2 = await invite(z)
    const home = await homeSocket(friend.user.id, friend.token)
    await home.next('ready')
    expect((await post(`/api/invites/${code2}`, {}, friend.token)).status).toBe(200)
    expect((await home.next('guild.joined')).guild.name).toBe('Outro')
  })

  it('quem saiu do servidor não conecta mais; servidor inexistente dá 404', async () => {
    const { friend, guild, b } = await world()
    const res = await SELF.fetch(`${BASE}/api/g/naoexiste/ws`, { headers: { Upgrade: 'websocket' } })
    expect(res.status).toBe(404)
    expect((await post(`/api/guilds/${guild.id}/leave`, {}, friend.token)).status).toBe(200)
    expect(await b.closed()).toBe(4003)
    const s = await guildSocket(guild.id, friend.token)
    expect(await s.closed()).toBe(4003)
  })

  it('dono não sai sem transferir; transferir passa a coroa', async () => {
    const { owner, friend, guild, a, b } = await world()
    expect((await post(`/api/guilds/${guild.id}/leave`, {}, owner.token)).status).toBe(409)
    b.send({ t: 'guild.transfer', userId: owner.user.id })
    expect((await b.next('error')).message).toMatch(/Só o dono/)
    a.send({ t: 'guild.transfer', userId: friend.user.id })
    expect((await b.next('guild.updated')).guild.ownerId).toBe(friend.user.id)
    expect((await post(`/api/guilds/${guild.id}/leave`, {}, owner.token)).status).toBe(200)
    expect((await b.next('member.removed')).userId).toBe(owner.user.id)
  })

  it('excluir o servidor pede o nome e tira todo mundo', async () => {
    const { owner, friend, guild, b } = await world()
    const home = await homeSocket(friend.user.id, friend.token)
    await home.next('ready')
    expect((await post(`/api/guilds/${guild.id}/delete`, { name: 'errado' }, owner.token)).status).toBe(400)
    expect((await post(`/api/guilds/${guild.id}/delete`, { name: guild.name }, friend.token)).status).toBe(403)
    expect((await post(`/api/guilds/${guild.id}/delete`, { name: guild.name }, owner.token)).status).toBe(200)
    expect(await b.closed()).toBe(4004)
    expect(await home.next('guild.left')).toMatchObject({ guildId: guild.id, reason: 'deleted' })
    const res = await SELF.fetch(`${BASE}/api/g/${guild.id}/ws`, { headers: { Upgrade: 'websocket' } })
    expect(res.status).toBe(404)
  })

  it('editar o nome avisa o servidor e a tela inicial de cada um', async () => {
    const { friend, a, b } = await world()
    const home = await homeSocket(friend.user.id, friend.token)
    await home.next('ready')
    a.send({ t: 'guild.update', name: 'Novo Nome' })
    expect((await b.next('guild.updated')).guild.name).toBe('Novo Nome')
    expect((await home.next('guild.updated')).guild.name).toBe('Novo Nome')
    b.send({ t: 'guild.update', name: 'Hack' })
    expect((await b.next('error')).message).toMatch(/não pode editar/)
  })
})

describe('canais', () => {
  it('cria categoria e canal dentro, reordena e apaga categoria sem perder os canais', async () => {
    const { a, b } = await world()
    a.send({ t: 'channel.create', name: 'Jogos', kind: 'category' })
    const category = (await b.next('channel.upsert', (m) => m.channel.kind === 'category')).channel
    a.send({ t: 'channel.create', name: 'valorant', kind: 'text', parentId: category.id })
    const child = (await b.next('channel.upsert', (m) => m.channel.name === 'valorant')).channel
    expect(child.parentId).toBe(category.id)

    a.send({ t: 'channel.reorder', order: [{ id: child.id, position: 5, parentId: null }] })
    const reordered = await b.next('channels.reordered')
    expect(reordered.channels.find((c) => c.id === child.id)).toMatchObject({ position: 5, parentId: null })

    a.send({ t: 'channel.update', id: child.id, parentId: category.id, topic: 'só FPS', slowmode: 10 })
    expect((await b.next('channel.upsert', (m) => m.channel.id === child.id)).channel).toMatchObject({ topic: 'só FPS', slowmode: 10 })

    a.send({ t: 'channel.delete', id: category.id })
    await b.next('channel.removed', (m) => m.id === category.id)
    const after = await b.next('channels.reordered')
    expect(after.channels.find((c) => c.id === child.id)?.parentId).toBeNull()

    b.send({ t: 'channel.create', name: 'hack', kind: 'text' })
    expect((await b.next('error')).message).toMatch(/não pode criar/)
  })

  it('não apaga o último canal de texto', async () => {
    const { a, text } = await world()
    a.send({ t: 'channel.delete', id: text.id })
    expect((await a.next('error')).message).toMatch(/pelo menos um canal de texto/)
  })

  it('canal privado: só quem tem o cargo vê, e o cargo novo libera na hora', async () => {
    const { guild, friend, a, b } = await world()
    a.send({ t: 'role.create', name: 'VIP' })
    const role = (await b.next('roles')).roles.find((r) => r.name === 'VIP')!
    a.send({
      t: 'channel.create',
      name: 'segredo',
      kind: 'text',
      overwrites: [
        { id: guild.id, type: 'role', allow: 0, deny: P.VIEW_CHANNEL },
        { id: role.id, type: 'role', allow: P.VIEW_CHANNEL, deny: 0 },
      ],
    })
    const secret = (await a.next('channel.upsert', (m) => m.channel.name === 'segredo')).channel
    await b.nothing('channel.upsert', (m) => (m as any).channel?.name === 'segredo')

    a.send({ t: 'chat.send', channelId: secret.id, content: 'só pra VIP', attachmentIds: [], nonce: 'x' })
    await a.next('chat.message')
    await b.nothing('chat.message')
    b.send({ t: 'chat.history', reqId: 'h', channelId: secret.id })
    await b.nothing('chat.history')

    a.send({ t: 'member.roles', userId: friend.user.id, roles: [role.id] })
    expect((await b.next('channel.upsert', (m) => m.channel.id === secret.id)).channel.name).toBe('segredo')
    const perms = await b.next('permissions')
    expect(perms.permissions[secret.id] & P.VIEW_CHANNEL).toBeTruthy()
    b.send({ t: 'chat.history', reqId: 'h2', channelId: secret.id })
    expect((await b.next('chat.history')).messages.map((m) => m.content)).toEqual(['só pra VIP'])

    a.send({ t: 'member.roles', userId: friend.user.id, roles: [] })
    expect((await b.next('channel.removed')).id).toBe(secret.id)
  })

  it('modo lento segura quem manda rápido (moderador passa)', async () => {
    const { a, b, text } = await world()
    a.send({ t: 'channel.update', id: text.id, slowmode: 30 })
    await b.next('channel.upsert')
    b.send({ t: 'chat.send', channelId: text.id, content: 'um', attachmentIds: [], nonce: '1' })
    await b.next('chat.message')
    b.send({ t: 'chat.send', channelId: text.id, content: 'dois', attachmentIds: [], nonce: '2' })
    expect((await b.next('error')).message).toMatch(/Modo lento/)
    a.send({ t: 'chat.send', channelId: text.id, content: 'eu posso', attachmentIds: [], nonce: '3' })
    a.send({ t: 'chat.send', channelId: text.id, content: 'de novo', attachmentIds: [], nonce: '4' })
    await b.next('chat.message', (m) => m.message.content === 'de novo')
  })
})

describe('cargos e moderação', () => {
  it('hierarquia: moderador não mexe em quem está acima nem dá permissão que não tem', async () => {
    const { owner, friend, a, b, guild } = await world()
    const third = await signup('zeca', await invite(a))
    a.send({ t: 'role.create', name: 'Mod' })
    const mod = (await a.next('roles')).roles.find((r) => r.name === 'Mod')!
    a.send({ t: 'role.update', id: mod.id, permissions: P.KICK_MEMBERS | P.MANAGE_ROLES | P.MANAGE_MESSAGES })
    await a.next('roles')
    a.send({ t: 'member.roles', userId: friend.user.id, roles: [mod.id] })
    await b.next('member.upsert', (m) => m.member.roles.includes(mod.id))

    // Não expulsa o dono, não dá ADMINISTRATOR, não cria cargo acima do próprio.
    b.send({ t: 'member.kick', userId: owner.user.id, reason: '' })
    expect((await b.next('error')).message).toMatch(/acima de você/)
    b.send({ t: 'role.update', id: guild.id, permissions: DEFAULT_PERMISSIONS | P.ADMINISTRATOR })
    expect((await b.next('error')).message).toMatch(/permissões que você tem|administrador/)
    b.send({ t: 'role.update', id: mod.id, name: 'Deus' })
    expect((await b.next('error')).message).toMatch(/abaixo do seu/)

    // Expulsa quem está abaixo.
    const z = await guildSocket(guild.id, third.token)
    await z.next('ready')
    const zHome = await homeSocket(third.user.id, third.token)
    await zHome.next('ready')
    b.send({ t: 'member.kick', userId: third.user.id, reason: 'spam' })
    expect(await z.closed()).toBe(4003)
    expect(await zHome.next('guild.left')).toMatchObject({ guildId: guild.id, reason: 'kicked' })
    expect((await a.next('member.removed', (m) => m.userId === third.user.id)).userId).toBe(third.user.id)

    a.send({ t: 'audit.list', reqId: 'a' })
    const audit = await a.next('audit.list')
    expect(audit.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['member.kick', 'member.roles', 'role.create']))
    b.send({ t: 'audit.list', reqId: 'b' })
    await b.nothing('audit.list')
  })

  it('banido sai e não volta com convite novo; desbanir libera', async () => {
    const { owner, friend, a, guild } = await world()
    a.send({ t: 'member.ban', userId: friend.user.id, reason: 'chato', deleteMessages: false })
    await a.next('member.removed')
    const code = await invite(a)
    const join = await post(`/api/invites/${code}`, {}, friend.token)
    expect(join.status).toBe(403)
    a.send({ t: 'bans.list', reqId: 'b' })
    expect((await a.next('bans.list')).bans[0]).toMatchObject({ userId: friend.user.id, reason: 'chato', actorId: owner.user.id })
    a.send({ t: 'member.unban', userId: friend.user.id })
    await tick()
    expect((await post(`/api/invites/${code}`, {}, friend.token)).status).toBe(200)
    const back = await guildSocket(guild.id, friend.token)
    await back.next('ready')
  })

  it('banir pode apagar as mensagens recentes da pessoa', async () => {
    const { friend, a, b, text } = await world()
    b.send({ t: 'chat.send', channelId: text.id, content: 'spam 1', attachmentIds: [], nonce: '1' })
    b.send({ t: 'chat.send', channelId: text.id, content: 'spam 2', attachmentIds: [], nonce: '2' })
    await a.next('chat.message', (m) => m.message.content === 'spam 2')
    a.send({ t: 'member.ban', userId: friend.user.id, reason: '', deleteMessages: true })
    await a.next('chat.deleted')
    await a.next('chat.deleted')
    a.send({ t: 'chat.history', reqId: 'h', channelId: text.id })
    expect((await a.next('chat.history')).messages).toEqual([])
  })

  it('castigo: não escreve, não entra em call, e volta quando tira', async () => {
    const { friend, a, b, text, voice } = await world()
    a.send({ t: 'member.timeout', userId: friend.user.id, minutes: 10, reason: 'calma' })
    const upsert = await b.next('member.upsert', (m) => m.member.timeoutUntil !== null)
    expect(upsert.member.timeoutUntil).toBeGreaterThan(Date.now())
    const perms = await b.next('permissions')
    expect(perms.permissions[text.id]).toBe(P.VIEW_CHANNEL | P.READ_HISTORY)

    b.send({ t: 'chat.send', channelId: text.id, content: 'oi', attachmentIds: [], nonce: '1' })
    expect((await b.next('error')).message).toMatch(/castigo/)
    b.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    expect((await b.next('error')).message).toMatch(/castigo/)

    a.send({ t: 'member.timeout', userId: friend.user.id, minutes: 0, reason: '' })
    await b.next('member.upsert', (m) => m.member.timeoutUntil === null)
    b.send({ t: 'chat.send', channelId: text.id, content: 'voltei', attachmentIds: [], nonce: '2' })
    await a.next('chat.message', (m) => m.message.content === 'voltei')
  })

  it('apelido: cada um muda o seu; o dos outros só com permissão', async () => {
    const { owner, friend, a, b } = await world()
    b.send({ t: 'member.nick', userId: friend.user.id, nick: 'Dudu' })
    expect((await a.next('member.upsert', (m) => m.member.nick === 'Dudu')).member.userId).toBe(friend.user.id)
    b.send({ t: 'member.nick', userId: owner.user.id, nick: 'Chefe' })
    expect((await b.next('error')).message).toMatch(/não pode mudar/)
    a.send({ t: 'member.nick', userId: friend.user.id, nick: null })
    await b.next('member.upsert', (m) => m.member.nick === null)
  })
})

describe('mensagens', () => {
  it('responder, mencionar, contar menção não lida e marcar como lido', async () => {
    const { owner, friend, guild, a, b, text } = await world()
    a.send({ t: 'chat.send', channelId: text.id, content: 'primeira', attachmentIds: [], nonce: '1' })
    const first = (await b.next('chat.message')).message
    a.send({ t: 'chat.send', channelId: text.id, content: `ei <@${friend.user.id}>`, attachmentIds: [], nonce: '2' })
    const mention = (await b.next('chat.message')).message
    expect(mention.mentions).toEqual([friend.user.id])

    b.send({ t: 'chat.send', channelId: text.id, content: 'respondendo', attachmentIds: [], nonce: '3', replyTo: first.id })
    const reply = (await a.next('chat.message', (m) => m.message.content === 'respondendo')).message
    expect(reply.replyTo).toEqual({ id: first.id, authorId: owner.user.id, content: 'primeira' })
    expect(reply.mentions).toEqual([owner.user.id])

    // Reconectando, a menção ainda está lá; depois de ler, some.
    const again = await guildSocket(guild.id, friend.token)
    const ready = await again.next('ready')
    expect(ready.readStates?.find((r) => r.channelId === text.id)?.mentions).toBe(0) // ela respondeu: leu até ali
    a.send({ t: 'chat.send', channelId: text.id, content: `de novo <@${friend.user.id}>`, attachmentIds: [], nonce: '4' })
    const newer = (await again.next('chat.message', (m) => m.message.content.startsWith('de novo'))).message
    const third = await guildSocket(guild.id, friend.token)
    const ready3 = await third.next('ready')
    expect(ready3.readStates?.find((r) => r.channelId === text.id)?.mentions).toBe(1)
    expect(ready3.lastMessageIds?.[text.id]).toBe(newer.id)
    third.send({ t: 'chat.ack', channelId: text.id, messageId: newer.id })
    expect((await again.next('read.state')).state).toEqual({ channelId: text.id, lastReadId: newer.id, mentions: 0 })
  })

  it('@everyone só pra quem tem permissão', async () => {
    const { a, b, text } = await world()
    b.send({ t: 'chat.send', channelId: text.id, content: '@everyone olha', attachmentIds: [], nonce: '1' })
    expect((await a.next('chat.message')).message.mentionEveryone).toBe(false)
    a.send({ t: 'chat.send', channelId: text.id, content: '@everyone reunião', attachmentIds: [], nonce: '2' })
    expect((await b.next('chat.message', (m) => m.message.content.includes('reunião'))).message.mentionEveryone).toBe(true)
  })

  it('editar e apagar: o autor sempre; o moderador apaga e fica no registro', async () => {
    const { a, b, text } = await world()
    b.send({ t: 'chat.send', channelId: text.id, content: 'erado', attachmentIds: [], nonce: '1' })
    const msg = (await a.next('chat.message')).message
    a.send({ t: 'chat.edit', id: msg.id, content: 'hack' })
    await b.nothing('chat.edited')
    b.send({ t: 'chat.edit', id: msg.id, content: 'errado' })
    const edited = (await a.next('chat.edited')).message
    expect(edited).toMatchObject({ content: 'errado' })
    expect(edited.editedAt).not.toBeNull()

    a.send({ t: 'chat.delete', id: msg.id })
    expect((await b.next('chat.deleted')).id).toBe(msg.id)
    a.send({ t: 'audit.list', reqId: 'x' })
    expect((await a.next('audit.list')).entries[0].action).toBe('message.delete')
  })

  it('reações: liga, desliga, e só emoji de verdade', async () => {
    const { friend, owner, a, b, text } = await world()
    a.send({ t: 'chat.send', channelId: text.id, content: 'reage aí', attachmentIds: [], nonce: '1' })
    const msg = (await b.next('chat.message')).message
    b.send({ t: 'chat.react', id: msg.id, emoji: '👍', on: true })
    await a.next('chat.reactions')
    a.send({ t: 'chat.react', id: msg.id, emoji: '👍', on: true })
    a.send({ t: 'chat.react', id: msg.id, emoji: '🇧🇷', on: true })
    const r = await b.next('chat.reactions', (m) => m.reactions.length === 2)
    expect(r.reactions).toEqual([
      { emoji: '👍', userIds: [friend.user.id, owner.user.id] },
      { emoji: '🇧🇷', userIds: [owner.user.id] },
    ])
    b.send({ t: 'chat.react', id: msg.id, emoji: '👍', on: false })
    expect((await a.next('chat.reactions', (m) => m.reactions[0]?.userIds.join() === owner.user.id)).reactions[0].userIds).toEqual([owner.user.id])
    b.send({ t: 'chat.react', id: msg.id, emoji: '<script>', on: true })
    await a.nothing('chat.reactions', (m) => JSON.stringify(m).includes('script'))
  })

  it('fixar: só moderador, e a lista de fixadas', async () => {
    const { a, b, text } = await world()
    b.send({ t: 'chat.send', channelId: text.id, content: 'importante', attachmentIds: [], nonce: '1' })
    const msg = (await a.next('chat.message')).message
    b.send({ t: 'chat.pin', id: msg.id, on: true })
    await a.nothing('chat.edited')
    a.send({ t: 'chat.pin', id: msg.id, on: true })
    expect((await b.next('chat.edited')).message.pinned).toBe(true)
    b.send({ t: 'chat.pins', reqId: 'p', channelId: text.id })
    expect((await b.next('chat.pins')).messages.map((m) => m.id)).toEqual([msg.id])
  })

  it('busca sem acento, só nos canais que a pessoa vê, e por autor', async () => {
    const { guild, owner, a, b, text } = await world()
    a.send({ t: 'chat.send', channelId: text.id, content: 'O João chegou na praia', attachmentIds: [], nonce: '1' })
    a.send({
      t: 'channel.create',
      name: 'oculto',
      kind: 'text',
      overwrites: [{ id: guild.id, type: 'role', allow: 0, deny: P.VIEW_CHANNEL }],
    })
    const hidden = (await a.next('channel.upsert', (m) => m.channel.name === 'oculto')).channel
    a.send({ t: 'chat.send', channelId: hidden.id, content: 'joao secreto', attachmentIds: [], nonce: '2' })
    await a.next('chat.message', (m) => m.message.content === 'joao secreto')

    b.send({ t: 'chat.search', reqId: 's', query: 'joao' })
    const found = await b.next('chat.search')
    expect(found.messages.map((m) => m.content)).toEqual(['O João chegou na praia'])
    a.send({ t: 'chat.search', reqId: 's2', query: 'JOÃO' })
    expect((await a.next('chat.search')).total).toBe(2)
    a.send({ t: 'chat.search', reqId: 's3', query: '', authorId: owner.user.id, channelId: text.id })
    expect((await a.next('chat.search')).messages).toHaveLength(1)
  })

  it('histórico em volta de uma mensagem (pular pra ela)', async () => {
    const { a, b, text } = await world()
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      a.send({ t: 'chat.send', channelId: text.id, content: `m${i}`, attachmentIds: [], nonce: String(i) })
      ids.push((await b.next('chat.message')).message.id)
    }
    b.send({ t: 'chat.history', reqId: 'around', channelId: text.id, around: ids[2] })
    const around = await b.next('chat.history')
    expect(around.messages.map((m) => m.content)).toEqual(['m0', 'm1', 'm2', 'm3'])
    expect(around).toMatchObject({ hasMore: false, hasNewer: false })
    b.send({ t: 'chat.history', reqId: 'before', channelId: text.id, before: ids[2] })
    expect((await b.next('chat.history')).messages.map((m) => m.content)).toEqual(['m0', 'm1'])
  })

  it('anti-spam: mais de 5 mensagens em 5 segundos', async () => {
    const { b, text } = await world()
    for (let i = 0; i < 6; i++) b.send({ t: 'chat.send', channelId: text.id, content: `x${i}`, attachmentIds: [], nonce: String(i) })
    expect((await b.next('error')).message).toMatch(/rápido demais/)
  })
})

describe('anexos', () => {
  it('envia, vê, baixa com Range e apaga junto com a mensagem', async () => {
    const { guild, owner, a, b, text } = await world()
    const data = new Uint8Array(3 * 1024 * 1024 + 7).map((_, i) => i % 251)
    const up = await upload(`/api/g/${guild.id}/files`, owner.token, data, 'clipe.bin', 'application/octet-stream')
    expect(up.status).toBe(200)
    expect(up.body.url).toMatch(new RegExp(`^/api/g/${guild.id}/files/`))
    const full = await SELF.fetch(BASE + up.body.url)
    expect(full.headers.get('Content-Security-Policy')).toBe('sandbox')
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(data)
    const part = await SELF.fetch(BASE + up.body.url, { headers: { Range: 'bytes=1048570-1048589' } })
    expect(part.status).toBe(206)
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(data.slice(1048570, 1048590))

    a.send({ t: 'chat.send', channelId: text.id, content: '', attachmentIds: [up.body.id], nonce: 'f' })
    const { message } = await b.next('chat.message')
    expect(message.attachments[0]).toMatchObject({ id: up.body.id, name: 'clipe.bin', size: data.length })
    a.send({ t: 'chat.delete', id: message.id })
    await b.next('chat.deleted')
    expect((await SELF.fetch(BASE + up.body.url)).status).toBe(404)
  })

  it('link de um servidor não abre arquivo de outro, e ninguém se passa por outro no envio', async () => {
    const { guild, owner, friend } = await world()
    const up = await upload(`/api/g/${guild.id}/files`, friend.token, 'oi', 'a.txt')
    const forged = up.body.url.replace(`/api/g/${guild.id}/`, '/api/g/outro/')
    expect((await SELF.fetch(BASE + forged)).status).toBe(403)
    const res = await api(`/api/g/${guild.id}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${friend.token}`, 'X-Resenha-User': owner.user.id, 'X-File-Name': 'b.txt' },
      body: 'oi',
    })
    const uploader = await runInDurableObject(env.GUILD.get(env.GUILD.idFromName(guild.id)), (_, state) =>
      state.storage.sql.exec('SELECT uploader_id FROM attachments WHERE id = ?', res.body.id).one().uploader_id,
    )
    expect(uploader).toBe(friend.user.id)
    // Quem não é do servidor não envia.
    const stranger = await signup('zeca', await (async () => {
      const s = await guildSocket(guild.id, owner.token)
      await s.next('ready')
      return invite(s)
    })())
    await post(`/api/guilds/${guild.id}/leave`, {}, stranger.token)
    expect((await upload(`/api/g/${guild.id}/files`, stranger.token, 'x', 'x.txt')).status).toBe(404)
    expect((await upload(`/api/g/${guild.id}/files`, 'token-falso', 'x', 'x.txt')).status).toBe(401)
  })
})

describe('presença', () => {
  it('invisível aparece offline desde o começo; status e texto chegam pros outros', async () => {
    const { guild, friend, a, b } = await world()
    b.close()
    await a.next('presence', (m) => m.userId === friend.user.id && !m.online)
    a.drain()
    const ghost = await guildSocket(guild.id, friend.token, { status: 'invisible' })
    const ready = await ghost.next('ready')
    expect(ready.online).not.toContain(friend.user.id)
    await a.nothing('presence', (m) => (m as any).userId === friend.user.id)
    ghost.send({ t: 'presence', status: 'dnd', text: 'estudando' })
    const p = await a.next('presence', (m) => m.userId === friend.user.id)
    expect(p).toMatchObject({ online: true, presence: { status: 'dnd', text: 'estudando' } })
  })
})

describe('voz', () => {
  it('entrar na call avisa todo mundo e a sinalização só vai pro destino', async () => {
    const { owner, guild, a, b, readyA, readyB, voice } = await world()
    const c = await guildSocket(guild.id, owner.token)
    const readyC = await c.next('ready')
    a.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    b.send({ t: 'voice.join', channelId: voice.id, muted: true, deafened: false })
    const state = await c.next('voice.state', (m) => m.members.length === 2)
    expect(state.members.find((m) => m.connId === readyB.connId)?.muted).toBe(true)

    a.send({ t: 'rtc.signal', to: readyB.connId, data: { kind: 'watch' } })
    expect(await b.next('rtc.signal')).toEqual({ t: 'rtc.signal', from: readyA.connId, data: { kind: 'watch' } })
    c.send({ t: 'rtc.signal', to: readyB.connId, data: { kind: 'watch' } })
    await b.nothing('rtc.signal')
    // Mesma pessoa entrando por outro aparelho: o primeiro sai.
    c.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    expect((await a.next('voice.forced')).channelId).toBeNull()
  })

  it('moderador muta, move e desconecta', async () => {
    const { friend, a, b, readyB, voice } = await world()
    a.send({ t: 'channel.create', name: 'Sala 2', kind: 'voice' })
    const room2 = (await b.next('channel.upsert', (m) => m.channel.name === 'Sala 2')).channel
    b.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.length === 1)

    a.send({ t: 'member.voice', userId: friend.user.id, serverMuted: true })
    const muted = await b.next('voice.state', (m) => m.members[0]?.serverMuted === true)
    expect(muted.members[0].connId).toBe(readyB.connId)
    a.send({ t: 'member.voice', userId: friend.user.id, moveTo: room2.id })
    expect((await b.next('voice.forced')).channelId).toBe(room2.id)
    await a.next('voice.state', (m) => m.members[0]?.channelId === room2.id)
    a.send({ t: 'member.voice', userId: friend.user.id, disconnect: true })
    expect((await b.next('voice.forced')).channelId).toBeNull()
    b.send({ t: 'member.voice', userId: friend.user.id, serverMuted: false })
    expect((await b.next('error')).message).toMatch(/não pode mutar/)
  })

  it('canal com limite de pessoas', async () => {
    const { a, b, voice } = await world()
    a.send({ t: 'channel.update', id: voice.id, userLimit: 1 })
    await b.next('channel.upsert')
    b.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await b.next('voice.state', (m) => m.members.length === 1)
    // O dono tem "mover membros": passa do limite. Outro sem permissão não passaria.
    a.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await b.next('voice.state', (m) => m.members.length === 2)
  })

  it('a call sobrevive à hibernação e cair da conexão tira da call', async () => {
    const { a, b, readyA, readyB, voice } = await world()
    a.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    b.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.length === 2)
    await evictAllDurableObjects()
    a.send({ t: 'rtc.signal', to: readyB.connId, data: { kind: 'unwatch' } })
    expect((await b.next('rtc.signal')).from).toBe(readyA.connId)
    b.send({ t: 'voice.update', muted: true, deafened: false, sharing: true, camera: true })
    const state = await a.next('voice.state', (m) => m.members.some((x) => x.sharing))
    expect(state.members.find((x) => x.connId === readyB.connId)?.camera).toBe(true)
    b.close()
    await a.next('voice.state', (m) => m.members.length === 1)
  })

  it('sem permissão de vídeo, não compartilha tela', async () => {
    const { guild, a, b, voice } = await world()
    a.send({ t: 'role.update', id: guild.id, permissions: DEFAULT_PERMISSIONS & ~P.VIDEO })
    await b.next('roles')
    b.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.length === 1)
    b.send({ t: 'voice.update', muted: false, deafened: false, sharing: true, camera: true })
    const state = await a.next('voice.state')
    expect(state.members[0]).toMatchObject({ sharing: false, camera: false })
  })
})

describe('notificações', () => {
  it('guarda a preferência por servidor e sincroniza entre aparelhos', async () => {
    const { guild, friend, b, text } = await world()
    const other = await guildSocket(guild.id, friend.token)
    await other.next('ready')
    b.send({ t: 'notify.update', settings: { level: 'mentions', mutedUntil: null, channels: { [text.id]: { level: 'none', mutedUntil: null }, fake: { level: 'all', mutedUntil: null } } } })
    const synced = await other.next('notify.settings')
    expect(synced.settings).toEqual({ level: 'mentions', mutedUntil: null, channels: { [text.id]: { level: 'none', mutedUntil: null } } })
    const again = await guildSocket(guild.id, friend.token)
    expect((await again.next('ready')).notify).toEqual(synced.settings)
  })
})

describe('segurança do protocolo', () => {
  it('quem não autentica é desconectado e mensagem antes do auth fecha', async () => {
    const { guild } = await world()
    const res = await SELF.fetch(`${BASE}/api/g/${guild.id}/ws`, { headers: { Upgrade: 'websocket' } })
    const ws = res.webSocket!
    ws.accept()
    const closed = new Promise<number>((r) => ws.addEventListener('close', (e) => r(e.code)))
    ws.send(JSON.stringify({ t: 'chat.send', channelId: 'x', content: 'oi', attachmentIds: [], nonce: '1' }))
    expect(await closed).toBe(4001)
  })

  it('token inválido fecha com 4001', async () => {
    const { guild } = await world()
    const s = await guildSocket(guild.id, 'x'.repeat(43))
    expect(await s.closed()).toBe(4001)
  })

  it('canal de outro servidor não é aceito', async () => {
    const { owner, a } = await world()
    const other = await createGuild(owner.token, 'Outro')
    const s = await guildSocket(other.id, owner.token)
    const ready = await s.next('ready')
    const foreign: Channel = ready.channels.find((c) => c.kind === 'text')!
    a.send({ t: 'chat.send', channelId: foreign.id, content: 'vazou?', attachmentIds: [], nonce: '1' })
    expect((await a.next('error')).message).toMatch(/Canal não existe/)
    await s.nothing('chat.message')
  })

  it('rota de migração interna não é acessível de fora', async () => {
    const { owner } = await world()
    expect((await call('GET', '/internal/legacy-file/abc')).status).toBe(401)
    expect((await call('GET', '/internal/legacy-file/abc', undefined, owner.token)).status).toBe(404)
  })
})
