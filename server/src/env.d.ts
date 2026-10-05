// Secrets não aparecem no wrangler.jsonc; declarados aqui pro TypeScript.
interface Env {
  FILE_SECRET: string
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
}
