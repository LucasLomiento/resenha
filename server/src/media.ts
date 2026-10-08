// Mídia pelo Cloudflare Realtime: o SFU pra tela com várias pessoas assistindo
// e a conta dos GB do mês.
//
// Voz e tela continuam P2P por padrão (de graça e com menos atraso). O app usa o
// SFU só pra tela quando 2 ou mais pessoas assistem (quem compartilha manda e
// codifica uma cópia só, e o Cloudflare distribui), e o TURN só quando a conexão
// direta falha. Os dois dividem 1.000 GB grátis por mês, contados no que sai do
// Cloudflare pros apps. Passando de MEDIA_BUDGET, o servidor para de oferecer os
// dois e tudo volta a ser P2P até o mês virar.
//
// A chave do app do SFU fica só aqui: o app pede pelo nosso servidor, que confere
// que a sessão é de quem está pedindo (token assinado com o FILE_SECRET).
//
// A conta dos apps é aproximada (e um app com defeito poderia nem contar). Com o
// token de leitura das análises, o servidor confere de hora em hora o que o próprio
// Cloudflare mediu e vale o maior dos dois.

const API = 'https://rtc.live.cloudflare.com/v1'

/** Teto do mês, com folga antes dos 1.000 GB grátis (a conta dos apps é aproximada). */
export const MEDIA_BUDGET = 850 * 1e9
/** O que um app pode somar de uma vez (relatório de 1 minuto): mais que isso é erro ou abuso. */
export const MAX_USAGE_REPORT = 3 * 1e9
const MAX_SDP = 64 * 1024
const NAME = /^[\w-]{1,64}$/
const SESSION = /^[\w-]{1,128}$/

export interface SfuConfig {
  appId: string
  secret: string
}

export function sfuConfig(env: Env): SfuConfig | null {
  return env.REALTIME_APP_ID && env.REALTIME_APP_SECRET ? { appId: env.REALTIME_APP_ID, secret: env.REALTIME_APP_SECRET } : null
}

export const validSession = (value: unknown): value is string => typeof value === 'string' && SESSION.test(value)

export function cleanSdp(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_SDP && value.startsWith('v=0') ? value : null
}

/** Faixas do app (publicar): mid da transceiver e um nome. */
export function cleanLocalTracks(value: unknown): { mid: string; trackName: string }[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) return null
  const out = value.map((t) => {
    const track = t as Record<string, unknown>
    return typeof track?.mid === 'string' && track.mid.length <= 16 && typeof track.trackName === 'string' && NAME.test(track.trackName)
      ? { mid: track.mid, trackName: track.trackName }
      : null
  })
  return out.every(Boolean) ? (out as { mid: string; trackName: string }[]) : null
}

/** Faixas de outra sessão (assistir): sessão de quem publicou e o nome. */
export function cleanRemoteTracks(value: unknown): { sessionId: string; trackName: string }[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) return null
  const out = value.map((t) => {
    const track = t as Record<string, unknown>
    return validSession(track?.sessionId) && typeof track.trackName === 'string' && NAME.test(track.trackName)
      ? { sessionId: track.sessionId, trackName: track.trackName }
      : null
  })
  return out.every(Boolean) ? (out as { sessionId: string; trackName: string }[]) : null
}

const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Prova de que a sessão do SFU foi criada pra essa pessoa (as outras chamadas exigem). */
export async function sessionToken(secret: string, userId: string, sessionId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`sfu:${userId}:${sessionId}`)))
}

export async function validToken(secret: string, userId: string, sessionId: string, token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token.length > 100) return false
  const want = await sessionToken(secret, userId, sessionId)
  // Comparação em tempo constante.
  let diff = want.length ^ token.length
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (token.charCodeAt(i) || 0)
  return diff === 0
}

export class SfuError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

type Json = Record<string, unknown>
interface TrackReply {
  mid?: string
  trackName?: string
  errorCode?: string
  errorDescription?: string
}

/**
 * O `fetch` do runtime só funciona chamado solto: guardado num objeto e chamado
 * como método, dá "Illegal invocation". Por isso o padrão é uma função que o chama.
 */
const globalFetch: typeof fetch = (input, init) => fetch(input, init)

/** Cliente da API do SFU (rtc.live.cloudflare.com). `fetchImpl` troca nos testes. */
export class Sfu {
  constructor(
    private config: SfuConfig,
    private fetchImpl: typeof fetch = globalFetch,
  ) {}

  private async call(method: 'GET' | 'POST' | 'PUT', path: string, body?: Json): Promise<Json> {
    let res: Response
    try {
      res = await this.fetchImpl(`${API}/apps/${this.config.appId}${path}`, {
        method,
        headers: body ? { Authorization: `Bearer ${this.config.secret}`, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${this.config.secret}` },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (err) {
      throw new SfuError(502, `SFU fora do ar: ${(err as Error).message}`)
    }
    const text = await res.text()
    let json: Json = {}
    try {
      json = text ? (JSON.parse(text) as Json) : {}
    } catch {
      // resposta sem JSON
    }
    if (!res.ok || json.errorCode) {
      console.error('SFU:', method, path.replace(/\/sessions\/[^/]+/, '/sessions/…'), res.status, text.slice(0, 300))
      throw new SfuError(res.ok ? 502 : res.status >= 500 ? 502 : 400, String(json.errorDescription ?? `SFU respondeu ${res.status}`))
    }
    return json
  }

  async newSession(): Promise<string> {
    const json = await this.call('POST', '/sessions/new')
    if (!validSession(json.sessionId)) throw new SfuError(502, 'SFU não devolveu a sessão.')
    return json.sessionId
  }

  /** Quem compartilha publica as faixas (oferta do app → resposta do SFU). */
  async push(sessionId: string, sdp: string, tracks: { mid: string; trackName: string }[]): Promise<{ sdp: string }> {
    const json = await this.call('POST', `/sessions/${sessionId}/tracks/new`, {
      sessionDescription: { type: 'offer', sdp },
      tracks: tracks.map((t) => ({ location: 'local', mid: t.mid, trackName: t.trackName })),
    })
    this.checkTracks(json)
    const answer = (json.sessionDescription as Json | undefined)?.sdp
    if (typeof answer !== 'string') throw new SfuError(502, 'SFU não devolveu a resposta.')
    return { sdp: answer }
  }

  /** Quem assiste puxa as faixas de quem publicou: o SFU manda uma oferta pra renegociar. */
  async pull(sessionId: string, tracks: { sessionId: string; trackName: string }[]): Promise<{ sdp: string | null; tracks: { mid: string; trackName: string }[] }> {
    const json = await this.call('POST', `/sessions/${sessionId}/tracks/new`, {
      tracks: tracks.map((t) => ({ location: 'remote', sessionId: t.sessionId, trackName: t.trackName })),
    })
    const replies = this.checkTracks(json)
    const offer = json.requiresImmediateRenegotiation ? (json.sessionDescription as Json | undefined)?.sdp : null
    return {
      sdp: typeof offer === 'string' ? offer : null,
      tracks: replies.filter((t) => t.mid && t.trackName).map((t) => ({ mid: t.mid!, trackName: t.trackName! })),
    }
  }

  async renegotiate(sessionId: string, sdp: string): Promise<void> {
    await this.call('PUT', `/sessions/${sessionId}/renegotiate`, { sessionDescription: { type: 'answer', sdp } })
  }

  async close(sessionId: string, mids: string[]): Promise<void> {
    await this.call('PUT', `/sessions/${sessionId}/tracks/close`, { tracks: mids.map((mid) => ({ mid })), force: true })
  }

  private checkTracks(json: Json): TrackReply[] {
    const tracks = Array.isArray(json.tracks) ? (json.tracks as TrackReply[]) : []
    const failed = tracks.find((t) => t.errorCode)
    if (failed) throw new SfuError(400, failed.errorDescription ?? failed.errorCode ?? 'Faixa recusada.')
    return tracks
  }
}

/** Mês da conta (o grátis do Cloudflare é por mês). */
export const usageMonth = (now = Date.now()) => new Date(now).toISOString().slice(0, 7)

// ---------- O que o Cloudflare mediu (GraphQL das análises) ----------

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'
/** De quanto em quanto tempo confere (as análises chegam com alguns minutos de atraso). */
export const MEASURE_EVERY = 60 * 60 * 1000
/** Cada pedaço da consulta cobre até isso (os conjuntos de dados limitam o intervalo). */
const CHUNK_DAYS = 7
const DAY = 24 * 60 * 60 * 1000

export interface AnalyticsConfig {
  accountId: string
  token: string
}

export function analyticsConfig(env: Env): AnalyticsConfig | null {
  return env.CF_ACCOUNT_ID && env.CF_ANALYTICS_TOKEN ? { accountId: env.CF_ACCOUNT_ID, token: env.CF_ANALYTICS_TOKEN } : null
}

/** Do dia 1 até hoje (UTC), em pedaços de até CHUNK_DAYS dias. */
export function monthChunks(now = Date.now()): { from: string; to: string }[] {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const today = Date.parse(day(now))
  const chunks: { from: string; to: string }[] = []
  for (let start = Date.parse(`${usageMonth(now)}-01`); start <= today; start += CHUNK_DAYS * DAY) {
    chunks.push({ from: day(start), to: day(Math.min(today, start + (CHUNK_DAYS - 1) * DAY)) })
  }
  return chunks
}

/** Bytes que saíram do Cloudflare neste mês pelo SFU e pelo TURN, medidos por ele. */
export async function measuredUsage(config: AnalyticsConfig, now = Date.now(), fetchImpl: typeof fetch = globalFetch): Promise<number> {
  const parts = monthChunks(now).flatMap(({ from, to }, i) => {
    const filter = `filter: { date_geq: "${from}", date_leq: "${to}" }`
    return [
      `sfu${i}: callsUsageAdaptiveGroups(limit: 1, ${filter}) { sum { egressBytes } }`,
      `turn${i}: callsTurnUsageAdaptiveGroups(limit: 1, ${filter}) { sum { egressBytes } }`,
    ]
  })
  const query = `query ($account: string!) { viewer { accounts(filter: { accountTag: $account }) { ${parts.join(' ')} } } }`
  const res = await fetchImpl(GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { account: config.accountId } }),
  })
  const json = (await res.json().catch(() => null)) as { data?: any; errors?: { message?: string }[] | null } | null
  if (!res.ok || !json || json.errors?.length) throw new Error(`análises do Cloudflare: ${json?.errors?.[0]?.message ?? res.status}`)
  const account = json.data?.viewer?.accounts?.[0]
  if (!account) throw new Error('análises do Cloudflare: conta não encontrada')
  let total = 0
  for (const groups of Object.values(account) as { sum?: { egressBytes?: number } }[][]) {
    for (const group of groups ?? []) total += Number(group.sum?.egressBytes) || 0
  }
  return total
}
