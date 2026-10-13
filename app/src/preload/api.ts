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
  /** Último idioma da interface (a bandeja abre nele antes da janela carregar). */
  locale?: 'pt' | 'en' | 'es'
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

/** Um monitor onde os rabiscos de quem assiste podem aparecer. */
export interface InkMonitor {
  /** Conector (Linux/Wayland, ex.: DP-1) ou id do monitor (Windows/X11). */
  connector: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

// ---------- Bot do Spotify (main/spotify.ts e lib/music.svelte.ts) ----------

/** Uma música, do jeito que o app mostra (e manda pros outros da call). */
export interface MusicTrack {
  /** spotify:track:… */
  uri: string
  title: string
  artists: string
  album: string
  /** Capa (https://i.scdn.co/…), ou null. */
  cover: string | null
  durationMs: number
}

/** Playlist ou álbum (busca e "playlists de quem pôs o bot"). */
export interface MusicList {
  uri: string
  kind: 'playlist' | 'album'
  title: string
  /** Dono da playlist ou artista do álbum. */
  by: string
  cover: string | null
}

/** O que está tocando no bot. */
export interface MusicPlayer {
  track: MusicTrack | null
  playing: boolean
  progressMs: number
  /** Quando o `progressMs` valia (Date.now() de quem leu; quem recebe acerta pelo relógio dele). */
  at: number
  shuffle: boolean
  repeat: 'off' | 'context' | 'track'
  /** A conta está tocando em outro aparelho (o nome dele), não no bot. */
  elsewhere: string | null
}

export interface MusicSearch {
  tracks: MusicTrack[]
  lists: MusicList[]
}

/** O que dá pra pedir pro Spotify do bot (quem pôs pede direto; quem está na call, pelo canal de dados). */
export type MusicOp =
  | { op: 'player' }
  | { op: 'queue' }
  | { op: 'search'; q: string; offset?: number }
  | { op: 'playlists'; offset?: number }
  /** Música (toca só ela, e o Spotify segue com parecidas), playlist ou álbum. */
  | { op: 'play'; uri: string }
  | { op: 'resume' }
  | { op: 'pause' }
  | { op: 'next' }
  | { op: 'previous' }
  | { op: 'seek'; ms: number }
  | { op: 'shuffle'; on: boolean }
  | { op: 'repeat'; mode: 'off' | 'context' | 'track' }
  | { op: 'enqueue'; uri: string }
  /** Traz pro bot o que a conta está tocando em outro aparelho. */
  | { op: 'transfer' }

export type MusicError =
  | 'not-connected'
  | 'premium'
  /** O app do Spotify do Resenha está em modo de desenvolvimento e essa conta não foi liberada pelo dono. */
  | 'allowlist'
  /** Mutado pela moderação (ou sem permissão de falar): não dá pra pôr música. */
  | 'muted'
  | 'no-device'
  | 'rate'
  | 'network'
  | 'auth'
  | 'missing'
  | 'login'
  | 'off'
  | 'timeout'
  | 'failed'

export type MusicReply = { ok: true; data?: unknown } | { ok: false; error: MusicError }

export interface SpotifyStatus {
  /** O librespot (o Spotify que o bot usa por baixo) está instalado. */
  librespot: boolean
  /** Dá pra instalar por aqui (Arch e derivados: pacman). */
  installable: boolean
  /** Conta conectada (nome no Spotify), com o client ID usado no login. */
  account: { name: string; clientId: string } | null
  /** O bot está ligado agora. */
  running: boolean
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
  /** Rabiscos de quem assiste por cima do monitor que eu compartilho. */
  ink: {
    /** null: este sistema não tem como desenhar por cima da tela (falta o gtk4-layer-shell, GNOME...). */
    monitors(): Promise<InkMonitor[] | null>
    start(connector: string): Promise<{ ok: true } | { ok: false; error: string }>
    event(event: Record<string, unknown>): void
    stop(): void
    /** A camada fechou sozinha (o ajudante do Linux caiu). */
    onClosed(callback: () => void): void
  }
  screenAudio: {
    /** Apps tocando som agora (Linux), pro seletor do áudio da tela. */
    apps(): Promise<{ binary: string; name: string; voice: boolean }[]>
    start(options: { mode: 'all' | 'apps'; apps: string[] }): Promise<{ ok: boolean; error?: string }>
    unmute(): Promise<void>
    stop(): Promise<void>
  }
  attention(): void
  /** Traz a janela pra frente (clique num aviso do sistema). */
  showWindow(): void
  /** Convite aberto por um link resenha:// antes de o app terminar de abrir. */
  pendingInvite(): Promise<string | null>
  /** Convite aberto por um link resenha:// com o app já aberto. */
  onInvite(callback: (code: string) => void): void
  /** Abre a verificação anti-robô do servidor; devolve o token (ou null se fechou). */
  turnstile(server: string): Promise<string | null>
  /** Baixa um anexo com o diálogo de salvar do sistema. */
  download(url: string): void
  /** A interface trocou de idioma: bandeja, avisos e corretor acompanham. */
  setLocale(locale: 'pt' | 'en' | 'es'): void
  desktop: {
    get(): Promise<DesktopPrefs>
    /** Aplica e salva; devolve as preferências e os atalhos que o sistema recusou. */
    set(patch: Partial<DesktopPrefs>): Promise<{ prefs: DesktopPrefs; failed: ShortcutAction[] }>
    /** Os atalhos que o sistema recusou da última vez (tecla já usada, por exemplo). */
    failed(): Promise<ShortcutAction[]>
  }
  /** Bot do Spotify na call. */
  spotify: {
    status(): Promise<SpotifyStatus>
    /** Login no navegador (PKCE) com o app do Spotify do servidor. */
    connect(clientId: string): Promise<{ ok: true; name: string } | { ok: false; error: MusicError }>
    disconnect(): Promise<void>
    /** Instala o librespot (pkexec, ou terminal com sudo). */
    install(): Promise<boolean>
    /** Liga o bot: o librespot entra na conta como o aparelho "Resenha" e o som começa a vir. */
    start(): Promise<{ ok: true } | { ok: false; error: MusicError }>
    stop(): Promise<void>
    request(op: MusicOp): Promise<MusicReply>
    /** Pede mais som (PCM s16le, 44,1 kHz, estéreo): o librespot só anda no ritmo que o app toca. */
    want(bytes: number): void
    /** Joga fora o som que estava esperando (trocou de música: a nova começa na hora). */
    flush(): void
    onPcm(callback: (chunk: Uint8Array) => void): void
    /** O bot parou sozinho (o librespot caiu, a conta saiu...). */
    onStopped(callback: (error: MusicError) => void): void
    /** O librespot pediu o login dele no navegador (só na primeira vez), com o endereço quando ele escreve. */
    onBrowser(callback: (url: string | null) => void): void
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
    /** `rejoin`: a call em que a pessoa está, pro app voltar pra ela ao reabrir (o processo principal grava em disco antes de fechar). */
    install(rejoin?: unknown): Promise<void>
    onState(callback: (state: UpdateState) => void): void
    /** A call gravada antes de reiniciar pra atualizar (lida uma vez só; depois some). */
    takeRejoin(): Promise<unknown>
  }
}
