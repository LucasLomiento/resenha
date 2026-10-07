import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * CSP do app: no build, a página só fala com o servidor do Resenha (mesmo se
 * um dia alguém achar um jeito de injetar código, não tem pra onde mandar dado).
 * No modo dev fica mais aberta, por causa do servidor do Vite.
 */
function csp(): Plugin {
  return {
    name: 'resenha-csp',
    transformIndexHtml(html, ctx) {
      const http = new URL(process.env.VITE_DEFAULT_SERVER || 'https://resenha.lucaslomiento.workers.dev').origin
      const ws = http.replace(/^http/, 'ws')
      const policy = ctx.server
        ? `default-src 'self' 'unsafe-inline' http: https: ws: wss: data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`
        : [
            "default-src 'none'",
            "script-src 'self' 'wasm-unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            `img-src 'self' data: blob: ${http}`,
            `media-src 'self' blob: ${http}`,
            `connect-src 'self' ${http} ${ws}`,
            "font-src 'self'",
            "worker-src 'self'",
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
          ].join('; ')
      return html.replace('%CSP%', policy)
    },
  }
}

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
    plugins: [svelte(), csp()],
    // O processador do microfone roda num AudioWorklet, que carrega módulo ES e
    // não tem `self`: o formato padrão de worker (iife) quebraria o import.meta.url.
    worker: { format: 'es' },
    // Fonte pequena viraria data: URL, que o CSP (font-src 'self') bloqueia: sai sempre como arquivo.
    build: { assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined) },
  },
})
