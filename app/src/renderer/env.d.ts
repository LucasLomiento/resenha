/// <reference types="svelte" />
/// <reference types="vite/client" />
import type { ResenhaApi } from '../preload/api'

declare global {
  interface Window {
    resenha: ResenhaApi
  }
}

interface ImportMetaEnv {
  /** Servidor sugerido na tela de login (definido no build). */
  readonly VITE_DEFAULT_SERVER?: string
  /** "1" abre direto nos protótipos de interface (ui/proto). */
  readonly VITE_PROTO?: string
  /** "1" só no build do e2e: a call fica em `window.__call` pro teste conferir o som do bot do Spotify. */
  readonly VITE_E2E?: string
  /** "1" no build do celular (vite.mobile.config.ts). */
  readonly VITE_MOBILE?: string
  /** Versão do app (só no build do celular: no computador quem sabe é o processo principal). */
  readonly VITE_APP_VERSION?: string
  /** "1" no build do celular com o Firebase configurado (mobile/android/app/google-services.json): liga o push. */
  readonly VITE_PUSH?: string
}

