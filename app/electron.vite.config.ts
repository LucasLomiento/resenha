import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'electron-vite'

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
    plugins: [svelte()],
    // O processador do microfone roda num AudioWorklet, que carrega módulo ES e
    // não tem `self`: o formato padrão de worker (iife) quebraria o import.meta.url.
    worker: { format: 'es' },
  },
})
