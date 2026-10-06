// Estado só da interface: o que está aberto por cima da tela.

export type SettingsPage = 'account' | 'voice' | 'notifications' | 'shortcuts' | 'app' | 'group'

export interface ConfirmRequest {
  title: string
  description?: string
  /** Texto do botão de confirmar (o verbo: "Apagar", "Sair"). */
  confirm: string
  onconfirm: () => void
}

export const ui = $state<{
  /** Página das configurações abertas (tela cheia), ou null. */
  settings: SettingsPage | null
  share: boolean
  /** Painel rápido da transmissão em andamento (qualidade, parar). */
  sharePanel: boolean
  /** Gravando um atalho: os atalhos do app ficam pausados. */
  recordingShortcut: boolean
  lightbox: { url: string; name: string } | null
  /** Confirmação de algo que não dá pra desfazer. */
  confirm: ConfirmRequest | null
}>({
  settings: null,
  share: false,
  sharePanel: false,
  recordingShortcut: false,
  lightbox: null,
  confirm: null,
})

export function confirmAction(request: ConfirmRequest) {
  ui.confirm = request
}
