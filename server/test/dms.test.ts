import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { dmChannelId } from '../../shared/protocol'
import { BASE, call, guildSocket, homeSocket, invite, post, signup, upload, world } from './helpers'

/** Duas pessoas em servidores diferentes (sem nada em comum). */
async function strangers() {
  const { owner, friend, a, guild } = await world()
  const third = await signup('zeca', await invite(a))
  await post(`/api/guilds/${guild.id}/leave`, {}, third.token)
  return { owner, friend, third }
}

describe('tela inicial (Home)', () => {
  it('ready com servidores, amigos, conversas e status', async () => {
    const { owner, guild } = await world()
    const home = await homeSocket(owner.user.id, owner.token)
    const ready = await home.next('ready')
    expect(ready.me).toMatchObject({ id: owner.user.id, username: 'lucas', staff: true })
    expect(ready.guilds).toEqual([guild])
    expect(ready).toMatchObject({ friends: [], blocked: [], dms: [], presence: { status: 'online', text: null } })
  })

  it('token de uma pessoa não abre o Home de outra', async () => {
    const { owner, friend } = await world()
    const home = await homeSocket(friend.user.id, owner.token)
    expect(await home.closed()).toBe(4001)
    const res = await SELF.fetch(`${BASE}/api/home/naoexiste/ws`, { headers: { Upgrade: 'websocket' } })
    expect(res.status).toBe(404)
  })

  it('status escolhido vale pros outros aparelhos e fica guardado', async () => {
    const { owner } = await world()
    const one = await homeSocket(owner.user.id, owner.token)
    await one.next('ready')
    const two = await homeSocket(owner.user.id, owner.token)
    await two.next('ready')
    one.send({ t: 'presence', status: 'dnd', text: 'focado' })
    expect(await two.next('presence.self')).toMatchObject({ status: 'dnd', text: 'focado' })
    // "Ausente" automático não muda o escolhido.
    one.send({ t: 'presence', status: 'idle', text: 'focado', auto: true })
    await two.nothing('presence.self')
    const three = await homeSocket(owner.user.id, owner.token)
    expect((await three.next('ready')).presence).toEqual({ status: 'dnd', text: 'focado' })
  })
})

describe('amigos', () => {
  it('pedido, aceite e status do amigo', async () => {
    const { owner, third } = await strangers()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const homeC = await homeSocket(third.user.id, third.token)
    await homeC.next('ready')

    expect((await post('/api/friends', { username: 'ninguem' }, owner.token)).status).toBe(404)
    expect((await post('/api/friends', { username: 'zeca' }, owner.token)).body).toBe('outgoing')
    expect((await homeC.next('friends')).friends).toEqual([expect.objectContaining({ state: 'incoming', user: expect.objectContaining({ username: 'lucas' }) })])
    expect((await post(`/api/friends/${owner.user.id}/accept`, {}, third.token)).status).toBe(200)
    expect((await homeA.next('friends', (m) => m.friends[0]?.state === 'friends')).friends[0].user.username).toBe('zeca')
    // Viraram amigos: cada um já recebe o status do outro.
    expect((await homeA.next('presence')).userId).toBe(third.user.id)

    homeC.send({ t: 'presence', status: 'idle', text: null })
    expect((await homeA.next('presence', (m) => m.presence.status === 'idle')).userId).toBe(third.user.id)
    homeC.close()
    expect((await homeA.next('presence', (m) => m.presence.status === 'offline')).userId).toBe(third.user.id)

    expect((await call('DELETE', `/api/friends/${third.user.id}`, undefined, owner.token)).status).toBe(200)
    expect((await homeA.next('friends', (m) => m.friends.length === 0)).friends).toEqual([])
  })

  it('invisível vale pros amigos mesmo com o app abrindo (e reconectando) como "online", e em todos os aparelhos', async () => {
    const { owner, third } = await strangers()
    await post('/api/friends', { username: 'zeca' }, owner.token)
    await post(`/api/friends/${owner.user.id}/accept`, {}, third.token)
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const phone = await homeSocket(third.user.id, third.token, { status: 'online' })
    await phone.next('ready')
    await homeA.next('presence', (m) => m.userId === third.user.id && m.presence.status === 'online')
    phone.send({ t: 'presence', status: 'invisible', text: null })
    await homeA.next('presence', (m) => m.userId === third.user.id && m.presence.status === 'offline')
    // O computador abre (o app manda "online" no auth, antes de saber o escolhido): continua invisível.
    const desktop = await homeSocket(third.user.id, third.token, { status: 'online' })
    expect((await desktop.next('ready')).presence.status).toBe('invisible')
    await homeA.nothing('presence', (m) => m.t === 'presence' && m.userId === third.user.id && m.presence.status !== 'offline')
    // Voltando pro online num aparelho, vale pros dois; o ausente automático de um só não conta.
    desktop.send({ t: 'presence', status: 'online', text: null })
    await homeA.next('presence', (m) => m.userId === third.user.id && m.presence.status === 'online')
    phone.send({ t: 'presence', status: 'idle', text: null, auto: true })
    await homeA.nothing('presence', (m) => m.t === 'presence' && m.userId === third.user.id && m.presence.status === 'idle')
  })

  it('pedido dos dois lados vira amizade direto', async () => {
    const { owner, third } = await strangers()
    await post('/api/friends', { username: 'zeca' }, owner.token)
    expect((await post('/api/friends', { username: 'lucas' }, third.token)).body).toBe('friends')
  })
})

describe('mensagens privadas', () => {
  it('abre a conversa, manda, chega pros dois e conta não lida', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const homeB = await homeSocket(friend.user.id, friend.token)
    await homeB.next('ready')

    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    const opened = await homeA.next('dm.channel', (m) => m.reqId === 'o')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    expect(opened.channel).toMatchObject({ id: channelId, user: { id: friend.user.id }, unread: 0 })

    homeA.send({ t: 'dm.send', channelId, content: 'oi, sumido', attachmentIds: [], nonce: 'n1' })
    expect((await homeA.next('dm.message')).nonce).toBe('n1')
    // Pra quem recebe, a conversa aparece antes da mensagem.
    expect((await homeB.next('dm.channel')).channel).toMatchObject({ id: channelId, unread: 1, user: { id: owner.user.id } })
    const got = await homeB.next('dm.message')
    expect(got.message.content).toBe('oi, sumido')

    homeB.send({ t: 'dm.history', reqId: 'h', channelId })
    expect((await homeB.next('dm.history')).messages.map((m) => m.content)).toEqual(['oi, sumido'])
    homeB.send({ t: 'dm.ack', channelId, messageId: got.message.id })
    expect(await homeB.next('dm.read')).toMatchObject({ channelId, unread: 0, lastReadId: got.message.id })

    homeB.send({ t: 'dm.react', channelId, id: got.message.id, emoji: '❤️', on: true })
    expect((await homeA.next('dm.reactions')).reactions).toEqual([{ emoji: '❤️', userIds: [friend.user.id] }])
    homeA.send({ t: 'dm.edit', channelId, id: got.message.id, content: 'oi, sumido!' })
    expect((await homeB.next('dm.edited')).message.content).toBe('oi, sumido!')
    homeB.send({ t: 'dm.delete', channelId, id: got.message.id })
    await homeB.nothing('dm.deleted') // não é dela
    homeA.send({ t: 'dm.delete', channelId, id: got.message.id })
    expect((await homeB.next('dm.deleted')).id).toBe(got.message.id)

    homeB.send({ t: 'dm.typing', channelId })
    expect((await homeA.next('dm.typing')).userId).toBe(friend.user.id)
  })

  it('quem não tem servidor em comum nem é amigo não recebe DM (padrão)', async () => {
    const { owner, third } = await strangers()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    homeA.send({ t: 'dm.open', userId: third.user.id, reqId: 'x' })
    expect((await homeA.next('error')).message).toMatch(/só recebe mensagem/)
    // Amigos podem.
    await post('/api/friends', { username: 'zeca' }, owner.token)
    await post(`/api/friends/${owner.user.id}/accept`, {}, third.token)
    homeA.send({ t: 'dm.open', userId: third.user.id, reqId: 'y' })
    expect((await homeA.next('dm.channel', (m) => m.reqId === 'y')).channel.user.id).toBe(third.user.id)
  })

  it('bloquear corta a conversa', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    expect((await call('PUT', `/api/blocks/${owner.user.id}`, undefined, friend.token)).status).toBe(200)
    homeA.send({ t: 'dm.send', channelId, content: 'oi?', attachmentIds: [], nonce: 'n' })
    expect((await homeA.next('error')).message).toMatch(/Não dá pra mandar/)
    const res = await upload(`/api/c/${encodeURIComponent(channelId)}/files`, owner.token, 'x', 'x.txt')
    expect(res.status).toBe(403)
  })

  it('anexo em conversa: só quem é da conversa envia, e o link é dela', async () => {
    const { owner, friend, guild } = await world()
    const homeB = await homeSocket(friend.user.id, friend.token)
    await homeB.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    // Conversa que ninguém abriu não aceita arquivo (nem chega a ser criada).
    expect((await upload(`/api/c/${encodeURIComponent(channelId)}/files`, owner.token, 'x', 'x.txt')).status).toBe(404)
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    const up = await upload(`/api/c/${encodeURIComponent(channelId)}/files`, owner.token, 'segredo', 's.txt')
    expect(up.status).toBe(200)
    expect(new TextDecoder().decode(await (await SELF.fetch(BASE + up.body.url)).arrayBuffer())).toBe('segredo')
    homeA.send({ t: 'dm.send', channelId, content: '', attachmentIds: [up.body.id], nonce: 'f' })
    expect((await homeB.next('dm.message')).message.attachments[0].name).toBe('s.txt')

    const third = await signup('zeca', await (async () => {
      const s = await guildSocket(guild.id, owner.token)
      await s.next('ready')
      return invite(s)
    })())
    expect((await upload(`/api/c/${encodeURIComponent(channelId)}/files`, third.token, 'x', 'x.txt')).status).toBe(404)
  })
})

describe('chamada privada', () => {
  it('liga, toca, atende, troca sinalização e desliga', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    const readyA = await homeA.next('ready')
    const homeB = await homeSocket(friend.user.id, friend.token)
    const readyB = await homeB.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')

    homeA.send({ t: 'call.ring', channelId, video: false })
    // Pra quem recebe, a conversa aparece na lista junto com a ligação.
    expect((await homeB.next('dm.channel')).channel.id).toBe(channelId)
    expect(await homeB.next('call.ringing')).toMatchObject({ channelId, from: owner.user.id })
    const ringing = await homeB.next('call.state')
    expect(ringing.ringing).toEqual([friend.user.id])
    expect(ringing.members.map((m) => m.connId)).toEqual([readyA.connId])

    homeB.send({ t: 'call.answer', channelId, accept: true })
    const both = await homeA.next('call.state', (m) => m.members.length === 2)
    expect(both.ringing).toEqual([])

    homeA.send({ t: 'call.signal', channelId, to: readyB.connId, data: { kind: 'watch' } })
    expect(await homeB.next('call.signal')).toEqual({ t: 'call.signal', channelId, from: readyA.connId, data: { kind: 'watch' } })

    // O Spotify de A aparece pros dois (limpo) e sai quando A tira.
    homeA.send({ t: 'call.update', channelId, muted: false, deafened: false, sharing: false, camera: false, music: { title: 'Lenda\u200b', artist: 'Sandy', playing: true } })
    const music = await homeB.next('call.state', (m) => m.members.some((x) => !!x.music))
    expect(music.members.find((x) => x.connId === readyA.connId)?.music).toEqual({ title: 'Lenda', artist: 'Sandy', playing: true })
    homeA.send({ t: 'call.update', channelId, muted: false, deafened: false, sharing: false, camera: false, music: null })
    await homeB.next('call.state', (m) => !m.members.some((x) => x.music))

    homeB.send({ t: 'call.hangup', channelId })
    await homeA.next('call.state', (m) => m.members.length === 1)
    homeA.send({ t: 'call.hangup', channelId })
    await homeB.next('call.ended')
  })

  it('sinalização em laço acaba a chamada pros dois, e dá pra ligar de novo', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const homeB = await homeSocket(friend.user.id, friend.token)
    const readyB = await homeB.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    homeA.send({ t: 'call.ring', channelId, video: false })
    await homeB.next('call.ringing')
    homeB.send({ t: 'call.answer', channelId, accept: true })
    await homeA.next('call.state', (m) => m.members.length === 2)

    // Até o limite, tudo passa (uma chamada normal manda bem menos que isso).
    for (let i = 0; i < 300; i++) homeA.send({ t: 'call.signal', channelId, to: readyB.connId, data: { kind: 'watch' } })
    for (let i = 0; i < 300; i++) await homeB.next('call.signal')
    await homeB.nothing('call.ended')
    homeA.send({ t: 'call.signal', channelId, to: readyB.connId, data: { kind: 'watch' } })
    expect((await homeA.next('error')).message).toBe('A chamada teve um problema e foi encerrada. Liguem de novo.')
    await homeA.next('call.ended')
    await homeB.next('call.ended')

    // O que ainda chega depois não passa adiante, e uma ligação nova começa do zero.
    homeB.drain()
    homeA.send({ t: 'call.signal', channelId, to: readyB.connId, data: { kind: 'watch' } })
    await homeB.nothing('call.signal')
    homeA.send({ t: 'call.ring', channelId, video: false })
    await homeB.next('call.ringing')
    homeB.send({ t: 'call.answer', channelId, accept: true })
    await homeA.next('call.state', (m) => m.members.length === 2)
    homeA.send({ t: 'call.signal', channelId, to: readyB.connId, data: { kind: 'watch' } })
    await homeB.next('call.signal')
  })

  it('quem conecta depois vê a ligação tocando no ready (o celular depois do push)', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    homeA.send({ t: 'call.ring', channelId, video: false, state: { muted: true, deafened: false } })
    const state = await homeA.next('call.state')
    // Entrou mutado: os outros já veem certo.
    expect(state.members[0]).toMatchObject({ muted: true })
    const homeB = await homeSocket(friend.user.id, friend.token)
    const ready = await homeB.next('ready')
    expect(ready.calls).toEqual([expect.objectContaining({ channelId, ringing: [friend.user.id] })])
    // "Ligar" na conversa que está tocando é o mesmo que atender: sai do "tocando".
    homeB.send({ t: 'call.ring', channelId, video: false })
    const both = await homeA.next('call.state', (m) => m.members.length === 2)
    expect(both.ringing).toEqual([])
  })

  it('quem desligou enquanto estava sem conexão não volta pra ligação ao reconectar', async () => {
    const { owner, friend } = await world()
    const key = 'chave-de-teste-do-app-b'
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const homeB = await homeSocket(friend.user.id, friend.token, { key })
    await homeB.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    homeA.send({ t: 'call.ring', channelId, video: false })
    await homeB.next('call.ringing')
    homeB.send({ t: 'call.answer', channelId, accept: true })
    await homeA.next('call.state', (m) => m.members.length === 2)
    // B cai, desliga no app (o pedido não chega) e volta sem estar em chamada nenhuma.
    homeB.drop()
    const back = await homeSocket(friend.user.id, friend.token, { key })
    expect((await back.next('ready')).resumed).toBe(false)
    await homeA.next('call.state', (m) => m.members.length === 1)
  })

  it('cair da conexão sai da chamada', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const homeB = await homeSocket(friend.user.id, friend.token)
    await homeB.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    homeA.send({ t: 'call.ring', channelId, video: false })
    await homeB.next('call.ringing')
    homeA.close()
    await homeB.next('call.ended')
  })
})
