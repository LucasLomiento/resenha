// Estado só da interface: o que está aberto por cima da tela.

/** Páginas das configurações do app (tela cheia). */
export type SettingsPage = 'profile' | 'devices' | 'password' | 'privacy' | 'voice' | 'notifications' | 'shortcuts' | 'app' | 'platform'

/** Páginas das configurações de um servidor (tela cheia). */
export type GuildSettingsPage = 'overview' | 'roles' | 'members' | 'invites' | 'bans' | 'audit'

export interface ConfirmRequest {
  title: string
  description?: string
  /** Texto do botão de confirmar (o verbo: "Apagar", "Sair"). */
  confirm: string
  onconfirm: () => void
}

/** Onde o cartão de perfil encosta (elemento clicado ou ponto do clique). */
export type Anchor = HTMLElement | { x: number; y: number }

export const ui = $state<{
  /** Página das configurações abertas (tela cheia), ou null. */
  settings: SettingsPage | null
  /** Configurações de um servidor (tela cheia). */
  guildSettings: { guildId: string; page: GuildSettingsPage } | null
  /** Editar um canal ou categoria. */
  channelSettings: { guildId: string; channelId: string } | null
  /** Criar canal (ou categoria) num servidor. */
  createChannel: { guildId: string; kind: 'text' | 'voice' | 'category'; parentId: string | null } | null
  /** Convidar pessoas pra um servidor. */
  invite: { guildId: string } | null
  /** Criar ou entrar num servidor. `join` já pode vir com o código (link de convite). */
  addServer: { step: 'choose' | 'create' | 'join'; code?: string } | null
  /** Cartão de perfil aberto. */
  profile: { userId: string; guildId: string | null; anchor: Anchor } | null
  /** Ctrl+K: pular pra canal, conversa ou servidor. */
  switcher: boolean
  /** Lista de membros à direita (nos servidores). */
  members: boolean
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
  guildSettings: null,
  channelSettings: null,
  createChannel: null,
  invite: null,
  addServer: null,
  profile: null,
  switcher: false,
  members: loadMembersPref(),
  share: false,
  sharePanel: false,
  recordingShortcut: false,
  lightbox: null,
  confirm: null,
})

function loadMembersPref(): boolean {
  try {
    return localStorage.getItem('resenha.members') !== '0'
  } catch {
    return true
  }
}

export function toggleMembers() {
  ui.members = !ui.members
  try {
    localStorage.setItem('resenha.members', ui.members ? '1' : '0')
  } catch {
    // sem armazenamento
  }
}

export function confirmAction(request: ConfirmRequest) {
  ui.confirm = request
}

export function openProfile(userId: string, guildId: string | null, anchor: Anchor) {
  ui.profile = { userId, guildId, anchor }
}
