// Preferências locais (por instalação), guardadas no localStorage.

export type ScreenPreset = '720p' | '1080p' | '1440p'
export type ScreenMode = 'motion' | 'detail'
export type VideoCodec = 'VP9' | 'VP8' | 'H264' | 'AV1'

export interface Settings {
  inputDevice: string
  outputDevice: string
  echoCancellation: boolean
  noiseSuppression: boolean
  /** Desligado por padrão: o AGC do Chromium já baixou o volume do microfone do sistema. */
  autoGainControl: boolean
  screenPreset: ScreenPreset
  screenMode: ScreenMode
  screenAudio: boolean
  codec: VideoCodec
  /** userId -> 0..1 */
  userVolumes: Record<string, number>
  streamVolume: number
  showStats: boolean
}

const KEY = 'resenha.settings'

const defaults: Settings = {
  inputDevice: 'default',
  outputDevice: 'default',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
  screenPreset: '1440p',
  screenMode: 'motion',
  screenAudio: true,
  codec: 'VP9',
  userVolumes: {},
  streamVolume: 1,
  showStats: false,
}

function load(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
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
