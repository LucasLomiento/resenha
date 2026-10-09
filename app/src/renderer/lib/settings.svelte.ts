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
  /** Desligado por padrão: o AGC do Chromium já baixou o volume do microfone do sistema. */
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
  /** userId -> 0..1 */
  userVolumes: Record<string, number>
  streamVolume: number
  /** Som da transmissão tirado pelo botão (o volume continua guardado pra quando voltar). */
  streamMuted: boolean
  /** Quem assiste a minha tela pode rabiscar nela. */
  inkAllowed: boolean
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
}

const KEY = 'resenha.settings'

const defaults: Settings = {
  language: 'auto',
  inputDevice: 'default',
  outputDevice: 'default',
  cameraDevice: 'default',
  echoCancellation: true,
  noiseReduction: 'rnnoise',
  gate: { enabled: false, auto: true, thresholdDb: -50 },
  autoGainControl: false,
  screenPreset: '1440p',
  screenMode: 'motion',
  screenAudio: true,
  screenAudioMode: 'all',
  screenAudioApps: [],
  notifyContent: true,
  codec: 'VP9',
  userVolumes: {},
  streamVolume: 1,
  streamMuted: false,
  inkAllowed: true,
  inkMonitor: null,
  inkTool: 'laser',
  updateDismissed: null,
  sidebarWidth: 248,
  showStats: false,
  sounds: true,
  soundVolume: 0.6,
  messageSound: true,
  pip: null,
}

function load(): Settings {
  try {
    const stored = localStorage.getItem(KEY)
    const saved = JSON.parse(stored ?? '{}') as Partial<Settings>
    // Quem já usava o app antes dos idiomas (1.9) continua em português; instalação nova segue o sistema.
    if (stored && !('language' in saved)) saved.language = 'pt'
    return { ...defaults, ...saved }
  } catch {
    return { ...defaults }
  }
}

export const settings = $state<Settings>(load())

$effect.root(() => {
  $effect(() => {
    const snapshot = JSON.stringify(settings)
    try {
      localStorage.setItem(KEY, snapshot)
    } catch {
      // sem armazenamento, segue com o que está na memória
    }
  })
})

export const PRESETS: Record<ScreenPreset, { width: number; height: number; bitrate: number; label: string }> = {
  '720p': { width: 1280, height: 720, bitrate: 4_000_000, label: '720p' },
  '1080p': { width: 1920, height: 1080, bitrate: 8_000_000, label: '1080p' },
  '1440p': { width: 2560, height: 1440, bitrate: 12_000_000, label: '1440p (QHD)' },
}
