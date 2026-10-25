// Pedidos dos Durable Objects no dia, medidos pelo Cloudflare (as análises, só contagens).
// No plano grátis, passou de 100 mil num dia (UTC), todo Durable Object passa a dar erro até
// a meia-noite UTC: login, chat, calls, tudo. Em 25/10/2026 um app em laço gastou isso numa
// tarde e o dono só soube pelo e-mail do Cloudflare. Daqui sai o "quanto já foi" e "quem mais
// gastou" da Plataforma, e o Directory decide o aviso e o modo econômico (directory.ts).

import type { AnalyticsConfig } from './media'

/** Cota diária do plano grátis. */
export const DAILY_REQUESTS = 100_000
/** De quanto em quanto tempo mede (as análises chegam com uns minutos de atraso). */
export const USAGE_EVERY = 10 * 60_000
/** Avisa o dono com isso do dia gasto antes das 21h UTC (ou com o ritmo projetando passar do limite). */
export const WARN_AT = 0.6
/** Liga o modo econômico (cadastro fechado até a cota zerar). */
export const ECONOMY_AT = 0.8
/** Ritmo projetando estourar só conta com isso já gasto: um pico curto de manhã não assusta ninguém. */
export const PACE_FROM = 0.2
/** Quantos objetos aparecem em "quem mais gastou". */
export const TOP_OBJECTS = 15

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'
const DAY = 24 * 60 * 60_000
const globalFetch: typeof fetch = (input, init) => fetch(input, init)

export interface RequestUsage {
  /** Dia (UTC) medido. */
  day: string
  /**
   * Tudo que o Cloudflare contou como pedido: HTTP (abrir WebSocket), RPC entre os objetos,
   * alarmes e mensagens de WebSocket recebidas. As mensagens contam inteiras: em 25/10/2026 o
   * aviso de 90% e o corte bateram com elas 1:1, não com o 20:1 da cobrança do plano pago.
   */
  requests: number
  byType: Record<string, number>
  /** Os objetos que mais gastaram hoje (id do Durable Object e pedidos). */
  top: { objectId: string; requests: number }[]
}

/** Dia UTC de um instante ("2026-10-25"). */
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

/** Meia-noite UTC seguinte (quando a cota zera). */
export const nextReset = (now = Date.now()) => Date.parse(utcDay(now)) + DAY

/** O que o Cloudflare contou hoje (UTC). */
export async function measuredRequests(config: AnalyticsConfig, now = Date.now(), fetchImpl: typeof fetch = globalFetch): Promise<RequestUsage> {
  const day = utcDay(now)
  const filter = 'filter: { datetime_geq: $from, datetime_lt: $to }'
  const query = `query ($account: string!, $from: Time!, $to: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    total: durableObjectsInvocationsAdaptiveGroups(limit: 50, ${filter}) { sum { requests } dimensions { type } }
    top: durableObjectsInvocationsAdaptiveGroups(limit: ${TOP_OBJECTS}, ${filter}, orderBy: [sum_requests_DESC]) { sum { requests } dimensions { objectId } }
  } } }`
  const res = await fetchImpl(GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { account: config.accountId, from: `${day}T00:00:00Z`, to: new Date(nextReset(now)).toISOString() },
    }),
  })
  const json = (await res.json().catch(() => null)) as { data?: any; errors?: { message?: string }[] | null } | null
  if (!res.ok || !json || json.errors?.length) throw new Error(`análises do Cloudflare: ${json?.errors?.[0]?.message ?? res.status}`)
  const account = json.data?.viewer?.accounts?.[0]
  if (!account) throw new Error('análises do Cloudflare: conta não encontrada')
  const byType: Record<string, number> = {}
  for (const group of (account.total ?? []) as { sum?: { requests?: number }; dimensions?: { type?: string } }[]) {
    const type = String(group.dimensions?.type ?? 'other')
    byType[type] = (byType[type] ?? 0) + (Number(group.sum?.requests) || 0)
  }
  const top = ((account.top ?? []) as { sum?: { requests?: number }; dimensions?: { objectId?: string } }[])
    .map((g) => ({ objectId: String(g.dimensions?.objectId ?? ''), requests: Number(g.sum?.requests) || 0 }))
    .filter((g) => /^[0-9a-f]{64}$/.test(g.objectId) && g.requests > 0)
  return { day, requests: Object.values(byType).reduce((a, b) => a + b, 0), byType, top }
}

/**
 * Até onde o dia vai no ritmo da última medição. `perMinute` = null na primeira do dia (sem
 * ritmo ainda). Devolve o total previsto pra meia-noite UTC e quando passaria do limite.
 */
export function project(requests: number, perMinute: number | null, now = Date.now()): { atReset: number | null; limitAt: number | null } {
  if (perMinute === null) return { atReset: null, limitAt: null }
  const minutesLeft = Math.max(0, (nextReset(now) - now) / 60_000)
  const atReset = Math.round(requests + perMinute * minutesLeft)
  if (requests >= DAILY_REQUESTS) return { atReset, limitAt: now }
  const limitAt = perMinute > 0 ? now + ((DAILY_REQUESTS - requests) / perMinute) * 60_000 : null
  return { atReset, limitAt: limitAt !== null && limitAt < nextReset(now) ? Math.round(limitAt) : null }
}

/** O que fazer com uma medição: avisar o dono, e se o modo econômico liga. */
export function usageLevel(requests: number, limitAt: number | null, now = Date.now()): { warn: boolean; pace: boolean; economy: boolean } {
  const part = requests / DAILY_REQUESTS
  const hour = new Date(now).getUTCHours()
  return {
    warn: part >= WARN_AT && hour < 21,
    pace: part >= PACE_FROM && limitAt !== null,
    economy: part >= ECONOMY_AT,
  }
}
