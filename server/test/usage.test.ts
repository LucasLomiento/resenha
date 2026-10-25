import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { dmChannelId } from '../../shared/protocol'
import type { Directory } from '../src/directory'
import { DAILY_REQUESTS, USAGE_EVERY, measuredRequests, nextReset, project, usageLevel, utcDay } from '../src/usage'
import { call, homeSocket, world } from './helpers'

/** As análises de mentira: responde o total por tipo e o topo por objeto. */
function analytics(byType: Record<string, number>, top: { objectId: string; requests: number }[] = []) {
  const calls: any[] = []
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)))
    return new Response(
      JSON.stringify({
        data: {
          viewer: {
            accounts: [
              {
                total: Object.entries(byType).map(([type, requests]) => ({ sum: { requests }, dimensions: { type } })),
                top: top.map((t) => ({ sum: { requests: t.requests }, dimensions: { objectId: t.objectId } })),
              },
            ],
          },
        },
        errors: null,
      }),
    )
  }) as typeof fetch
  return { impl, calls }
}

const directory = () => env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'))

/** Liga as chaves das análises só neste Directory (os testes rodam sem elas). */
async function withAnalytics(fetchImpl: typeof fetch) {
  await runInDurableObject(directory(), (instance: Directory) => {
    const self = instance as unknown as { env: Env; analyticsFetch: typeof fetch }
    self.env = { ...self.env, CF_ACCOUNT_ID: 'conta', CF_ANALYTICS_TOKEN: 'leitura' }
    self.analyticsFetch = fetchImpl
  })
}

const measure = (now: number) => runInDurableObject(directory(), (instance: Directory) => instance.measureRequests(now))

describe('Pedidos do dia no Cloudflare', () => {
  it('soma tudo que o Cloudflare contou hoje (mensagem de WebSocket inteira) e pega o topo', async () => {
    const { impl, calls } = analytics({ jsrpc: 70_000, hibernation: 35_000, alarm: 3000, http: 30 }, [
      { objectId: 'a'.repeat(64), requests: 38_000 },
      { objectId: 'não é id', requests: 5 },
    ])
    const usage = await measuredRequests({ accountId: 'conta', token: 'leitura' }, Date.parse('2026-10-25T18:54:00Z'), impl)
    expect(usage).toEqual({
      day: '2026-10-25',
      requests: 108_030,
      byType: { jsrpc: 70_000, hibernation: 35_000, alarm: 3000, http: 30 },
      top: [{ objectId: 'a'.repeat(64), requests: 38_000 }],
    })
    expect(calls[0].variables).toEqual({ account: 'conta', from: '2026-10-25T00:00:00Z', to: '2026-10-26T00:00:00.000Z' })
    expect(calls[0].query).toContain('orderBy: [sum_requests_DESC]')
  })

  it('erro das análises vira exceção (sem chutar zero)', async () => {
    const denied = (async () => new Response(JSON.stringify({ data: null, errors: [{ message: 'not authorized' }] }))) as unknown as typeof fetch
    await expect(measuredRequests({ accountId: 'c', token: 't' }, Date.now(), denied)).rejects.toThrow('not authorized')
  })

  it('projeta o fim do dia pelo ritmo e diz quando estoura', () => {
    const now = Date.parse('2026-10-25T18:00:00Z')
    expect(project(50_000, null, now)).toEqual({ atReset: null, limitAt: null })
    // 6 h até a meia-noite UTC a 10/min: 53.600, não estoura.
    expect(project(50_000, 10, now)).toEqual({ atReset: 53_600, limitAt: null })
    // A 1.000/min (o laço de 25/10), estoura em 50 min.
    expect(project(50_000, 1000, now)).toEqual({ atReset: 410_000, limitAt: now + 50 * 60_000 })
    expect(nextReset(now)).toBe(Date.parse('2026-10-26T00:00:00Z'))
  })

  it('avisa com 60% antes das 21h UTC ou com o ritmo estourando; econômico com 80%', () => {
    const afternoon = Date.parse('2026-10-25T15:00:00Z')
    const night = Date.parse('2026-10-25T22:00:00Z')
    expect(usageLevel(0.59 * DAILY_REQUESTS, null, afternoon)).toEqual({ warn: false, pace: false, economy: false })
    expect(usageLevel(0.6 * DAILY_REQUESTS, null, afternoon)).toEqual({ warn: true, pace: false, economy: false })
    expect(usageLevel(0.6 * DAILY_REQUESTS, null, night)).toEqual({ warn: false, pace: false, economy: false })
    // Ritmo estourando, mas com pouco gasto ainda: não assusta.
    expect(usageLevel(0.1 * DAILY_REQUESTS, afternoon + 1000, afternoon).pace).toBe(false)
    expect(usageLevel(0.25 * DAILY_REQUESTS, afternoon + 1000, afternoon).pace).toBe(true)
    expect(usageLevel(0.8 * DAILY_REQUESTS, null, night).economy).toBe(true)
  })

  it('a Plataforma mostra quem mais gastou com o nome; o dono recebe o aviso e o cadastro aberto fecha', async () => {
    const { owner, friend, guild } = await world()
    const home = await homeSocket(owner.user.id, owner.token)
    await home.next('ready')
    const id = (ns: DurableObjectNamespace, name: string) => ns.idFromName(name).toString()
    const top = [
      { objectId: id(env.HOME, friend.user.id), requests: 30_000 },
      { objectId: id(env.CONVERSATION, dmChannelId(owner.user.id, friend.user.id)), requests: 29_000 },
      { objectId: id(env.GUILD, guild.id), requests: 900 },
      { objectId: id(env.DIRECTORY, 'directory'), requests: 300 },
      { objectId: 'f'.repeat(64), requests: 20 },
    ]
    // Meio-dia (UTC) de hoje: o ritmo e o "estoura às" não dependem da hora em que o teste roda.
    const now = Date.parse(`${utcDay()}T12:00:00Z`)
    await runInDurableObject(directory(), (_, state) => {
      state.storage.sql.exec("INSERT INTO meta (key, value) VALUES ('signup_mode', 'open') ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    })

    // Sem as chaves, a Plataforma diz que não tem medição (e nada sai pra internet).
    expect((await call('GET', '/api/admin', undefined, owner.token)).body.usage).toBeNull()

    // Primeira medição: 30% e sem ritmo ainda. Nada de aviso.
    await withAnalytics(analytics({ jsrpc: 25_000, hibernation: 5000 }, top).impl)
    await measure(now - 10 * 60_000)
    let panel = (await call('GET', '/api/admin', undefined, owner.token)).body
    expect(panel.usage).toMatchObject({ limit: DAILY_REQUESTS, economy: false, requests: 30_000, perMinute: null, limitAt: null })
    expect(panel.usage.top.map((t: any) => [t.kind, t.user?.name, t.peer?.name, t.guild?.name, t.requests])).toEqual([
      ['user', 'Duarte', undefined, undefined, 30_000],
      ['dm', 'Lucas', 'Duarte', undefined, 29_000],
      ['guild', undefined, undefined, 'Turma', 900],
      ['directory', undefined, undefined, undefined, 300],
      ['unknown', undefined, undefined, undefined, 20],
    ])
    await home.nothing('platform.alert')

    // Dez minutos depois, 85% (5.500 por minuto): econômico e o aviso pro dono, uma vez só.
    await withAnalytics(analytics({ jsrpc: 70_000, hibernation: 15_000 }, top).impl)
    await measure(now)
    const alert = (await home.next('platform.alert')).alert
    expect(alert).toMatchObject({ kind: 'economy', requests: 85_000, limit: DAILY_REQUESTS, top: ['Duarte', 'Lucas + Duarte', 'Turma'] })
    expect(alert.limitAt).toBeGreaterThan(now)
    panel = (await call('GET', '/api/admin', undefined, owner.token)).body
    expect(panel.usage).toMatchObject({ economy: true, requests: 85_000, perMinute: 5500 })
    // O que o dono escolheu continua lá; o que vale agora é o convite.
    expect(panel.signup).toBe('open')
    const status = await runInDurableObject(directory(), (instance: Directory) => instance.status())
    expect(status.signup).toBe('invite')
    const refused = await runInDurableObject(directory(), (instance: Directory) =>
      instance.register({ username: 'estranho', password: 'senha-forte-1', turnstile: true }, { device: 'x', ipHash: 'ip', country: null }),
    )
    expect(refused).toMatchObject({ ok: false, status: 503, error: 'O cadastro está pausado por algumas horas. Com um convite, dá pra entrar agora.' })
    await measure(now + 60_000)
    await home.nothing('platform.alert')

    // A cota zerou (dia novo): o cadastro aberto volta sozinho.
    await runInDurableObject(directory(), (_, state) => {
      state.storage.sql.exec("UPDATE meta SET value = '2000-01-01' WHERE key = 'economy_day'")
    })
    expect((await runInDurableObject(directory(), (instance: Directory) => instance.status())).signup).toBe('open')
  })

  it('o Pioneiro também vê o uso (só pra ler)', async () => {
    const { owner, friend } = await world()
    await withAnalytics(analytics({ alarm: 10 }).impl)
    await measure(Date.parse(`${utcDay()}T12:00:00Z`))
    expect((await call('GET', '/api/admin', undefined, friend.token)).body.usage).toMatchObject({ requests: 10 })
    expect((await call('GET', '/api/admin', undefined, owner.token)).status).toBe(200)
  })

  it('com as chaves, o alarme mede de 10 em 10 min e a limpeza continua diária', async () => {
    const { impl, calls } = analytics({ alarm: 5 })
    await withAnalytics(impl)
    const before = Date.now()
    expect(await runDurableObjectAlarm(directory())).toBe(true)
    expect(calls).toHaveLength(1)
    const { alarm, cleaned } = await runInDurableObject(directory(), async (_, state) => ({
      alarm: await state.storage.getAlarm(),
      cleaned: Number(state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'cleaned_at'").toArray()[0]?.value),
    }))
    expect(alarm).toBeGreaterThanOrEqual(before + USAGE_EVERY - 1000)
    expect(alarm).toBeLessThanOrEqual(Date.now() + USAGE_EVERY)
    expect(cleaned).toBeGreaterThanOrEqual(before)
    // O segundo alarme do dia mede de novo, mas não limpa.
    expect(await runDurableObjectAlarm(directory())).toBe(true)
    expect(calls).toHaveLength(2)
    const again = await runInDurableObject(directory(), (_, state) =>
      Number(state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'cleaned_at'").toArray()[0]?.value),
    )
    expect(again).toBe(cleaned)
  })
})
