// Build da interface pro celular (Android, pelo Capacitor): a mesma do computador, sem o
// Electron. Vai pra mobile/www, que o `cap sync` copia pro app de Android. No celular o
// `window.resenha` (o que o processo principal do Electron dá) vem de src/renderer/mobile/bridge.ts.

import { svelte } from '@sveltejs/vite-plugin-svelte'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { assetsInlineLimit, csp } from './csp'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const version = (JSON.parse(readFileSync(here('package.json'), 'utf8')) as { version: string }).version
// Push só com o Firebase configurado no app de Android (sem ele, pedir o token derruba o app).
const push = existsSync(here('../mobile/android/app/google-services.json'))

export default defineConfig({
  // A entrada é a do celular (a ponte primeiro, depois o app de sempre).
  root: here('src/renderer/mobile'),
  base: './',
  // api.github.com: o app confere se tem APK novo nas releases.
  plugins: [svelte({ configFile: here('svelte.config.mjs') }), csp({ connect: 'https://api.github.com' })],
  define: {
    'import.meta.env.VITE_MOBILE': JSON.stringify('1'),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
    'import.meta.env.VITE_PUSH': JSON.stringify(push ? '1' : ''),
  },
  // O processador do microfone roda num AudioWorklet (módulo ES, sem `self`).
  worker: { format: 'es' },
  build: {
    outDir: here('../mobile/www'),
    emptyOutDir: true,
    assetsInlineLimit,
    // Android 8+ (WebView do Chrome atual): sem transpilar pra navegador velho.
    target: 'es2022',
  },
})
