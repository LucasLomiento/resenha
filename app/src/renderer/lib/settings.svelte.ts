// Preferências locais (por instalação), guardadas no localStorage.

export type ScreenPreset = '720p' | '1080p' | '1440p'
export type ScreenMode = 'motion' | 'detail'
export type VideoCodec = 'VP9' | 'VP8' | 'H264' | 'AV1'

export interface Settings {
  /** Idioma do app: o do sistema (auto) ou um escolhido. */
  language: 'auto' | 'pt' | 'en' | 'es'
  inputDevice: string
  outputDevice: string
  cameraDevice: string
  echoCancellation: boolean
  /** rnnoise: dentro do app (igual ao noise-suppression-for-voice); browser: o do Chromium. */
  noiseReduction: 'rnnoise' | 'browser' | 'off'
  /** Limiar do microfone: só transmite acima dele (ou, no automático, quando detecta voz). */
  gate: { enabled: boolean; auto: boolean; thresholdDb: number }
  /**
   * Ganho automático do Chromium, só digital: o processo principal não deixa ele mexer no volume do
   * microfone no sistema (que ele chegou a baixar). Vem ligado só no Windows (`agcByDefault`).
   */
  autoGainControl: boolean
  screenPreset: ScreenPreset
  screenMode: ScreenMode
  screenAudio: boolean
  /** Linux: all = todos os apps menos os de voz; apps = só os escolhidos (binários). */
  screenAudioMode: 'all' | 'apps'
  screenAudioApps: string[]
  /** Mostrar o texto da mensagem nas notificações do sistema. */
  notifyContent: boolean
  codec: VideoCodec
  /** userId -> 0..2 (acima de 1 a voz é amplificada dentro do app, até 200%) */
  userVolumes: Record<string, number>
  streamVolume: number
  /** Volume do bot do Spotify (0..1): cada um ouve o bot no seu. */
  musicVolume: number
  /** Client ID do app do Spotify que a pessoa criou (o painel guarda enquanto ela ainda não conectou). */
  spotifyClientId: string
  /** Som da transmissão tirado pelo botão (o volume continua guardado pra quando voltar). */
  streamMuted: boolean
  /** Quem assiste a minha tela pode rabiscar nela. */
  inkAllowed: boolean
  /** Já numa call, trocar de canal de voz pede clique duplo (um clique só não tira ninguém da conversa). */
  voiceDoubleClick: boolean
  /** Na conexão direta, passar sozinho pro IPv4 ou pro IPv6 quando um deles tem o ping bem menor. */
  smartRoute: boolean
  /** Último monitor achado pros rabiscos (conector, ex.: DP-1): é o primeiro a ser testado. */
  inkMonitor: string | null
  /** Ferramenta pra rabiscar na tela dos outros. */
  inkTool: 'laser' | 'pen'
  /** Versão nova cujo aviso a pessoa fechou ("Depois"). */
  updateDismissed: string | null
  /** Largura da lista de canais (arrastando a borda dela). */
  sidebarWidth: number
  /** Quantas pessoas assistindo pra tela ir pelo SFU (sem opção na tela; o e2e usa 1). */
  sfuMinViewers?: number
  showStats: boolean
  sounds: boolean
  /** 0..1 */
  soundVolume: number
  messageSound: boolean
  /** Miniatura da transmissão: posição (px a partir da esquerda/topo) e largura. */
  pip: { x: number; y: number; width: number } | null
  /** Sobe quando um padrão novo precisa valer também pra quem já usava o app (o que muda fica no `load`). */
  revision: number
}

const KEY = 'resenha.settings'

/**
 * No Windows o Chromium abre o microfone em modo "raw", sem o processamento do driver, que é onde
 * muito notebook e headset aumenta o volume: sem o ganho automático, a voz chegava bem mais baixa
 * que no Discord (1.15.2). No Linux o microfone vem no volume que a pessoa deixou no sistema.
 */
export const agcByDefault = navigator.userAgent.includes('Windows')

const defaults: Settings = {
  language: 'auto',
  inputDevice: 'default',
  outputDevice: 'default',
  cameraDevice: 'default',
  echoCancellation: true,
  noiseReduction: 'rnnoise',
  gate: { enabled: false, auto: true, thresholdDb: -50 },
  autoGainControl: agcByDefault,
  screenPreset: '1440p',
  screenMode: 'motion',
  screenAudio: true,
  screenAudioMode: 'all',
  screenAudioApps: [],
  notifyContent: true,
  codec: 'VP9',
  userVolumes: {},
  streamVolume: 1,
  musicVolume: 0.5,
  spotifyClientId: '',
  streamMuted: false,
  inkAllowed: true,
  voiceDoubleClick: false,
  smartRoute: true,
  inkMonitor: null,
  inkTool: 'laser',
  updateDismissed: null,
  sidebarWidth: 248,
  showStats: false,
  sounds: true,
  soundVolume: 0.6,
  messageSound: true,
  pip: null,
  revision: 1,
}

function load(): Settings {
  try {
    const stored = localStorage.getItem(KEY)
    const saved = JSON.parse(stored ?? '{}') as Partial<Settings>
    // Quem já usava o app antes dos idiomas (1.9) continua em português; instalação nova segue o sistema.
    if (stored && !('language' in saved)) saved.language = 'pt'
    // Revisão 1 (1.15.2): pra quem já usava no Windows, o ganho automático liga uma vez só. Menos no
    // Estúdio, que é sem processamento nenhum de propósito.
    const studio = saved.noiseReduction === 'off' && saved.echoCancellation === false && !saved.gate?.enabled
    if (stored && (saved.revision ?? 0) < 1 && agcByDefault && !studio) saved.autoGainControl = true
    return { ...defaults, ...saved }
  } catch {
    return { ...defaults }
  }
}

export const settings = $state<Settings>(load())

/**
 * Grava na hora, mas no máximo uma vez a cada 300 ms: arrastar a borda da lista ou a miniatura
 * da transmissão mexe nas configurações a cada movimento do mouse (eram dezenas de gravações por
 * segundo). O que muda dentro da janela vai numa gravação só no fim dela, ou ao fechar a página.
 */
let pending: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastWrite = 0

function flush() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (pending === null) return
  try {
    localStorage.setItem(KEY, pending)
  } catch {
    // sem armazenamento, segue com o que está na memória
  }
  pending = null
  lastWrite = Date.now()
}

$effect.root(() => {
  $effect(() => {
    pending = JSON.stringify(settings)
    if (saveTimer) return // já tem uma gravação marcada: ela leva o mais novo
    const wait = lastWrite + 300 - Date.now()
    if (wait <= 0) flush()
    else saveTimer = setTimeout(flush, wait)
  })
})
addEventListener('pagehide', flush)

export const PRESETS: Record<ScreenPreset, { width: number; height: number; bitrate: number; label: string }> = {
  '720p': { width: 1280, height: 720, bitrate: 4_000_000, label: '720p' },
  '1080p': { width: 1920, height: 1080, bitrate: 8_000_000, label: '1080p' },
  '1440p': { width: 2560, height: 1440, bitrate: 12_000_000, label: '1440p (QHD)' },
}
