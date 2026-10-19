import { isAnimated } from '../../../../shared/media'
import type { PlatformInfo } from '../../preload/api'
import { m } from './i18n.svelte'
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

/** Câmera em 720p a 30 fps (pra call em grupo, mais que isso só pesa no upload). No celular,
 *  `facing` escolhe a da frente ou a de trás (no lugar do aparelho das configurações). */
export async function getCameraStream(facing?: 'user' | 'environment'): Promise<MediaStream> {
  const base: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
  if (facing) base.facingMode = { ideal: facing }
  const device = !facing && settings.cameraDevice !== 'default' ? { deviceId: { exact: settings.cameraDevice } } : {}
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { ...base, ...device } })
  } catch (err) {
    if (!device.deviceId || (err as Error).name !== 'OverconstrainedError') throw err
    stream = await navigator.mediaDevices.getUserMedia({ video: base })
  }
  for (const track of stream.getVideoTracks()) track.contentHint = 'motion'
  return stream
}

let audioContext: AudioContext | null = null
/** Medidores abertos: sem nenhum, o contexto dorme (não segura a saída de som acordada). */
let meters = 0

/** Nível (RMS 0..1) de uma faixa local, pro indicador de quem está falando. */
export class LevelMeter {
  private source: MediaStreamAudioSourceNode
  private analyser: AnalyserNode
  private buffer: Float32Array<ArrayBuffer>
  private closed = false

  constructor(track: MediaStreamTrack) {
    audioContext ??= new AudioContext({ latencyHint: 'interactive' })
    // Criado fora de um clique, o contexto pode nascer pausado e o medidor ficaria parado em zero.
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {})
    this.source = audioContext.createMediaStreamSource(new MediaStream([track]))
    this.analyser = audioContext.createAnalyser()
    this.analyser.fftSize = 512
    this.buffer = new Float32Array(this.analyser.fftSize)
    this.source.connect(this.analyser)
    meters++
  }

  level(): number {
    this.analyser.getFloatTimeDomainData(this.buffer)
    let sum = 0
    for (const v of this.buffer) sum += v * v
    return Math.sqrt(sum / this.buffer.length)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.source.disconnect()
    meters = Math.max(0, meters - 1)
    if (meters === 0 && audioContext?.state === 'running') void audioContext.suspend().catch(() => {})
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
 * Imagem grande -> no máximo 2560 px no lado maior, em WebP. GIF e imagem animada ficam como
 * estão (o canvas pegaria só o primeiro quadro). Foto em JPEG sempre passa pelo canvas, mesmo
 * pequena: sai sem o EXIF, que pode ter até o GPS de onde ela foi tirada. Fora isso, se não
 * compensar, manda o original.
 */
export async function compressImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) return file
  const jpeg = file.type === 'image/jpeg'
  if (!jpeg && (file.size < 150 * 1024 || (await animated(file)))) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.88 })
    if (!jpeg && blob.size >= file.size * 0.9) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' })
  } catch {
    return file
  }
}

/** WebP ou PNG animado (APNG)? Olha só o começo do arquivo. */
async function animated(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer())
  if (file.type === 'image/webp') return isAnimated(bytes)
  if (file.type !== 'image/png') return false
  // APNG: o pedaço `acTL` vem antes do primeiro `IDAT`.
  for (let at = 8; at + 8 <= bytes.length; ) {
    const size = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    if (type === 'acTL') return true
    if (type === 'IDAT') return false
    at += 12 + size
  }
  return false
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
      const started = await window.resenha.screenAudio.start({
        mode: settings.screenAudioMode,
        apps: [...settings.screenAudioApps],
      })
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
      warning = m.lib.media.screenAudioFailed
    }
  } else if (options.audio && options.platform.screenAudio === 'loopback-all') {
    warning = m.lib.media.screenAudioOldWindows
  }

  for (const track of stream.getAudioTracks()) track.contentHint = 'music'
  return { stream, warning }
}

export async function stopCapture(stream: MediaStream | null) {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
  await window.resenha.screenAudio.stop()
}
