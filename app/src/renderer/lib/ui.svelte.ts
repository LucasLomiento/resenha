// Janelas sobrepostas (modais) abertas na interface.

export type SettingsTab = 'voice' | 'screen' | 'shortcuts' | 'app' | 'group' | 'account'

export const ui = $state<{
  settings: SettingsTab | null
  share: boolean
  /** Painel rápido da transmissão em andamento (qualidade, codec, parar). */
  sharePanel: boolean
  /** Gravando um atalho: os atalhos do app ficam pausados. */
  recordingShortcut: boolean
  lightbox: { url: string; name: string } | null
}>({
  settings: null,
  share: false,
  sharePanel: false,
  recordingShortcut: false,
  lightbox: null,
})
