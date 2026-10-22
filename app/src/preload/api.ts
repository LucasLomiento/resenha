// Contrato entre o renderer e o processo principal (exposto como window.resenha).

export interface PlatformInfo {
  platform: string
  /** No Wayland quem escolhe a tela é o seletor do portal, não o nosso. */
  portalPicker: boolean
  /**
   * Como o áudio da tela é capturado sem a voz da call:
   * - venmic: Linux/PipeWire, todos os apps menos o nosso
   * - exclude-self: sistema inteiro menos o nosso processo (o processo principal não manda mais:
   *   o Electron 44 não aceita o 'loopbackWithoutChrome'; fica pra quando ele aceitar)
   * - loopback-all: Windows, pega tudo (a voz da call vai junto)
   * - none: sem áudio da tela
   */
  screenAudio: 'venmic' | 'exclude-self' | 'loopback-all' | 'none'
  version: string
  /** No Hyprland atalho global só funciona por bind no config dele. */
  hyprland: boolean
  /** Dá pra pôr o Spotify na call (Linux, ou Windows com o librespot embutido no pacote). */
  music: boolean
  /** App de celular (Android): sem o que é só de computador (compartilhar tela, bandeja, atalhos, zoom...). */
  mobile: boolean
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
  /** Onde ("sala · servidor"), pra notificação da call no celular. */
  place?: string
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
  /** O artista principal (o estilo é dele). */
  artistId: string | null
  /** Estilos do artista principal (até 3; vazio quando o Spotify não tem). */
  genres: string[]
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
  /** O client ID colado não tem o formato de um (32 letras e números). */
  | 'client-id'
  /** Uma porta que o login do Spotify precisa (5589, a do app da pessoa, ou 8898, a do app de computador) está ocupada. */
  | 'port'
  /** O Spotify está recusando clientes como o librespot agora (503 do lado dele). */
  | 'unavailable'
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
  /** Conta conectada (nome no Spotify) e o client ID do app da pessoa. */
  account: { name: string; clientId: string } | null
  /** O redirect que a pessoa cadastra no app dela no site do Spotify. */
  ownRedirect: string
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
    /**
     * Windows: o Electron recusou o áudio da tela (a transmissão saiu só com o vídeo). Daqui pra
     * frente o `platform()` diz `screenAudio: 'none'`; a interface tira a opção de compartilhar o som.
     */
    onUnavailable?(callback: () => void): void
  }
  /** Os avisos de licença do que vai no app (THIRD_PARTY_LICENSES.txt); null se o arquivo não veio no build. */
  licenses?(): Promise<string | null>
  attention(): void
  /** Traz a janela pra frente (clique num aviso do sistema). */
  showWindow(): void
  /** Convite aberto por um link resenha:// antes de o app terminar de abrir. */
  pendingInvite(): Promise<string | null>
  /** Convite aberto por um link resenha:// com o app já aberto. */
  onInvite(callback: (code: string) => void): void
  /** Aviso do sistema. `tag`: o novo com a mesma etiqueta troca o anterior (um por conversa). */
  notify(title: string, options: { body: string; tag?: string }, onclick?: () => void): void
  /** Tira o aviso dessa etiqueta (a pessoa já viu, aqui ou em outro aparelho). */
  dismissNotification(tag: string): void
  /** Celular: notificação push (Firebase). Sem isso (computador, ou APK sem Firebase), os avisos são os do app aberto. */
  push?: {
    /** O token deste aparelho (pede a permissão na primeira vez); null se não deu. */
    token(): Promise<string | null>
    /** Se o Android deixa o app avisar (`prompt`: ainda não perguntou). */
    permission(): Promise<'granted' | 'denied' | 'prompt'>
    /** Tocou num aviso: o `data` que o servidor pôs nele. Chega também o toque que abriu o app. */
    onOpen(callback: (data: Record<string, string>) => void): void
    /** O Firebase trocou o token deste aparelho (o app manda o novo pro servidor). */
    onToken?(callback: (token: string) => void): void
  }
  /** Botão voltar do celular: a função devolve false quando não tinha o que fechar (aí o app vai pro fundo). */
  onBack?(callback: () => boolean): void
  /** Abre a verificação anti-robô do servidor; devolve o token (ou null se fechou). */
  turnstile(server: string): Promise<string | null>
  /** Baixa um anexo com o diálogo de salvar do sistema. */
  download(url: string): void
  /** A interface trocou de idioma: bandeja, avisos e corretor acompanham. */
  setLocale(locale: 'pt' | 'en' | 'es'): void
  desktop: {
    /** null: sem nada disso (celular: sem bandeja, atalhos nem zoom). */
    get(): Promise<DesktopPrefs | null>
    /** Aplica e salva; devolve as preferências e os atalhos que o sistema recusou. */
    set(patch: Partial<DesktopPrefs>): Promise<{ prefs: DesktopPrefs; failed: ShortcutAction[] }>
    /** Os atalhos que o sistema recusou da última vez (tecla já usada, por exemplo). */
    failed(): Promise<ShortcutAction[]>
  }
  /** Bot do Spotify na call. */
  spotify: {
    status(): Promise<SpotifyStatus>
    /** Login no navegador (PKCE): o app da pessoa (Web API) e o app de computador do Spotify (pro librespot), em seguida. */
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
  /** O PC acordou (só no computador): a página confere as conexões. */
  onResume?(callback: () => void): void
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
