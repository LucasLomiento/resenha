// Secrets não aparecem no wrangler.jsonc; declarados aqui pro TypeScript.
interface Env {
  FILE_SECRET: string
  TURNSTILE_SECRET?: string
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
  /** Só nos testes: encurta a espera por quem caiu da call. */
  RESUME_GRACE_MS?: string
}
