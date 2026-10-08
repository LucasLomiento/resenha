// Secrets não aparecem no wrangler.jsonc; declarados aqui pro TypeScript.
interface Env {
  FILE_SECRET: string
  TURNSTILE_SECRET?: string
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
  /** App do SFU do Cloudflare Realtime (tela com várias pessoas assistindo). */
  REALTIME_APP_ID?: string
  REALTIME_APP_SECRET?: string
  /** Conferência do que o Cloudflare mediu (token só com "Account Analytics: Read"). */
  CF_ACCOUNT_ID?: string
  CF_ANALYTICS_TOKEN?: string
  /** Só nos testes: encurta a espera por quem caiu da call. */
  RESUME_GRACE_MS?: string
}
