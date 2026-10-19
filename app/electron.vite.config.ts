import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'electron-vite'
import { assetsInlineLimit, csp } from './csp'
import { licenses } from './scripts/licenses'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // Módulo nativo, só existe no Linux; carregado sob demanda.
        external: ['@vencord/venmic'],
      },
    },
  },
  preload: {},
  renderer: {
    // Os avisos de licença do que vai no app saem junto do index.html (THIRD_PARTY_LICENSES.txt).
    plugins: [svelte(), csp(), licenses(__dirname)],
    // O processador do microfone roda num AudioWorklet, que carrega módulo ES e
    // não tem `self`: o formato padrão de worker (iife) quebraria o import.meta.url.
    worker: { format: 'es' },
    build: { assetsInlineLimit },
  },
})
