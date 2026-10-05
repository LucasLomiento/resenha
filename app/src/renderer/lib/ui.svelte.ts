// Janelas sobrepostas (modais) abertas na interface.

export type SettingsTab = 'voice' | 'screen' | 'group' | 'account'

export const ui = $state<{
  settings: SettingsTab | null
  share: boolean
  lightbox: { url: string; name: string } | null
}>({
  settings: null,
  share: false,
  lightbox: null,
})
