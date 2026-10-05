// Servidores ICE pro WebRTC. O STUN do Cloudflare é aberto; o TURN (relay de
// reserva, quando a conexão direta falha) precisa de credencial temporária
// gerada com a chave do Cloudflare Realtime.

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

const STUN_ONLY: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }]

export async function getIceServers(env: Env): Promise<IceServer[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY

  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86_400 }),
    },
  )
  if (!res.ok) {
    console.error('TURN: falha ao gerar credenciais', res.status, await res.text())
    return STUN_ONLY
  }
  const { iceServers } = (await res.json()) as { iceServers: IceServer[] }
  // A porta 53 é bloqueada pelos navegadores e só atrasa o ICE esperando timeout.
  return iceServers.map((server) => ({
    ...server,
    urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) => !/:53(\?|$)/.test(url)),
  }))
}
