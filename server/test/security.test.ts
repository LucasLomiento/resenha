import { SELF, env, listDurableObjectIds, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERMISSIONS, P, dmChannelId } from '../../shared/protocol'
import type { Directory } from '../src/directory'
import { BASE, PASSWORD, api, call, createGuild, guildSocket, homeSocket, invite, post, signup, upload, world } from './helpers'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])

async function count(ns: DurableObjectNamespace): Promise<number> {
  return (await listDurableObjectIds(ns)).length
}

function loginFrom(ip: string, username: string, password: string) {
  return api('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ username, password }),
  })
}

describe('revisão de segurança', () => {
  it('canal privado continua privado ao mudar de categoria, reordenar ou apagar a categoria', async () => {
    const { guild, friend, a, b } = await world()
    // Moderador com "gerenciar canais" e "ver auditoria", mas sem acesso à categoria da equipe.
    a.send({ t: 'role.create', name: 'Mod' })
    const mod = (await a.next('roles')).roles.find((r) => r.name === 'Mod')!
    a.send({ t: 'role.update', id: mod.id, permissions: P.MANAGE_CHANNELS | P.VIEW_AUDIT_LOG })
    await a.next('roles')
    a.send({ t: 'member.roles', userId: friend.user.id, roles: [mod.id] })
    await b.next('member.upsert', (m) => m.member.roles.includes(mod.id))

    a.send({ t: 'channel.create', name: 'Equipe', kind: 'category', overwrites: [{ id: guild.id, type: 'role', allow: 0, deny: P.VIEW_CHANNEL }] })
    const staff = (await a.next('channel.upsert', (m) => m.channel.name === 'Equipe')).channel
    // Canal criado dentro da categoria nasce com as permissões dela.
    a.send({ t: 'channel.create', name: 'segredo', kind: 'text', parentId: staff.id })
    const secret = (await a.next('channel.upsert', (m) => m.channel.name === 'segredo')).channel
    expect(secret.overwrites).toEqual(staff.overwrites)
    a.send({ t: 'chat.send', channelId: secret.id, content: 'senha do wifi', attachmentIds: [], nonce: 's' })
    await a.next('chat.message')

    // O moderador acha o id na auditoria e tenta tirar o canal da categoria.
    b.send({ t: 'channel.reorder', order: [{ id: secret.id, position: 0, parentId: null }] })
    b.send({ t: 'channel.update', id: secret.id, parentId: null })
    await b.nothing('channel.upsert', (m) => (m as any).channel?.id === secret.id)
    await b.nothing('channels.reordered', (m) => (m as any).channels?.some((c: any) => c.id === secret.id))

    // Até o dono mudando de categoria ou apagando a categoria não expõe o canal.
    a.send({ t: 'channel.update', id: secret.id, parentId: null })
    await a.next('channel.upsert', (m) => m.channel.id === secret.id && m.channel.parentId === null)
    a.send({ t: 'channel.update', id: secret.id, parentId: staff.id })
    await a.next('channel.upsert', (m) => m.channel.id === secret.id && m.channel.parentId === staff.id)
    a.send({ t: 'channel.delete', id: staff.id })
    await a.next('channel.removed', (m) => m.id === staff.id)
    b.send({ t: 'chat.history', reqId: 'h', channelId: secret.id })
    await b.nothing('chat.history')
    await b.nothing('channel.upsert', (m) => (m as any).channel?.id === secret.id)
  })

  it('mudar a categoria muda junto os canais sincronizados com ela', async () => {
    const { guild, a, b } = await world()
    a.send({ t: 'channel.create', name: 'Jogos', kind: 'category' })
    const games = (await b.next('channel.upsert', (m) => m.channel.name === 'Jogos')).channel
    a.send({ t: 'channel.create', name: 'lol', kind: 'text', parentId: games.id })
    const lol = (await b.next('channel.upsert', (m) => m.channel.name === 'lol')).channel
    a.send({ t: 'channel.create', name: 'aberto', kind: 'text', parentId: games.id, overwrites: [{ id: guild.id, type: 'role', allow: P.VIEW_CHANNEL, deny: 0 }] })
    const open = (await b.next('channel.upsert', (m) => m.channel.name === 'aberto')).channel

    a.send({ t: 'channel.update', id: games.id, overwrites: [{ id: guild.id, type: 'role', allow: 0, deny: P.VIEW_CHANNEL }] })
    // O sincronizado some junto; o que tinha permissões próprias fica.
    await b.next('channel.removed', (m) => m.id === lol.id)
    await b.nothing('channel.removed', (m) => (m as any).id === open.id)
  })

  it('enviar arquivo precisa da permissão de anexar', async () => {
    const { guild, friend, a, b, text } = await world()
    a.send({ t: 'role.update', id: guild.id, permissions: DEFAULT_PERMISSIONS & ~P.ATTACH_FILES })
    await b.next('roles')
    expect((await upload(`/api/g/${guild.id}/files?channel=${text.id}`, friend.token, 'x', 'x.txt')).status).toBe(403)
    expect((await upload(`/api/g/${guild.id}/files`, friend.token, 'x', 'x.txt')).status).toBe(403)
  })

  it('ícone de servidor: no máximo um solto por pessoa e limite por hora', async () => {
    const me = await signup('lucas')
    const send = () => api('/api/guilds/icon', { method: 'POST', headers: { Authorization: `Bearer ${me.token}` }, body: PNG })
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200)
    const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'))
    const loose = await runInDurableObject(dir, (_, state) =>
      state.storage.sql.exec("SELECT COUNT(*) AS n FROM media WHERE kind = 'guild_icon'").one().n,
    )
    expect(loose).toBe(1)
    let accepted = 3
    while ((await send()).status === 200) accepted++
    expect(accepted).toBeLessThanOrEqual(20)
  })

  it('excluir a conta: limite de tentativas, e dono de servidor nem testa a senha', async () => {
    const { owner, friend } = await world()
    expect((await post('/api/me/delete', { password: 'errada-123' }, owner.token)).status).toBe(409)
    for (let i = 0; i < 5; i++) expect((await post('/api/me/delete', { password: `errada-${i}-x` }, friend.token)).status).toBe(401)
    expect((await post('/api/me/delete', { password: PASSWORD }, friend.token)).status).toBe(429)
  })

  it('convite de um uso não vale duas vezes, nem ao mesmo tempo', async () => {
    const { a, friend } = await world()
    const many = await invite(a, { maxUses: 100 })
    const people = await Promise.all(['ana', 'bia', 'caio', 'davi'].map((u) => signup(u, many)))
    const other = await createGuild(friend.token, 'Outro')
    const s = await guildSocket(other.id, friend.token)
    await s.next('ready')
    const once = await invite(s, { maxUses: 1 })
    const results = await Promise.all(people.map((p) => post(`/api/invites/${once}`, {}, p.token)))
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
  })

  it('ninguém consegue tomar antes o nome que a conta excluída vai usar', async () => {
    const { friend, a } = await world()
    await signup(`deleted.${friend.user.id.toLowerCase()}`, await invite(a)).catch(() => null)
    expect((await post('/api/me/delete', { password: PASSWORD }, friend.token)).status).toBe(200)
    expect((await call('GET', `/api/users/${friend.user.id}`, undefined, (await post('/api/login', { username: 'lucas', password: PASSWORD })).body.token)).body).toMatchObject({ deleted: true })
  })

  it('bloqueio vale pra editar mensagem antiga e pro "digitando"', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const homeB = await homeSocket(friend.user.id, friend.token)
    await homeB.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeB.send({ t: 'dm.open', userId: owner.user.id, reqId: 'o' })
    await homeB.next('dm.channel')
    homeB.send({ t: 'dm.send', channelId, content: 'oi', attachmentIds: [], nonce: 'n' })
    const msg = (await homeA.next('dm.message')).message
    expect((await call('PUT', `/api/blocks/${friend.user.id}`, undefined, owner.token)).status).toBe(200)
    homeB.send({ t: 'dm.edit', channelId, id: msg.id, content: 'mensagem trocada' })
    expect((await homeB.next('error')).message).toMatch(/Não dá pra editar/)
    homeB.send({ t: 'dm.typing', channelId })
    await homeA.nothing('dm.edited')
    await homeA.nothing('dm.typing')
  })

  it('rotas com id inventado não criam Durable Object', async () => {
    const { owner } = await world()
    const before = [await count(env.GUILD), await count(env.HOME), await count(env.CONVERSATION)]
    await call('DELETE', '/api/blocks/inventado123', undefined, owner.token)
    await call('DELETE', '/api/friends/inventado123', undefined, owner.token)
    expect((await upload('/api/g/inventado123/files', owner.token, 'x', 'x.txt')).status).toBe(404)
    const home = await homeSocket(owner.user.id, owner.token)
    await home.next('ready')
    home.send({ t: 'dm.typing', channelId: dmChannelId(owner.user.id, 'inventado123') })
    home.send({ t: 'call.ring', channelId: dmChannelId(owner.user.id, 'inventado123'), video: false })
    await home.nothing('error')
    const after = [await count(env.GUILD), await count(env.HOME), await count(env.CONVERSATION)]
    expect(after).toEqual(before)
  })

  it('dois envios ao mesmo tempo não cabem no mesmo espaço', async () => {
    const me = await signup('lucas')
    const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'))
    const MB = 1024 * 1024
    const results = await runInDurableObject(dir, (instance: Directory) => {
      instance.reportStorage('g:outro', 4 * 1024 * MB - 30 * MB)
      return [instance.reserveStorage('g:x', 0, 25 * MB, me.user.id), instance.reserveStorage('g:x', 0, 25 * MB, me.user.id)]
    })
    expect(results.map((r) => r.ok)).toEqual([true, false])
  })

  it('quem erra a senha de propósito não tranca a conta de quem está em outro lugar', async () => {
    await signup('lucas')
    for (let i = 0; i < 5; i++) expect((await loginFrom('1.1.1.1', 'lucas', `errada-${i}-x`)).status).toBe(401)
    expect((await loginFrom('1.1.1.1', 'lucas', PASSWORD)).status).toBe(429)
    expect((await loginFrom('2.2.2.2', 'lucas', PASSWORD)).status).toBe(200)
  })

  it('pedido de amizade tem limite antes de dizer se a pessoa existe', async () => {
    const me = await signup('lucas')
    let last = 0
    for (let i = 0; i < 31; i++) last = (await post('/api/friends', { username: `ninguem${i}` }, me.token)).status
    expect(last).toBe(429)
  })

  it('uma conexão mandando coisa demais é segurada', async () => {
    const { a, text } = await world()
    for (let i = 0; i < 70; i++) a.send({ t: 'typing', channelId: text.id })
    expect((await a.next('error')).message).toMatch(/Muitas ações/)
    for (let i = 0; i < 6; i++) a.send({ t: 'chat.edit', id: 'x', content: 'y' })
  })

  it('conexões sem login têm limite por servidor', async () => {
    const { guild } = await world()
    const sockets: WebSocket[] = []
    let refused = 0
    for (let i = 0; i < 52; i++) {
      const res = await SELF.fetch(`${BASE}/api/g/${guild.id}/ws`, { headers: { Upgrade: 'websocket' } })
      if (res.webSocket) {
        res.webSocket.accept()
        sockets.push(res.webSocket)
      } else refused++
    }
    expect(refused).toBeGreaterThan(0)
    for (const ws of sockets) ws.close()
  })

  it('erro ao mandar mensagem volta com o nonce (o app devolve o texto pro campo)', async () => {
    const { a, text } = await world()
    a.send({ t: 'chat.send', channelId: text.id, content: 'x'.repeat(5000), attachmentIds: [], nonce: 'grande' })
    expect(await a.next('error')).toMatchObject({ nonce: 'grande', message: expect.stringMatching(/grande demais/) })
  })
})
