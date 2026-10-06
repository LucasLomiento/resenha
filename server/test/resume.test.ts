import { describe, expect, it } from 'vitest'
import { dmChannelId } from '../../shared/protocol'
import { guildSocket, homeSocket, tick, world } from './helpers'

// Nos testes a espera por quem caiu é de 400 ms (RESUME_GRACE_MS no vitest.config).
const GRACE = 400
const KEY_A = 'chave-do-app-do-lucas-1'
const KEY_B = 'chave-do-app-do-duarte-1'

/** Lucas e Duarte na call do servidor, com conexões que têm chave (o app de verdade). */
async function inCall() {
  const w = await world()
  // As conexões do world() não têm chave (e o Duarte fica só com a dele, pra presença valer).
  w.b.close()
  const a = await guildSocket(w.guild.id, w.owner.token, { key: KEY_A })
  const readyA = await a.next('ready')
  const b = await guildSocket(w.guild.id, w.friend.token, { key: KEY_B })
  const readyB = await b.next('ready')
  a.send({ t: 'voice.join', channelId: w.voice.id, muted: false, deafened: false })
  b.send({ t: 'voice.join', channelId: w.voice.id, muted: false, deafened: false })
  await a.next('voice.state', (m) => m.members.length === 2)
  b.send({ t: 'voice.update', muted: false, deafened: false, sharing: true, camera: false })
  await a.next('voice.state', (m) => m.members.some((x) => x.connId === readyB.connId && x.sharing))
  a.drain()
  return { ...w, a, b, readyA, readyB }
}

/** Filtro de voice.state/call.state sem essa conexão (serve pro `next` e pro `nothing`). */
const without =
  (connId: string) =>
  (m: any): boolean =>
    !m.members?.some((x: { connId: string }) => x.connId === connId)
/** Mensagem de presença dessa pessoa. */
const presenceOf = (userId: string) => (m: any) => m.t === 'presence' && m.userId === userId

describe('reconexão na call do servidor', () => {
  it('caiu sem avisar: continua na call, volta com o mesmo connId e recebe o que chegou no meio-tempo', async () => {
    const { guild, friend, a, b, readyA, readyB } = await inCall()
    b.drop()
    await tick(60)
    a.send({ t: 'rtc.signal', to: readyB.connId, data: { kind: 'watch', pc: 'p1', ack: 'p2' } })
    // Pros outros nada mudou: não saiu da call nem ficou offline.
    await a.nothing('voice.state', without(readyB.connId))
    await a.nothing('presence', presenceOf(friend.user.id))

    const back = await guildSocket(guild.id, friend.token, { key: KEY_B })
    const ready = await back.next('ready')
    expect(ready.connId).toBe(readyB.connId)
    expect(ready.resumed).toBe(true)
    // Continua transmitindo: quem assiste não precisa clicar de novo.
    expect(ready.voice.find((m) => m.connId === readyB.connId)).toMatchObject({ sharing: true })
    expect(await back.next('rtc.signal')).toMatchObject({ from: readyA.connId, data: { kind: 'watch', pc: 'p1', ack: 'p2' } })

    // Passou o tempo de espera e ninguém viu ele sair.
    await tick(GRACE + 100)
    await a.nothing('voice.state', without(readyB.connId))
    // A sinalização volta a ir direto pra conexão nova.
    a.send({ t: 'rtc.signal', to: readyB.connId, data: { kind: 'unwatch' } })
    expect((await back.next('rtc.signal')).data).toMatchObject({ kind: 'unwatch' })
  })

  it('não voltou a tempo: sai da call e fica offline', async () => {
    const { friend, a, b, readyB } = await inCall()
    b.drop()
    await a.nothing('voice.state', without(readyB.connId))
    const left = await a.next('voice.state', without(readyB.connId))
    expect(left.members).toHaveLength(1)
    expect(await a.next('presence', (m) => m.userId === friend.user.id)).toMatchObject({ online: false })
  })

  it('conexão que parece aberta mas morreu: a nova, com a mesma chave, toma o lugar dela', async () => {
    const { guild, friend, a, b, readyA, readyB } = await inCall()
    const back = await guildSocket(guild.id, friend.token, { key: KEY_B })
    const ready = await back.next('ready')
    expect(ready).toMatchObject({ connId: readyB.connId, resumed: true })
    expect(await b.closed()).toBe(4005)
    await a.nothing('voice.state', without(readyB.connId))
    await a.nothing('presence', presenceOf(friend.user.id))
    a.send({ t: 'rtc.signal', to: readyB.connId, data: { kind: 'watch' } })
    expect(await back.next('rtc.signal')).toMatchObject({ from: readyA.connId })
  })

  it('a chave de outra pessoa não dá o connId dela', async () => {
    const { guild, friend, a, readyA } = await inCall()
    const thief = await guildSocket(guild.id, friend.token, { key: KEY_A })
    const ready = await thief.next('ready')
    expect(ready.connId).not.toBe(readyA.connId)
    expect(ready.resumed).toBe(false)
    a.send({ t: 'rtc.signal', to: readyA.connId, data: { kind: 'watch' } })
    await thief.nothing('rtc.signal')
    await a.nothing('voice.state')
  })

  it('fechar de propósito sai da call na hora', async () => {
    const { a, b, readyB } = await inCall()
    const start = Date.now()
    b.close()
    await a.next('voice.state', without(readyB.connId))
    expect(Date.now() - start).toBeLessThan(GRACE)
  })

  it('confirmar a mesma call depois de voltar não derruba a tela', async () => {
    const { guild, friend, a, b, voice, readyB } = await inCall()
    b.drop()
    const back = await guildSocket(guild.id, friend.token, { key: KEY_B })
    await back.next('ready')
    back.send({ t: 'voice.join', channelId: voice.id, muted: true, deafened: false })
    const state = await a.next('voice.state', (m) => m.members.some((x) => x.connId === readyB.connId && x.muted))
    expect(state.members.find((x) => x.connId === readyB.connId)).toMatchObject({ sharing: true })
  })

  it('servidor perdeu a call (reiniciou): o app volta já transmitindo, numa mensagem só', async () => {
    const { guild, friend, a, voice } = await inCall()
    const fresh = await guildSocket(guild.id, friend.token, { key: 'chave-de-outra-instancia-1' })
    const ready = await fresh.next('ready')
    a.drain()
    fresh.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false, sharing: true, camera: true })
    const state = await a.next('voice.state', (m) => m.members.some((x) => x.connId === ready.connId))
    expect(state.members.find((x) => x.connId === ready.connId)).toMatchObject({ sharing: true, camera: true })
  })

  it('moderador tira da call quem caiu: some na hora, e o aviso chega quando o app volta', async () => {
    const { guild, friend, a, b, readyB } = await inCall()
    b.drop()
    await tick(60)
    a.send({ t: 'member.voice', userId: friend.user.id, disconnect: true })
    await a.next('voice.state', without(readyB.connId))
    const back = await guildSocket(guild.id, friend.token, { key: KEY_B })
    expect((await back.next('ready')).resumed).toBe(false)
    expect(await back.next('voice.forced')).toMatchObject({ channelId: null })
  })

  it('canal apagado enquanto estava fora: volta fora da call', async () => {
    const { guild, friend, a, b, readyB, readyA } = await inCall()
    a.send({ t: 'channel.create', name: 'Outro', kind: 'voice' })
    const other = (await a.next('channel.upsert', (m) => m.channel.name === 'Outro')).channel
    b.drop()
    await tick(60)
    a.send({ t: 'voice.join', channelId: other.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.some((x) => x.connId === readyA.connId && x.channelId === other.id))
    const call = readyA.channels.find((c) => c.kind === 'voice')!
    a.send({ t: 'channel.delete', id: call.id })
    await a.next('voice.state', without(readyB.connId))
    const back = await guildSocket(guild.id, friend.token, { key: KEY_B })
    const ready = await back.next('ready')
    expect(ready.resumed).toBe(false)
    expect(ready.voice.some((m) => m.connId === readyB.connId)).toBe(false)
  })
})

describe('reconexão na chamada privada', () => {
  async function dmCall() {
    const w = await world()
    const channelId = dmChannelId(w.owner.user.id, w.friend.user.id)
    const homeA = await homeSocket(w.owner.user.id, w.owner.token, { key: KEY_A })
    const readyA = await homeA.next('ready')
    const homeB = await homeSocket(w.friend.user.id, w.friend.token, { key: KEY_B })
    const readyB = await homeB.next('ready')
    homeA.send({ t: 'dm.open', userId: w.friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    homeA.send({ t: 'call.ring', channelId, video: false })
    await homeB.next('call.ringing')
    homeB.send({ t: 'call.answer', channelId, accept: true })
    await homeA.next('call.state', (m) => m.members.length === 2)
    homeA.drain()
    return { ...w, channelId, homeA, homeB, readyA, readyB }
  }

  it('caiu sem avisar: a chamada continua e ele volta nela', async () => {
    const { friend, channelId, homeA, homeB, readyA, readyB } = await dmCall()
    homeB.drop()
    await tick(60)
    homeA.send({ t: 'call.signal', channelId, to: readyB.connId, data: { kind: 'watch' } })
    await homeA.nothing('call.state')
    await homeA.nothing('call.ended')

    const back = await homeSocket(friend.user.id, friend.token, { key: KEY_B, call: channelId })
    const ready = await back.next('ready')
    expect(ready).toMatchObject({ connId: readyB.connId, resumed: true })
    expect(ready.call?.members.map((m) => m.connId).sort()).toEqual([readyA.connId, readyB.connId].sort())
    expect(await back.next('call.signal')).toMatchObject({ from: readyA.connId, data: { kind: 'watch' } })

    // Continua podendo mexer na chamada.
    back.send({ t: 'call.update', channelId, muted: true, deafened: false, sharing: false, camera: false })
    await homeA.next('call.state', (m) => m.members.some((x) => x.connId === readyB.connId && x.muted))
    await tick(GRACE + 100)
    await homeA.nothing('call.state', (m: any) => m.members.length < 2)
  })

  it('voltando sem a chamada ter guardado a conexão: entra como estava, sem tocar de novo', async () => {
    const { friend, channelId, homeA, homeB, readyB } = await dmCall()
    homeB.close()
    await homeA.next('call.state', without(readyB.connId))
    const back = await homeSocket(friend.user.id, friend.token, { key: KEY_B, call: channelId })
    const ready = await back.next('ready')
    expect(ready.resumed).toBe(false)
    expect(ready.call?.members).toHaveLength(1)
    back.send({ t: 'call.answer', channelId, accept: true, state: { muted: true, deafened: false, sharing: true, camera: false } })
    const state = await homeA.next('call.state', (m) => m.members.length === 2)
    expect(state.members.find((m) => m.connId === readyB.connId)).toMatchObject({ muted: true, sharing: true })
    await homeA.nothing('call.ringing')
  })

  it('não voltou a tempo: sai da chamada', async () => {
    const { homeA, homeB, readyB } = await dmCall()
    homeB.drop()
    await homeA.nothing('call.state')
    const after = await homeA.next('call.state')
    expect(after.members.some((m) => m.connId === readyB.connId)).toBe(false)
  })

  it('voltou depois que a chamada acabou: o ready avisa e não volta a tocar', async () => {
    const { friend, channelId, homeA, homeB } = await dmCall()
    homeB.drop()
    homeA.send({ t: 'call.hangup', channelId })
    await homeA.next('call.ended')
    await tick(GRACE + 100)
    const back = await homeSocket(friend.user.id, friend.token, { key: KEY_B, call: channelId })
    const ready = await back.next('ready')
    expect(ready.resumed).toBe(false)
    expect(ready.call).toBeNull()
    await homeA.nothing('call.ringing')
  })
})
