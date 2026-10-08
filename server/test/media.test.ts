import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { MAX_USAGE_REPORT, MEDIA_BUDGET, Sfu, SfuError, cleanLocalTracks, cleanRemoteTracks, cleanSdp, measuredUsage, monthChunks, sessionToken, usageMonth, validToken } from '../src/media'
import { call, signup } from './helpers'

const CONFIG = { appId: 'app123', secret: 'segredo-do-app' }
const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n'

/** fetch de mentira: guarda os pedidos e responde o que o teste mandar. */
function fakeFetch(reply: (url: string, body: any) => { status?: number; json: unknown }) {
  const calls: { url: string; method: string; auth: string | null; body: any }[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('Authorization'), body })
    const { status = 200, json } = reply(url, body)
    return new Response(JSON.stringify(json), { status })
  }) as typeof fetch
  return { impl, calls }
}

describe('SFU: cliente da API do Cloudflare', () => {
  it('cria sessão, publica e puxa faixas com a chave do app', async () => {
    const { impl, calls } = fakeFetch((url, body) => {
      if (url.endsWith('/sessions/new')) return { json: { sessionId: 'sess-1' } }
      if (body?.tracks?.[0]?.location === 'local') return { json: { sessionDescription: { type: 'answer', sdp: 'v=0 resposta' }, tracks: [{ mid: '0', trackName: 'screen-video' }] } }
      return { json: { requiresImmediateRenegotiation: true, sessionDescription: { type: 'offer', sdp: 'v=0 oferta' }, tracks: [{ mid: '1', trackName: 'screen-video' }] } }
    })
    const sfu = new Sfu(CONFIG, impl)
    expect(await sfu.newSession()).toBe('sess-1')
    expect(await sfu.push('sess-1', OFFER, [{ mid: '0', trackName: 'screen-video' }])).toEqual({ sdp: 'v=0 resposta' })
    expect(await sfu.pull('sess-2', [{ sessionId: 'sess-1', trackName: 'screen-video' }])).toEqual({ sdp: 'v=0 oferta', tracks: [{ mid: '1', trackName: 'screen-video' }] })
    expect(calls.map((c) => [c.method, c.url.replace('https://rtc.live.cloudflare.com/v1/apps/app123', '')])).toEqual([
      ['POST', '/sessions/new'],
      ['POST', '/sessions/sess-1/tracks/new'],
      ['POST', '/sessions/sess-2/tracks/new'],
    ])
    expect(calls.every((c) => c.auth === 'Bearer segredo-do-app')).toBe(true)
    expect(calls[1].body).toEqual({ sessionDescription: { type: 'offer', sdp: OFFER }, tracks: [{ location: 'local', mid: '0', trackName: 'screen-video' }] })
    expect(calls[2].body).toEqual({ tracks: [{ location: 'remote', sessionId: 'sess-1', trackName: 'screen-video' }] })
  })

  it('renegocia e fecha faixas', async () => {
    const { impl, calls } = fakeFetch(() => ({ json: {} }))
    const sfu = new Sfu(CONFIG, impl)
    await sfu.renegotiate('s', 'v=0 resposta')
    await sfu.close('s', ['0', '1'])
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { sessionDescription: { type: 'answer', sdp: 'v=0 resposta' } } })
    expect(calls[1]).toMatchObject({ method: 'PUT', body: { tracks: [{ mid: '0' }, { mid: '1' }], force: true } })
  })

  it('erro do Cloudflare (no status ou na faixa) vira SfuError com a mensagem', async () => {
    const down = new Sfu(CONFIG, fakeFetch(() => ({ status: 503, json: { errorCode: 'x', errorDescription: 'fora' } })).impl)
    await expect(down.newSession()).rejects.toBeInstanceOf(SfuError)
    const refused = new Sfu(CONFIG, fakeFetch(() => ({ json: { tracks: [{ errorCode: 'not_found', errorDescription: 'faixa não existe' }] } })).impl)
    await expect(refused.pull('s', [{ sessionId: 'o', trackName: 'x' }])).rejects.toThrow('faixa não existe')
  })
})

describe('SFU: o que vem do app', () => {
  it('token: só vale pra mesma pessoa e a mesma sessão', async () => {
    const token = await sessionToken('segredo', 'lucas', 'sess-1')
    expect(await validToken('segredo', 'lucas', 'sess-1', token)).toBe(true)
    expect(await validToken('segredo', 'duarte', 'sess-1', token)).toBe(false)
    expect(await validToken('segredo', 'lucas', 'sess-2', token)).toBe(false)
    expect(await validToken('segredo', 'lucas', 'sess-1', 123)).toBe(false)
  })

  it('confere SDP e faixas', () => {
    expect(cleanSdp(OFFER)).toBe(OFFER)
    expect(cleanSdp('oi')).toBeNull()
    expect(cleanSdp(`v=0${'x'.repeat(70_000)}`)).toBeNull()
    expect(cleanLocalTracks([{ mid: '0', trackName: 'screen-video' }])).toEqual([{ mid: '0', trackName: 'screen-video' }])
    expect(cleanLocalTracks([{ mid: '0', trackName: 'nome com espaço' }])).toBeNull()
    expect(cleanLocalTracks([])).toBeNull()
    expect(cleanRemoteTracks([{ sessionId: '../x', trackName: 'a' }])).toBeNull()
    expect(cleanRemoteTracks([{ sessionId: 'abc', trackName: 'a' }])).toEqual([{ sessionId: 'abc', trackName: 'a' }])
  })
})

describe('Cota de mídia do mês', () => {
  it('sem o SFU configurado: o app fica sabendo e a tela segue P2P', async () => {
    const me = await signup('lucas')
    const status = await call('GET', '/api/media', undefined, me.token)
    expect(status.body).toMatchObject({ sfu: false, used: 0, limit: MEDIA_BUDGET })
    expect((await call('POST', '/api/media/sessions', {}, me.token)).status).toBe(503)
    expect((await call('GET', '/api/media')).status).toBe(401)
  })

  it('os apps somam o que passou pelo Cloudflare; relatório gigante é cortado', async () => {
    const me = await signup('lucas')
    await call('POST', '/api/media/usage', { bytes: 2e9 }, me.token)
    await call('POST', '/api/media/usage', { bytes: 1e12 }, me.token)
    await call('POST', '/api/media/usage', { bytes: -5 }, me.token)
    expect((await call('GET', '/api/media', undefined, me.token)).body.used).toBe(2e9 + MAX_USAGE_REPORT)
  })

  it('passou da cota: o servidor para de oferecer o TURN e o SFU', async () => {
    const me = await signup('lucas')
    const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'))
    await runInDurableObject(dir, (_, state) => {
      state.storage.sql.exec('INSERT INTO media_usage (month, bytes) VALUES (?, ?)', usageMonth(), MEDIA_BUDGET)
    })
    const status = await call('GET', '/api/media', undefined, me.token)
    expect(status.body).toMatchObject({ sfu: false, turn: false, used: MEDIA_BUDGET })
    expect((await call('POST', '/api/media/usage', { bytes: 1 }, me.token)).body).toEqual({ allowed: false })
    const ice = await call('GET', '/api/ice', undefined, me.token)
    expect(JSON.stringify(ice.body.iceServers)).not.toContain('turn:')
  })
})

describe('O que o Cloudflare mediu', () => {
  it('o mês vira pedaços de até 7 dias, do dia 1 até hoje', () => {
    expect(monthChunks(Date.parse('2026-10-01T03:00:00Z'))).toEqual([{ from: '2026-10-01', to: '2026-10-01' }])
    expect(monthChunks(Date.parse('2026-10-31T23:00:00Z'))).toEqual([
      { from: '2026-10-01', to: '2026-10-07' },
      { from: '2026-10-08', to: '2026-10-14' },
      { from: '2026-10-15', to: '2026-10-21' },
      { from: '2026-10-22', to: '2026-10-28' },
      { from: '2026-10-29', to: '2026-10-31' },
    ])
  })

  it('soma a saída do SFU e do TURN de todos os pedaços', async () => {
    const { impl, calls } = fakeFetch(() => ({
      json: {
        data: { viewer: { accounts: [{ sfu0: [{ sum: { egressBytes: 5e9 } }], turn0: [{ sum: { egressBytes: 2e9 } }], sfu1: [{ sum: { egressBytes: 1e9 } }], turn1: [] }] } },
        errors: null,
      },
    }))
    const total = await measuredUsage({ accountId: 'conta', token: 'leitura' }, Date.parse('2026-10-09T12:00:00Z'), impl)
    expect(total).toBe(8e9)
    expect(calls[0].auth).toBe('Bearer leitura')
    expect(calls[0].body.variables).toEqual({ account: 'conta' })
    expect(calls[0].body.query).toContain('sfu1: callsUsageAdaptiveGroups(limit: 1, filter: { date_geq: "2026-10-08", date_leq: "2026-10-09" })')
    expect(calls[0].body.query).toContain('turn0: callsTurnUsageAdaptiveGroups')
  })

  it('erro das análises (token sem permissão etc.) vira exceção, sem chutar zero', async () => {
    const denied = fakeFetch(() => ({ json: { data: null, errors: [{ message: 'not authorized for that account' }] } })).impl
    await expect(measuredUsage({ accountId: 'c', token: 't' }, Date.now(), denied)).rejects.toThrow('not authorized')
  })

  it('vale o maior entre a conta dos apps e o que o Cloudflare mediu', async () => {
    const me = await signup('lucas')
    await call('POST', '/api/media/usage', { bytes: 1e9 }, me.token)
    const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'))
    await runInDurableObject(dir, (_, state) => {
      state.storage.sql.exec('UPDATE media_usage SET measured = ? WHERE month = ?', MEDIA_BUDGET + 1, usageMonth())
    })
    expect((await call('GET', '/api/media', undefined, me.token)).body).toMatchObject({ used: MEDIA_BUDGET + 1, turn: false })
  })
})

