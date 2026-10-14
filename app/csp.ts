import type { Plugin } from 'vite'

/** Mapa compartilhado: os mapas do OpenFreeMap (estilo, pedaços, fontes, ícones) e a busca de endereço do OpenStreetMap. */
const MAP_HOSTS = 'https://tiles.openfreemap.org https://nominatim.openstreetmap.org'
/** Capas do bot do Spotify (só imagem: os pedidos ao Spotify saem do processo principal). */
const SPOTIFY_IMAGES = 'https://*.scdn.co https://*.spotifycdn.com'

/**
 * CSP do app (computador e celular): no build, a página só fala com o servidor
 * do Resenha (mesmo se um dia alguém achar um jeito de injetar código, não tem
 * pra onde mandar dado) e, pro mapa, com os dois serviços dele (só lendo: mapa
 * e busca de endereço). No modo dev fica mais aberta, por causa do servidor do Vite.
 */
export function csp(options: { connect?: string } = {}): Plugin {
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
            `img-src 'self' data: blob: ${http} ${MAP_HOSTS} ${SPOTIFY_IMAGES}`,
            `media-src 'self' blob: ${http}`,
            `connect-src 'self' ${http} ${ws} ${MAP_HOSTS}${options.connect ? ` ${options.connect}` : ''}`,
            "font-src 'self'",
            "worker-src 'self'",
            "object-src 'none'",
            // Só o Street View do Google (a incorporação dele, numa moldura sem acesso ao app).
            'frame-src https://www.google.com',
            "base-uri 'none'",
            "form-action 'none'",
          ].join('; ')
      return html.replace('%CSP%', policy)
    },
  }
}

/** Fonte pequena viraria data: URL, que o CSP (font-src 'self') bloqueia: sai sempre como arquivo. */
export const assetsInlineLimit = (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined)
