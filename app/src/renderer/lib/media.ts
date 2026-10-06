import type { PlatformInfo } from '../../preload/api'
import { PRESETS, settings, type ScreenMode, type ScreenPreset } from './settings.svelte'

export async function getMicTrack(): Promise<MediaStreamTrack> {
  const base: MediaTrackConstraints = {
    echoCancellation: settings.echoCancellation,
    // Com o RNNoise do app ligado, o do Chromium fica desligado pra não filtrar duas vezes.
    noiseSuppression: settings.noiseReduction === 'browser',
    autoGainControl: settings.autoGainControl,
    channelCount: 1,
    sampleRate: 48_000,
  }
  const device = settings.inputDevice !== 'default' ? { deviceId: { exact: settings.inputDevice } } : {}
  try {
    return (await navigator.mediaDevices.getUserMedia({ audio: { ...base, ...device } })).getAudioTracks()[0]
  } catch (err) {
    // Dispositivo salvo sumiu (USB desplugado): volta pro padrão.
    if (!device.deviceId || (err as Error).name !== 'OverconstrainedError') throw err
    return (await navigator.mediaDevices.getUserMedia({ audio: base })).getAudioTracks()[0]
  }
}

let audioContext: AudioContext | null = null

/** Nível (RMS 0..1) de uma faixa local, pro indicador de quem está falando. */
export class LevelMeter {
  private source: MediaStreamAudioSourceNode
  private analyser: AnalyserNode
  private buffer: Float32Array<ArrayBuffer>

  constructor(track: MediaStreamTrack) {
    audioContext ??= new AudioContext({ latencyHint: 'interactive' })
    // Criado fora de um clique, o contexto pode nascer pausado e o medidor ficaria parado em zero.
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {})
    this.source = audioContext.createMediaStreamSource(new MediaStream([track]))
    this.analyser = audioContext.createAnalyser()
    this.analyser.fftSize = 512
    this.buffer = new Float32Array(this.analyser.fftSize)
    this.source.connect(this.analyser)
  }

  level(): number {
    this.analyser.getFloatTimeDomainData(this.buffer)
    let sum = 0
    for (const v of this.buffer) sum += v * v
    return Math.sqrt(sum / this.buffer.length)
  }

  close() {
    this.source.disconnect()
  }
}

async function findDevice(label: string, timeout = 3000): Promise<string | null> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const found = devices.find((d) => d.kind === 'audioinput' && d.label.includes(label))
    if (found) return found.deviceId
    await new Promise((r) => setTimeout(r, 150))
  }
  return null
}

/**
 * Imagem grande -> no máximo 2560 px no lado maior, em WebP. GIF fica como
 * está (pode ser animado). Se não compensar, manda o original.
 */
export async function compressImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type) || file.size < 150 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.88 })
    if (blob.size >= file.size * 0.9) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' })
  } catch {
    return file
  }
}

export interface ScreenCapture {
  stream: MediaStream
  /** Aviso pra mostrar (ex.: áudio da tela indisponível). */
  warning: string | null
}

/**
 * Captura a tela (até o preset, a 60 fps) e o áudio do sistema sem o som do
 * próprio app:
 * - Linux: o vídeo vem do portal; o áudio, do microfone virtual do venmic.
 * - Windows: os dois vêm do getDisplayMedia; o processo principal entrega
 *   'loopbackWithoutChrome', que exclui o nosso próprio áudio.
 */
export async function captureScreen(options: {
  platform: PlatformInfo
  sourceId: string | null
  preset: ScreenPreset
  mode: ScreenMode
  audio: boolean
}): Promise<ScreenCapture> {
  const { width, height } = PRESETS[options.preset]
  const viaVenmic = options.platform.screenAudio === 'venmic'
  const viaDisplayMedia = options.audio && !viaVenmic && options.platform.screenAudio !== 'none'

  await window.resenha.share.select({ sourceId: options.sourceId, audio: viaDisplayMedia })
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { max: width }, height: { max: height }, frameRate: { ideal: 60, max: 60 } },
    audio: viaDisplayMedia
      ? ({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false,
          restrictOwnAudio: true,
        } as MediaTrackConstraints)
      : false,
  })

  const [video] = stream.getVideoTracks()
  video.contentHint = options.mode === 'motion' ? 'motion' : 'detail'
  try {
    await video.applyConstraints({ width: { max: width }, height: { max: height }, frameRate: { ideal: 60, max: 60 } })
  } catch {
    // fica no que a captura entregou
  }

  let warning: string | null = null
  if (options.audio && viaVenmic) {
    try {
      const started = await window.resenha.screenAudio.start()
      if (!started.ok) throw new Error(started.error)
      const deviceId = await findDevice('vencord-screen-share')
      if (!deviceId) throw new Error('microfone virtual não apareceu')
      const audio = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 48_000,
        },
      })
      await window.resenha.screenAudio.unmute()
      stream.addTrack(audio.getAudioTracks()[0])
    } catch (err) {
      console.error('áudio da tela (venmic)', err)
      await window.resenha.screenAudio.stop()
      warning = 'Não deu pra capturar o áudio da tela; compartilhando só o vídeo.'
    }
  } else if (options.audio && options.platform.screenAudio === 'loopback-all') {
    warning = 'Neste Windows o áudio da tela inclui a voz da call. Atualize pro Windows 10 22H2 ou 11.'
  }

  for (const track of stream.getAudioTracks()) track.contentHint = 'music'
  return { stream, warning }
}

export async function stopCapture(stream: MediaStream | null) {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
  await window.resenha.screenAudio.stop()
}
