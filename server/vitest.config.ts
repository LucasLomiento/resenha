import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Sem o Workers AI de verdade (pediria login e internet): a rota do print responde 503.
      remoteBindings: false,
      miniflare: {
        bindings: { FILE_SECRET: 'segredo-de-teste', RESUME_GRACE_MS: '400' },
      },
    }),
  ],
  test: {
    // Os testes compartilham os mesmos Durable Objects (e zeram tudo entre um e outro).
    fileParallelism: false,
  },
})
