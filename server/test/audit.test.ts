import { env, evictAllDurableObjects, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERMISSIONS, P, dmChannelId } from '../../shared/protocol'
import { api, call, guildSocket, homeSocket, invite, post, signup, tick, upload, world } from './helpers'

// Correções da auditoria da 1.18 (uma por teste, com o cenário que dava errado).

const MINUTE = 60_000
const KEY = 'chave-do-app-do-duarte-1'

describe('reenvio depois de uma queda', () => {
  it('mensagem só com anexo: o reenvio com o mesmo nonce confirma (antes dizia que o anexo não existia mais)', async () => {
    const { guild, friend, a, b, text } = await world()
    const up = await upload(`/api/g/${guild.id}/files?channel=${text.id}`, friend.token, 'conteúdo', 'nota.txt')
    expect(up.status).toBe(200)
    b.send({ t: 'chat.send', channelId: text.id, content: '', attachmentIds: [up.body.id], nonce: 'anexo' })
    const first = (await b.next('chat.message', (m) => m.nonce === 'anexo')).message
    expect(first.attachments.map((x) => x.name)).toEqual(['nota.txt'])
    await a.next('chat.message')
    // A confirmação se perdeu e o app manda de novo: o anexo já é da mensagem, não está mais "solto".
    b.drain()
    b.send({ t: 'chat.send', channelId: text.id, content: '', attachmentIds: [up.body.id], nonce: 'anexo' })
    expect((await b.next('chat.message', (m) => m.nonce === 'anexo')).message.id).toBe(first.id)
    await b.nothing('error')
    await a.nothing('chat.message')
  })

  it('conversa privada: confirmar o reenvio de uma mensagem antiga não volta a conversa pra ela nem zera as não lidas', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const homeB = await homeSocket(friend.user.id, friend.token)
    await homeB.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    homeA.send({ t: 'dm.send', channelId, content: 'primeira', attachmentIds: [], nonce: 'n1' })
    const m1 = (await homeA.next('dm.message', (m) => m.nonce === 'n1')).message
    await homeB.next('dm.message')
    homeB.send({ t: 'dm.send', channelId, content: 'resposta', attachmentIds: [], nonce: 'n2' })
    const m2 = (await homeA.next('dm.message', (m) => m.message.content === 'resposta')).message
    // O app do Lucas não viu a confirmação da primeira (caiu) e reenvia depois de a resposta chegar.
    homeA.drain()
    homeA.send({ t: 'dm.send', channelId, content: 'primeira', attachmentIds: [], nonce: 'n1' })
    expect((await homeA.next('dm.message', (m) => m.nonce === 'n1')).message.id).toBe(m1.id)
    const again = await homeSocket(owner.user.id, owner.token)
    const dm = (await again.next('ready')).dms.find((d) => d.id === channelId)!
    expect(dm).toMatchObject({ lastMessageId: m2.id, unread: 1, lastReadId: m1.id })
  })
})

describe('call', () => {
  it('saiu da call com a conexão caída: o app diz que não está em call e o servidor não põe de volta', async () => {
    const { guild, friend, a, b, voice } = await world()
    b.close()
    const first = await guildSocket(guild.id, friend.token, { key: KEY })
    const ready = await first.next('ready')
    first.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.some((x) => x.connId === ready.connId))
    // Cai sem avisar (o servidor espera voltar), e a pessoa clica em "sair" nesse meio-tempo.
    first.drop()
    await tick(100)
    a.drain()
    const back = await guildSocket(guild.id, friend.token, { key: KEY, voice: null })
    const again = await back.next('ready')
    expect(again.connId).toBe(ready.connId)
    expect(again.resumed).toBe(false)
    expect(again.voice).toEqual([])
    // Ninguém manda o app sair de uma call em que ele já não está.
    await back.nothing('voice.forced')
    expect((await a.next('voice.state')).members).toEqual([])
  })

  it('dizendo a sala em que está (ou sem dizer nada, como o app antigo), volta na call como antes', async () => {
    const { guild, friend, a, b, voice } = await world()
    b.close()
    for (const claim of [{ voice: voice.id }, {}]) {
      const first = await guildSocket(guild.id, friend.token, { key: KEY })
      const ready = await first.next('ready')
      first.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
      await a.next('voice.state', (m) => m.members.some((x) => x.connId === ready.connId))
      first.drop()
      await tick(100)
      const back = await guildSocket(guild.id, friend.token, { key: KEY, ...claim })
      const again = await back.next('ready')
      expect(again.resumed).toBe(true)
      expect(again.voice.map((v) => v.connId)).toEqual([ready.connId])
      back.send({ t: 'voice.leave' })
      await a.next('voice.state', (m) => m.members.length === 0)
      back.close()
      await tick(50)
      a.drain()
    }
  })

  it('entrar na call puxa a varredura de minuto em minuto (ela é que mantém a call em dia pra um reinício)', async () => {
    const { guild, a, voice } = await world()
    const stub = env.GUILD.get(env.GUILD.idFromName(guild.id))
    const alarmIn = async () => (await runInDurableObject(stub, (_, state) => state.storage.getAlarm()))! - Date.now()
    // Depois de uma varredura sem ninguém em call, a próxima fica longe.
    await runDurableObjectAlarm(stub)
    expect(await alarmIn()).toBeGreaterThan(4 * MINUTE)
    a.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.length === 1)
    expect(await alarmIn()).toBeLessThanOrEqual(MINUTE)
  })

  it('a limpeza pesada lembra quando rodou, mesmo com o servidor dormindo entre um alarme e outro', async () => {
    const { guild } = await world()
    const stub = env.GUILD.get(env.GUILD.idFromName(guild.id))
    const cleanedAt = () =>
      runInDurableObject(stub, (_, state) => Number(state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'cleaned_at'").toArray()[0]?.value ?? 0))
    const before = Date.now()
    await runDurableObjectAlarm(stub)
    const first = await cleanedAt()
    expect(first).toBeGreaterThanOrEqual(before)
    // O objeto "acorda" de novo (a memória zerou) e o alarme seguinte não refaz a limpeza.
    await runInDurableObject(stub, (instance) => {
      ;(instance as unknown as { cleanedAt: number }).cleanedAt = 0
    })
    await tick(20)
    await runDurableObjectAlarm(stub)
    expect(await cleanedAt()).toBe(first)
  })
})

describe('custo de pedidos', () => {
  it('tirar a foto ou o banner sem ter nenhum não espalha nada pros servidores', async () => {
    const { friend, a } = await world()
    a.drain()
    for (let i = 0; i < 3; i++) {
      expect((await call('DELETE', '/api/me/avatar', undefined, friend.token)).status).toBe(200)
      expect((await call('DELETE', '/api/me/banner', undefined, friend.token)).status).toBe(200)
    }
    await a.nothing('member.upsert')
    await a.nothing('user.upsert')
  })

  it('conexão nova não puxa o alarme pra daqui a 16 s (o prazo do login é um temporizador, sem pedido a mais)', async () => {
    const { guild, owner } = await world()
    type Ready = { next(t: 'ready'): Promise<unknown> }
    const cases: [DurableObjectStub, () => Promise<Ready>][] = [
      [env.GUILD.get(env.GUILD.idFromName(guild.id)), () => guildSocket(guild.id, owner.token)],
      [env.HOME.get(env.HOME.idFromName(owner.user.id)), () => homeSocket(owner.user.id, owner.token)],
    ]
    for (const [stub, connect] of cases) {
      const first = await connect()
      await first.next('ready')
      const alarmIn = async () => (await runInDurableObject(stub, (_, state) => state.storage.getAlarm()))! - Date.now()
      await runDurableObjectAlarm(stub)
      expect(await alarmIn()).toBeGreaterThan(4 * MINUTE)
      // Uma reconexão (cada pessoa tem uma a cada 10 a 60 min): a varredura continua onde estava.
      const again = await connect()
      await again.next('ready')
      expect(await alarmIn()).toBeGreaterThan(4 * MINUTE)
    }
  })

  it('incidente do app: um a cada 10 min por pessoa, mesmo com várias conexões', async () => {
    const { owner } = await world()
    const one = await homeSocket(owner.user.id, owner.token)
    await one.next('ready')
    const two = await homeSocket(owner.user.id, owner.token)
    await two.next('ready')
    one.send({ t: 'incident', kind: 'send-limit', detail: 'a' })
    two.send({ t: 'incident', kind: 'send-limit', detail: 'b' })
    one.send({ t: 'incident', kind: 'signal-loop', detail: 'c' })
    await tick(200)
    const { incidents } = (await call<{ incidents: { kind: string }[] }>('GET', '/api/admin', undefined, owner.token)).body
    expect(incidents.filter((i) => i.kind.startsWith('app:')).map((i) => i.kind)).toEqual(['app:send-limit'])
  })
})

describe('mídia pelo Cloudflare', () => {
  it('sessão no SFU só pra quem está numa sala que passa pelo Cloudflare', async () => {
    const { guild, owner, friend, a, voice } = await world()
    const open = (token: string, body: unknown) => post('/api/media/sessions', body, token)
    // Sem dizer a sala (app até a 1.17, ou um script): recusado antes de qualquer coisa.
    expect((await open(friend.token, {})).status).toBe(403)
    // Sala direta: recusado.
    expect((await open(friend.token, { guild: guild.id, channel: voice.id })).status).toBe(403)
    // O dono do Resenha passa a sala pelo Cloudflare: quem pode entrar nela passa da conferência
    // (e aqui para no "SFU não configurado", que é como os testes rodam).
    a.send({ t: 'channel.update', id: voice.id, relay: true })
    await a.next('channel.upsert', (m) => m.channel.relay === true)
    expect((await open(friend.token, { guild: guild.id, channel: voice.id })).status).toBe(503)
    expect((await open(owner.token, { guild: guild.id, channel: voice.id })).status).toBe(503)
    // Sala de outro servidor, canal inventado, ou lixo no lugar dos ids: recusado.
    expect((await open(friend.token, { guild: guild.id, channel: 'nao-existe' })).status).toBe(403)
    expect((await open(friend.token, { guild: 'outro', channel: voice.id })).status).toBe(403)
    expect((await open(friend.token, { guild: { $ne: 1 }, channel: [voice.id] })).status).toBe(403)
  })
})

describe('servidor (Guild)', () => {
  it('conexão fechada por estourar o orçamento não volta zerada depois de o servidor dormir', async () => {
    const { guild, owner, text } = await world()
    const key = 'chave-do-app-do-lucas-9'
    const stub = env.GUILD.get(env.GUILD.idFromName(guild.id))
    const first = await guildSocket(guild.id, owner.token, { key, version: '1.18.0', platform: 'linux' })
    const ready = await first.next('ready')
    await runInDurableObject(stub, (instance) => {
      const now = Date.now()
      // A janela de 1 h no teto (a de 10 min ainda tem folga).
      ;(instance as unknown as { spentByConn: Map<string, number[]> }).spentByConn.set(ready.connId, [now, 0, now, 4000, now, 4000])
    })
    first.send({ t: 'typing', channelId: text.id })
    expect(await first.closed()).toBe(4008)
    // O app pausa uns minutos; nesse tempo o servidor dorme e a memória some.
    await evictAllDurableObjects()
    const back = await guildSocket(guild.id, owner.token, { key, version: '1.18.0', platform: 'linux' })
    expect((await back.next('ready')).connId).toBe(ready.connId)
    back.send({ t: 'typing', channelId: text.id })
    expect(await back.closed()).toBe(4008)
  })

  it('quem passa a ver uma sala de voz recebe quem está nela', async () => {
    const { guild, friend, a, b, readyA } = await world()
    a.send({ t: 'role.create', name: 'VIP' })
    const role = (await b.next('roles')).roles.find((r) => r.name === 'VIP')!
    a.send({
      t: 'channel.create',
      name: 'sala fechada',
      kind: 'voice',
      overwrites: [
        { id: guild.id, type: 'role', allow: 0, deny: P.VIEW_CHANNEL },
        { id: role.id, type: 'role', allow: P.VIEW_CHANNEL, deny: 0 },
      ],
    })
    const room = (await a.next('channel.upsert', (m) => m.channel.name === 'sala fechada')).channel
    a.send({ t: 'voice.join', channelId: room.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.length === 1)
    b.drain()
    a.send({ t: 'member.roles', userId: friend.user.id, roles: [role.id] })
    await b.next('channel.upsert', (m) => m.channel.id === room.id)
    const state = await b.next('voice.state')
    expect(state.members.map((v) => [v.connId, v.channelId])).toEqual([[readyA.connId, room.id]])
  })

  it('exceção de permissão de quem saiu do servidor não trava a edição do canal pra quem modera', async () => {
    const { guild, friend, a, b, text } = await world()
    const third = await signup('zeca', await invite(a))
    await a.next('member.upsert', (m) => m.member.userId === third.user.id)
    // O Duarte modera canais e cargos, mas não pode mencionar todo mundo.
    a.send({ t: 'role.create', name: 'Mod' })
    const mod = (await a.next('roles', (m) => m.roles.some((r) => r.name === 'Mod'))).roles.find((r) => r.name === 'Mod')!
    a.send({ t: 'role.update', id: mod.id, permissions: P.MANAGE_CHANNELS | P.MANAGE_ROLES })
    await a.next('roles', (m) => (m.roles.find((r) => r.id === mod.id)?.permissions ?? 0) !== 0)
    a.send({ t: 'member.roles', userId: friend.user.id, roles: [mod.id] })
    await b.next('permissions')
    a.send({ t: 'role.update', id: guild.id, permissions: DEFAULT_PERMISSIONS & ~P.MENTION_EVERYONE })
    await a.next('roles')
    // O dono dá ao Zeca, só nesse canal, uma permissão que o Duarte não tem. O Zeca sai.
    a.send({ t: 'channel.update', id: text.id, overwrites: [{ id: third.user.id, type: 'member', allow: P.MENTION_EVERYONE, deny: 0 }] })
    await a.next('channel.upsert', (m) => m.channel.overwrites.length === 1)
    await post(`/api/guilds/${guild.id}/leave`, {}, third.token)
    await a.next('member.removed')
    b.drain()
    // O Duarte mexe em outra coisa do canal (algo que ele mesmo tem): tem que salvar.
    b.send({ t: 'channel.update', id: text.id, overwrites: [{ id: guild.id, type: 'role', allow: 0, deny: P.ATTACH_FILES }] })
    const saved = await b.next('channel.upsert', (m) => m.channel.id === text.id)
    expect(saved.channel.overwrites).toEqual([{ id: guild.id, type: 'role', allow: 0, deny: P.ATTACH_FILES }])
    await b.nothing('error')
  })
})

describe('Worker: quem só erra não gasta os pedidos do dia', () => {
  const from = (ip: string, path: string, headers: Record<string, string> = {}) => api(path, { headers: { 'CF-Connecting-IP': ip, ...headers } })

  it('imagem que não existe: depois de 20 num minuto, o IP é recusado sem perguntar ao Directory', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 24; i++) statuses.push((await from('203.0.113.7', `/media/inventada${String(i).padStart(4, '0')}`)).status)
    expect(statuses.slice(0, 20).every((s) => s === 404)).toBe(true)
    expect(statuses.slice(20)).toEqual([429, 429, 429, 429])
    // Outro IP não tem nada com isso.
    expect((await from('203.0.113.8', '/media/inventada9999')).status).toBe(404)
  })

  it('token inventado: o que nem tem cara de token não chega no Directory, e quem insiste é recusado', async () => {
    const { owner } = await world()
    const me = (ip: string, token: string) => from(ip, '/api/me', { Authorization: `Bearer ${token}` })
    expect((await me('203.0.113.20', 'x')).status).toBe(401)
    expect((await me('203.0.113.20', 'tem espaco, invalido!')).status).toBe(401)
    const statuses: number[] = []
    for (let i = 0; i < 22; i++) statuses.push((await me('203.0.113.21', `token-inventado-numero-${i}-aaaaaaaaaaaa`)).status)
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true)
    expect(statuses.slice(20)).toEqual([429, 429])
    // A sessão de verdade, de outro IP, segue valendo.
    expect((await me('203.0.113.22', owner.token)).status).toBe(200)
  })

  it('o modo do cadastro fica guardado uns segundos, e criar conta renova na hora', async () => {
    expect((await api('/api/status')).body).toMatchObject({ needsInvite: false })
    await world()
    // A primeira conta acabou de ser criada por aqui: o status já reflete.
    expect((await api('/api/status')).body).toMatchObject({ needsInvite: true, signup: 'invite' })
  })
})
