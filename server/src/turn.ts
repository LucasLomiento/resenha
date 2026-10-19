// Servidores ICE pro WebRTC. O STUN do Cloudflare é aberto; o TURN (só na sala
// pelo Cloudflare) precisa de credencial temporária gerada com a chave do
// Cloudflare Realtime.

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export const STUN_ONLY: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }]

/**
 * Validade da credencial do TURN (s). A conexão renova a alocação com ela, então tem que
 * passar da call mais longa; na cota do mês, as que ainda valem são revogadas (`revokeTurn`).
 */
export const TURN_TTL = 86_400

const API = 'https://rtc.live.cloudflare.com/v1/turn/keys'

/**
 * Credencial nova do TURN, e o `username` dela (pra revogar). Se a API do Cloudflare falhar
 * ou demorar, só o STUN: ninguém fica sem entrar na call por causa disso.
 */
export async function getIceServers(env: Env): Promise<{ servers: IceServer[]; turnUser: string | null }> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return { servers: STUN_ONLY, turnUser: null }
  try {
    const res = await fetch(`${API}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL }),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) {
      console.error('TURN: falha ao gerar credenciais', res.status, await res.text())
      return { servers: STUN_ONLY, turnUser: null }
    }
    const { iceServers } = (await res.json()) as { iceServers?: IceServer[] }
    if (!Array.isArray(iceServers)) return { servers: STUN_ONLY, turnUser: null }
    // A porta 53 é bloqueada pelos navegadores e só atrasa o ICE esperando timeout.
    const servers = iceServers.map((server) => ({
      ...server,
      urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) => !/:53(\?|$)/.test(url)),
    }))
    return { servers, turnUser: servers.find((s) => typeof s.username === 'string')?.username ?? null }
  } catch (err) {
    console.error('TURN: a API do Cloudflare não respondeu', (err as Error).message)
    return { servers: STUN_ONLY, turnUser: null }
  }
}

/** Revoga uma credencial antes de ela vencer (a cota do mês acabou). */
export async function revokeTurn(env: Env, username: string): Promise<boolean> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return false
  try {
    const res = await fetch(`${API}/${env.TURN_KEY_ID}/credentials/${encodeURIComponent(username)}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    })
    // 404: já venceu ou já foi revogada.
    return res.ok || res.status === 404
  } catch {
    return false
  }
}
