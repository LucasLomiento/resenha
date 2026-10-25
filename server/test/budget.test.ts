import { SELF, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { dmChannelId } from '../../shared/protocol'
import { LIMITS, REQUEST, SignalTally, merge, spend } from '../src/budget'
import { BASE, call, homeSocket, world } from './helpers'

const MINUTE = 60_000

/** Orçamento de uma conexão quase no fim da janela de 10 min (a próxima mensagem cara não cabe). */
const nearlySpent = (now: number) => [now, LIMITS[0].max - 1, now, LIMITS[0].max - 1, now, LIMITS[0].max - 1]

type Incident = { at: number; userId: string | null; kind: string; detail: string | null }

const incidents = async (token: string): Promise<Incident[]> =>
  (await call<{ incidents: Incident[] }>('GET', '/api/admin', undefined, token)).body.incidents

/** O incidente vai pro Directory sem esperar (waitUntil): espera ele aparecer. */
async function incidentOf(token: string, kind: string): Promise<Incident> {
  for (let i = 0; i < 40; i++) {
    const found = (await incidents(token)).find((x) => x.kind === kind)
    if (found) return found
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`sem incidente ${kind}`)
}

describe('orçamento (budget.ts)', () => {
  it('gasta até o teto de cada janela, zera quando a janela passa e deixa o essencial passar', () => {
    const t0 = 1_000_000
    let { spent, over } = spend(undefined, 10, t0, false, [{ window: MINUTE, max: 25 }])
    expect(over).toBe(-1)
    ;({ spent, over } = spend(spent, 10, t0 + 1, false, [{ window: MINUTE, max: 25 }]))
    expect(over).toBe(-1)
    ;({ spent, over } = spend(spent, 10, t0 + 2, false, [{ window: MINUTE, max: 25 }]))
    expect(over).toBe(0)
    expect(spent[1]).toBe(20)
    // Sair da call conta, mas passa.
    ;({ spent, over } = spend(spent, 10, t0 + 3, true, [{ window: MINUTE, max: 25 }]))
    expect(over).toBe(0)
    expect(spent[1]).toBe(30)
    ;({ spent, over } = spend(spent, 10, t0 + MINUTE, false, [{ window: MINUTE, max: 25 }]))
    expect(over).toBe(-1)
    expect(spent).toEqual([t0 + MINUTE, 10])
  })

  it('quem volta herda o maior gasto', () => {
    expect(merge([5, 100, 5, 300], [9, 150, 9, 200])).toEqual([5, 150, 5, 300])
    expect(merge(undefined, [1, 2])).toEqual([1, 2])
  })

  it('a contagem da sinalização só tem tipos e quantos ids, nada do conteúdo', () => {
    const tally = new SignalTally()
    const now = 1_000_000
    for (let i = 0; i < 3; i++) {
      tally.add({ kind: 'description', description: { type: 'offer', sdp: 'v=0 segredo' }, pc: `p${i}`, ack: 'x' }, now)
      tally.add({ kind: 'candidate', candidate: { candidate: 'candidate:1 1 udp 1 192.168.0.9 5000 typ host' }, pc: `p${i}` }, now)
    }
    tally.add({ kind: 'description', description: { type: 'answer' } }, now + 2000)
    const detail = tally.detail(now + 4000)
    expect(detail).toBe('7 em 4s: description=4 candidate=3 (offer=3 answer=1); pc=3 ack=1')
    expect(detail).not.toMatch(/192\.168|segredo/)
  })
})

describe('freios no Home', () => {
  it('chamada privada em laço: o incidente diz que sinalização era (contagens e ids, sem conteúdo)', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token, { version: '1.17.0', platform: 'linux' })
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

    for (let i = 0; i < 301; i++) {
      const offer = i % 3 === 0
      homeA.send({
        t: 'call.signal',
        channelId,
        to: readyB.connId,
        data: offer
          ? { kind: 'description', description: { type: 'offer', sdp: 'v=0 nada' }, streams: {}, pc: 'b', ack: 'x' }
          : { kind: 'candidate', candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.1 9 typ host' }, pc: 'a' },
      })
    }
    await homeA.next('call.ended')
    const incident = await incidentOf(owner.token, 'home:signal-loop')
    expect(incident.userId).toBe(owner.user.id)
    expect(incident.detail).toMatch(/^1\.17\.0; 301 em \d+s: candidate=200 description=101 \(offer=101\); pc=2 ack=1$/)
    expect(incident.detail).not.toMatch(/10\.0\.0\.1|v=0/)
  })

  it('orçamento estourado: a mensagem é ignorada, avisa e anota; o app novo pausa (4008) nas janelas longas', async () => {
    const { owner, friend } = await world()
    const old = await homeSocket(owner.user.id, owner.token)
    const readyOld = await old.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    old.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await old.next('dm.channel')

    const stub = env.HOME.get(env.HOME.idFromName(owner.user.id))
    await runInDurableObject(stub, (instance) => {
      ;(instance as unknown as { spentByConn: Map<string, number[]> }).spentByConn.set(readyOld.connId, nearlySpent(Date.now()))
    })
    // App antigo (sem versão): só ignora. A conversa não recebe nada.
    old.send({ t: 'dm.send', channelId, content: 'oi', attachmentIds: [], nonce: 'n1' })
    expect((await old.next('error')).message).toBe('Muita coisa em pouco tempo. Espere uns minutos.')
    await old.nothing('dm.message')
    expect((await incidentOf(owner.token, 'home:budget-10min')).userId).toBe(owner.user.id)

    // App novo estourando a janela de 1 h: fecha com 4008 (pausa).
    const fresh = await homeSocket(owner.user.id, owner.token, { version: '1.17.0', platform: 'linux' })
    const readyFresh = await fresh.next('ready')
    await runInDurableObject(stub, (instance) => {
      const now = Date.now()
      ;(instance as unknown as { spentByConn: Map<string, number[]> }).spentByConn.set(readyFresh.connId, [
        now,
        0,
        now,
        LIMITS[1].max - 1,
        now,
        LIMITS[1].max - 1,
      ])
    })
    fresh.send({ t: 'dm.send', channelId, content: 'oi', attachmentIds: [], nonce: 'n2' })
    expect(await fresh.closed()).toBe(4008)
  })

  it('"digitando…" mais seguido que o app manda não passa adiante', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const homeB = await homeSocket(friend.user.id, friend.token)
    await homeB.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    homeA.send({ t: 'dm.typing', channelId })
    await homeB.next('dm.typing')
    for (let i = 0; i < 5; i++) homeA.send({ t: 'dm.typing', channelId })
    await homeB.nothing('dm.typing')
  })

  it('o app manda incidente (um a cada 10 min, só os tipos conhecidos) e a versão aparece em Contas', async () => {
    const { owner } = await world()
    const home = await homeSocket(owner.user.id, owner.token, { version: '1.17.0', platform: 'windows' })
    await home.next('ready')
    home.send({ t: 'incident', kind: 'nada' as never, detail: 'x' })
    home.send({ t: 'incident', kind: 'signal-loop', detail: 'description=40 candidate=250; pc=37' })
    home.send({ t: 'incident', kind: 'signal-loop', detail: 'de novo' })
    await home.nothing('error')
    const list = await incidents(owner.token)
    expect(list.map((i) => [i.kind, i.detail])).toEqual([['app:signal-loop', '1.17.0; description=40 candidate=250; pc=37']])

    const users = await call<{ username: string; appVersion: string | null; platform: string | null }[]>(
      'GET',
      '/api/admin/users',
      undefined,
      owner.token,
    )
    expect(users.body.find((u) => u.username === 'lucas')).toMatchObject({ appVersion: '1.17.0', platform: 'windows' })
    expect(users.body.find((u) => u.username === 'duarte')).toMatchObject({ appVersion: null, platform: null })
  })

  it('a varredura fica espaçada sem chamada e volta pra 1 min com alguém numa', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const stub = env.HOME.get(env.HOME.idFromName(owner.user.id))
    const nextAlarm = async () => {
      await runDurableObjectAlarm(stub)
      return (await runInDurableObject(stub, (_, state) => state.storage.getAlarm()))! - Date.now()
    }
    expect(await nextAlarm()).toBeGreaterThan(4 * MINUTE)

    const homeB = await homeSocket(friend.user.id, friend.token)
    await homeB.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    homeA.send({ t: 'call.ring', channelId, video: false })
    await homeA.next('call.state')
    const inCall = await nextAlarm()
    expect(inCall).toBeLessThanOrEqual(MINUTE)
    expect(inCall).toBeGreaterThan(0)
  })
})

describe('freios no Guild', () => {
  it('call em laço de sinalização: a conexão sai da call, os outros veem, e fica anotado', async () => {
    const { owner, a, b, readyB, voice } = await world()
    a.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await b.next('voice.state', (m) => m.members.length === 1)
    b.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.length === 2)

    for (let i = 0; i < 301; i++) a.send({ t: 'rtc.signal', to: readyB.connId, data: { kind: 'watch' } })
    expect(await a.next('voice.forced')).toEqual({ t: 'voice.forced', channelId: null })
    expect((await a.next('error')).message).toBe('A call teve um problema e você saiu dela. Entre de novo.')
    await b.next('voice.state', (m) => m.members.length === 1)
    const incident = await incidentOf(owner.token, 'guild:signal-loop')
    expect(incident.detail).toMatch(/app antigo; 301 em \d+s: watch=301; pc=0 ack=0$/)

    // Fora da call, o que ainda chega não passa adiante.
    b.drain()
    a.send({ t: 'rtc.signal', to: readyB.connId, data: { kind: 'watch' } })
    await b.nothing('rtc.signal')
  })

  it('a varredura fica espaçada sem ninguém na call', async () => {
    const { guild, a, voice } = await world()
    const stub = env.GUILD.get(env.GUILD.idFromName(guild.id))
    const nextAlarm = async () => {
      await runDurableObjectAlarm(stub)
      return (await runInDurableObject(stub, (_, state) => state.storage.getAlarm()))! - Date.now()
    }
    expect(await nextAlarm()).toBeGreaterThan(4 * MINUTE)
    a.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.length === 1)
    expect(await nextAlarm()).toBeLessThanOrEqual(MINUTE)
  })

  it('castigo curto acaba na hora mesmo com a varredura espaçada', async () => {
    const { guild, a, friend } = await world()
    const stub = env.GUILD.get(env.GUILD.idFromName(guild.id))
    // Primeiro a varredura fica espaçada (ninguém na call)…
    await runDurableObjectAlarm(stub)
    a.send({ t: 'member.timeout', userId: friend.user.id, minutes: 1, reason: '' })
    await a.next('member.upsert', (m) => m.member.userId === friend.user.id && !!m.member.timeoutUntil)
    const at = (await runInDurableObject(stub, (_, state) => state.storage.getAlarm()))!
    expect(at - Date.now()).toBeLessThanOrEqual(MINUTE)
  })
})

describe('reconexão em rajada', () => {
  it('o Worker segura quem abre WebSocket sem parar, sem acordar nenhum Durable Object', async () => {
    const { owner } = await world()
    const statuses: number[] = []
    for (let i = 0; i < 25; i++) {
      const res = await SELF.fetch(`${BASE}/api/home/${owner.user.id}/ws`, { headers: { Upgrade: 'websocket' } })
      statuses.push(res.status)
      res.webSocket?.accept()
      res.webSocket?.close(1000)
    }
    // 20 por minuto por IP e destino; o resto nem chega no Home.
    expect(statuses.filter((s) => s === 101)).toHaveLength(20)
    expect(statuses.slice(20)).toEqual([429, 429, 429, 429, 429])
  })

  it('o Home recusa conexão nova de quem reconecta sem parar (mesmo vindo de vários IPs)', async () => {
    const { owner } = await world()
    // Direto no objeto: o limite do Worker é por IP, este é da pessoa.
    const stub = env.HOME.get(env.HOME.idFromName(owner.user.id))
    let refused = 0
    for (let i = 0; i < 45; i++) {
      const res = await stub.fetch(`${BASE}/api/home/${owner.user.id}/ws`, {
        headers: { Upgrade: 'websocket', 'X-Resenha-Home': owner.user.id, 'X-Resenha-Ip': `ip-${i}` },
      })
      if (res.status === 429) refused++
      res.webSocket?.accept()
      res.webSocket?.close(1000)
    }
    expect(refused).toBe(5)
    await incidentOf(owner.token, 'home:reconnect')
  })

  it('o Guild recusa conexão nova do mesmo IP sem parar', async () => {
    const { owner, guild } = await world()
    // Direto no objeto: o limite do Worker (por IP e destino) seguraria antes.
    const stub = env.GUILD.get(env.GUILD.idFromName(guild.id))
    let refused = 0
    for (let i = 0; i < 65; i++) {
      const res = await stub.fetch(`https://resenha.test/api/g/${guild.id}/ws`, {
        headers: { Upgrade: 'websocket', 'X-Resenha-Ip': 'ip-de-teste' },
      })
      if (res.status === 429) refused++
      res.webSocket?.accept()
      res.webSocket?.close(1000)
    }
    expect(refused).toBeGreaterThan(0)
    await incidentOf(owner.token, 'guild:reconnect')
  })
})

describe('custos', () => {
  it('um pedido vale 20 mensagens', () => {
    expect(REQUEST).toBe(20)
  })
})
