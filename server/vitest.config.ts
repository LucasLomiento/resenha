import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
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
