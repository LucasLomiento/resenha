import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Sem o Workers AI de verdade (pediria login e internet): a rota do print responde 503.
      remoteBindings: false,
      miniflare: {
        // As chaves do Cloudflare que estiverem no .dev.vars (pro e2e) ficam de fora: os testes não saem pra internet.
        bindings: {
          FILE_SECRET: 'segredo-de-teste',
          RESUME_GRACE_MS: '400',
          REALTIME_APP_ID: '',
          REALTIME_APP_SECRET: '',
          TURN_KEY_ID: '',
          TURN_KEY_API_TOKEN: '',
          CF_ACCOUNT_ID: '',
          CF_ANALYTICS_TOKEN: '',
        },
      },
    }),
  ],
  test: {
    // Os testes compartilham os mesmos Durable Objects (e zeram tudo entre um e outro).
    fileParallelism: false,
  },
})
