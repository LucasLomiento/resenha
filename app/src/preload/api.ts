// Contrato entre o renderer e o processo principal (exposto como window.resenha).

export interface PlatformInfo {
  platform: string
  /** No Wayland quem escolhe a tela é o seletor do portal, não o nosso. */
  portalPicker: boolean
  /**
   * Como o áudio da tela é capturado sem a voz da call:
   * - venmic: Linux/PipeWire, todos os apps menos o nosso
   * - exclude-self: Windows 10 22H2+, sistema inteiro menos o nosso processo
   * - loopback-all: Windows antigo, pega tudo (a voz da call vai junto)
   * - none: sem áudio da tela
   */
  screenAudio: 'venmic' | 'exclude-self' | 'loopback-all' | 'none'
  version: string
  /** No Hyprland atalho global só funciona por bind no config dele. */
  hyprland: boolean
}

export type ShortcutAction = 'toggle-mute' | 'toggle-deafen' | 'toggle-share' | 'leave-call' | 'show-window'

/** Preferências que o processo principal precisa já na partida (bandeja, atalhos, início com o PC). */
export interface DesktopPrefs {
  tray: boolean
  closeToTray: boolean
  autostart: boolean
  startHidden: boolean
  zoom: number
  /** Atalhos no formato de accelerator do Electron (ex.: "CommandOrControl+Shift+M"). */
  shortcuts: Record<ShortcutAction, string | null>
}

export interface CallState {
  inCall: boolean
  muted: boolean
  deafened: boolean
  sharing: boolean
  /** Falando agora: o ícone da bandeja "acende". */
  speaking: boolean
}

export type UpdateState =
  | { status: 'idle' | 'checking' | 'none' | 'unsupported' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'installing'; version: string }
  | { status: 'error'; message: string }

export interface SavedSession {
  server: string
  token: string
  /** Quem é (as sessões salvas pela 0.5 não têm; o app descobre no /api/me). */
  userId?: string
}

export interface CaptureSource {
  id: string
  name: string
  thumbnail: string
  kind: 'screen' | 'window'
}

export interface ResenhaApi {
  platform(): Promise<PlatformInfo>
  session: {
    get(): Promise<SavedSession | null>
    set(session: SavedSession | null): Promise<void>
  }
  share: {
    sources(): Promise<CaptureSource[]>
    /** Avisa o principal o que entregar no próximo getDisplayMedia. */
    select(choice: { sourceId: string | null; audio: boolean }): Promise<void>
  }
  screenAudio: {
    /** Apps tocando som agora (Linux), pro seletor do áudio da tela. */
    apps(): Promise<{ binary: string; name: string; voice: boolean }[]>
    start(options: { mode: 'all' | 'apps'; apps: string[] }): Promise<{ ok: boolean; error?: string }>
    unmute(): Promise<void>
    stop(): Promise<void>
  }
  attention(): void
  /** Convite aberto por um link resenha:// antes de o app terminar de abrir. */
  pendingInvite(): Promise<string | null>
  /** Convite aberto por um link resenha:// com o app já aberto. */
  onInvite(callback: (code: string) => void): void
  /** Abre a verificação anti-robô do servidor; devolve o token (ou null se fechou). */
  turnstile(server: string): Promise<string | null>
  /** Baixa um anexo com o diálogo de salvar do sistema. */
  download(url: string): void
  desktop: {
    get(): Promise<DesktopPrefs>
    /** Aplica e salva; devolve as preferências e os atalhos que o sistema recusou. */
    set(patch: Partial<DesktopPrefs>): Promise<{ prefs: DesktopPrefs; failed: ShortcutAction[] }>
  }
  /** Estado da call, pra bandeja e barra de tarefas. */
  callState(state: CallState): void
  /** Quantas coisas não lidas (menções, mensagens privadas, pedidos), pro ícone do app. */
  unread(count: number): void
  /** Ações vindas da bandeja, de atalho global ou da linha de comando. */
  onAction(callback: (action: ShortcutAction) => void): void
  update: {
    state(): Promise<UpdateState>
    check(): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
    onState(callback: (state: UpdateState) => void): void
  }
}
