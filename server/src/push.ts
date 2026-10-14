// Notificação push no celular, pelo Firebase Cloud Messaging (API HTTP v1). A chave é a conta
// de serviço do projeto no Firebase (o JSON inteiro no secret FCM_SERVICE_ACCOUNT): com ela o
// Worker assina um JWT, troca por um token de acesso do Google (vale 1 h) e manda. Sem a chave,
// nada sai e o app do celular avisa só com ele aberto (como antes).

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

/** Idiomas dos textos do push (o app manda o dele junto com o token do aparelho). */
export type PushLocale = 'pt' | 'en' | 'es'

export const PUSH_TEXT: Record<
  PushLocale,
  { voiceNote: string; hidden: string; calling: (name: string) => string; videoCalling: (name: string) => string; tapToAnswer: string; inChannel: (name: string, channel: string, server: string) => string }
> = {
  pt: {
    voiceNote: 'Mandou uma mensagem de voz',
    hidden: 'Mensagem nova',
    calling: (name) => `${name} está ligando`,
    videoCalling: (name) => `${name} está fazendo uma chamada de vídeo`,
    tapToAnswer: 'Toque pra atender',
    inChannel: (name, channel, server) => `${name} em #${channel} · ${server}`,
  },
  en: {
    voiceNote: 'Sent a voice message',
    hidden: 'New message',
    calling: (name) => `${name} is calling`,
    videoCalling: (name) => `${name} is video calling`,
    tapToAnswer: 'Tap to answer',
    inChannel: (name, channel, server) => `${name} in #${channel} · ${server}`,
  },
  es: {
    voiceNote: 'Envió un mensaje de voz',
    hidden: 'Mensaje nuevo',
    calling: (name) => `${name} te está llamando`,
    videoCalling: (name) => `${name} te está haciendo una videollamada`,
    tapToAnswer: 'Toca para contestar',
    inChannel: (name, channel, server) => `${name} en #${channel} · ${server}`,
  },
}

export interface PushMessage {
  title: string
  body: string
  /** Pra onde o toque leva (o app recebe como `data`). Só texto. */
  data: Record<string, string>
  /** A notificação nova com a mesma etiqueta substitui a anterior (uma por conversa). */
  tag: string
  /** Ligação vai pelo canal das ligações (toca e aparece por cima). */
  kind: 'message' | 'call'
}

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}

/**
 * O `fetch` do runtime só funciona chamado solto: guardado num objeto e chamado como
 * método dá "Illegal invocation". Por isso o padrão é uma função que chama o global.
 */
const globalFetch: typeof fetch = (input, init) => fetch(input, init)

/** Token de acesso do Google por conta de serviço (vale pra todos os Durable Objects do isolate). */
const accessTokens = new Map<string, { value: string; until: number }>()

export function parseServiceAccount(secret: string | undefined): ServiceAccount | null {
  if (!secret) return null
  try {
    const json = JSON.parse(secret) as Partial<ServiceAccount>
    if (typeof json.project_id !== 'string' || typeof json.client_email !== 'string' || typeof json.private_key !== 'string') return null
    return { project_id: json.project_id, client_email: json.client_email, private_key: json.private_key }
  } catch {
    return null
  }
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const utf8 = (text: string) => new TextEncoder().encode(text)

function pemBody(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** JWT assinado com a chave da conta de serviço (RS256), pra trocar por um token de acesso. */
export async function signedAssertion(account: ServiceAccount, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000)
  const header = base64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = base64url(utf8(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })))
  const key = await crypto.subtle.importKey('pkcs8', pemBody(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${header}.${claims}`)))
  return `${header}.${claims}.${base64url(signature)}`
}

export class Pusher {
  private account: ServiceAccount | null

  constructor(
    secret: string | undefined,
    /** Troca nos testes (o Firebase de mentira). */
    public fetchImpl: typeof fetch = globalFetch,
  ) {
    this.account = parseServiceAccount(secret)
  }

  get enabled(): boolean {
    return this.account !== null
  }

  private async accessToken(): Promise<string> {
    const account = this.account!
    const cached = accessTokens.get(account.client_email)
    if (cached && cached.until > Date.now()) return cached.value
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signedAssertion(account) }),
    })
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number }
    if (!res.ok || !json.access_token) throw new Error(`Google recusou a chave do Firebase (${res.status})`)
    // Renova um minuto antes de vencer.
    accessTokens.set(account.client_email, { value: json.access_token, until: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 })
    return json.access_token
  }

  /** Manda pra cada aparelho; devolve os tokens que não valem mais (app desinstalado, token trocado). */
  async send(tokens: string[], message: PushMessage): Promise<string[]> {
    if (!this.account || tokens.length === 0) return []
    const access = await this.accessToken()
    const url = `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`
    const dead: string[] = []
    await Promise.all(
      tokens.map(async (token) => {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: message.title, body: message.body },
              data: message.data,
              android: {
                priority: 'high',
                // Ligação que ninguém atendeu em 30 s já acabou: não adianta entregar depois.
                ttl: message.kind === 'call' ? '30s' : '86400s',
                notification: {
                  tag: message.tag,
                  channel_id: message.kind === 'call' ? 'calls' : 'messages',
                  icon: 'ic_stat_resenha',
                  color: '#2b6cf5',
                  sound: 'default',
                },
              },
            },
          }),
        })
        if (res.ok) return
        const error = (await res.json().catch(() => ({}))) as { error?: { status?: string; details?: { errorCode?: string }[] } }
        const code = error.error?.details?.find((d) => d.errorCode)?.errorCode ?? error.error?.status
        if (res.status === 404 || code === 'UNREGISTERED') dead.push(token)
      }),
    )
    return dead
  }
}

/** Texto da mensagem pro push: menções viram @nome (quem não conhece, "@…") e o anexo, o nome dele (como no app). */
export function pushBody(
  content: string,
  attachments: { name: string }[],
  names: (id: string) => string | null,
  text: (typeof PUSH_TEXT)[PushLocale],
): string {
  const clean = content
    .replace(/<@!?([\w-]{1,64})>/g, (_, id: string) => `@${names(id) ?? '…'}`)
    .replace(/<@&[\w-]{1,64}>/g, '@…')
    .replace(/<#[\w-]{1,64}>/g, '#…')
    .trim()
  if (clean) return clean.length > 300 ? `${clean.slice(0, 299)}…` : clean
  const first = attachments[0]
  if (!first) return ''
  // Mensagem de voz: o app grava com esse nome (lib/voice-note.ts).
  return first.name.startsWith('mensagem-de-voz') ? text.voiceNote : `📎 ${first.name}`
}
