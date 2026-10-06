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
}

