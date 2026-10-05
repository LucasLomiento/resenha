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
  },
})
