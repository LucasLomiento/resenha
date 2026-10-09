// Mensagem de voz: grava o microfone (MediaRecorder, leve enquanto grava), no fim
// converte pra MP3 (que abre em qualquer lugar, e dá pra baixar) num worker, e
// desenha a "onda" do áudio pro player do chat.

import { m } from './i18n.svelte'
import { settings } from './settings.svelte'
import type { Mp3Job } from './mp3-worker'
import Mp3Worker from './mp3-worker.ts?worker'

/** Até onde uma mensagem de voz vai (em 64 kbps, 15 min dá uns 7 MB). */
export const VOICE_MAX_SECONDS = 15 * 60
/** Voz em mono a 64 kbps: clara e pequena (uns 480 KB por minuto). */
const KBPS = 64
/** Começo do nome do arquivo: o chat reconhece e mostra como mensagem de voz. */
export const VOICE_PREFIX = 'mensagem-de-voz'

export const isVoiceNote = (name: string) => name.startsWith(VOICE_PREFIX)

/** Como um anexo aparece em resumos (aviso, busca, fixadas). */
export const attachmentLabel = (attachment: { name: string }) => (isVoiceNote(attachment.name) ? m.lib.voiceNote.label : `📎 ${attachment.name}`)

/** Uma gravação em andamento. */
export class VoiceRecording {
  private chunks: Blob[] = []
  private buffer: Float32Array<ArrayBuffer>
  private readonly startedAt = performance.now()
  private stopped = false

  private constructor(
    private stream: MediaStream,
    private recorder: MediaRecorder,
    private context: AudioContext,
    private analyser: AnalyserNode,
  ) {
    this.buffer = new Float32Array(analyser.fftSize)
    recorder.ondataavailable = (event) => event.data.size && this.chunks.push(event.data)
  }

  static async start(): Promise<VoiceRecording> {
    const device = settings.inputDevice === 'default' ? undefined : { exact: settings.inputDevice }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: device, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    try {
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 96_000 })
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      context.createMediaStreamSource(stream).connect(analyser)
      recorder.start(1000)
      return new VoiceRecording(stream, recorder, context, analyser)
    } catch (err) {
      for (const track of stream.getTracks()) track.stop()
      throw err
    }
  }

  get seconds(): number {
    return (performance.now() - this.startedAt) / 1000
  }

  /** Volume agora, de 0 a 1 (pras barrinhas enquanto grava). */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.buffer)
    let sum = 0
    for (const v of this.buffer) sum += v * v
    return Math.min(1, Math.sqrt(Math.sqrt(sum / this.buffer.length)) * 1.6)
  }

  /** Para e devolve o MP3 pronto pra enviar. */
  async finish(): Promise<{ file: File; seconds: number }> {
    const seconds = this.seconds
    const recorded = await this.stop()
    const pcm = await decodeMono(await recorded.arrayBuffer())
    const mp3 = await encodeMp3(pcm.data, pcm.sampleRate)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    return { file: new File([mp3], `${VOICE_PREFIX}-${stamp}.mp3`, { type: 'audio/mpeg' }), seconds: pcm.seconds || seconds }
  }

  cancel() {
    void this.stop()
  }

  private stop(): Promise<Blob> {
    if (this.stopped) return Promise.resolve(new Blob(this.chunks, { type: 'audio/webm' }))
    this.stopped = true
    return new Promise((resolve) => {
      const done = () => {
        for (const track of this.stream.getTracks()) track.stop()
        void this.context.close().catch(() => {})
        resolve(new Blob(this.chunks, { type: 'audio/webm' }))
      }
      if (this.recorder.state === 'inactive') return done()
      this.recorder.onstop = done
      this.recorder.stop()
    })
  }
}

/** Decodifica qualquer áudio (a gravação em WebM, ou o MP3 do chat) e mistura em mono. */
async function decodeMono(data: ArrayBuffer): Promise<{ data: Float32Array; sampleRate: number; seconds: number }> {
  // Contexto offline: decodifica sem abrir a saída de som.
  const context = new OfflineAudioContext(1, 1, 48_000)
  const audio = await context.decodeAudioData(data)
  const mono = new Float32Array(audio.length)
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const samples = audio.getChannelData(channel)
    for (let i = 0; i < samples.length; i++) mono[i] += samples[i] / audio.numberOfChannels
  }
  return { data: mono, sampleRate: audio.sampleRate, seconds: audio.duration }
}

function encodeMp3(pcm: Float32Array, sampleRate: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const worker = new Mp3Worker()
    worker.onmessage = (event: MessageEvent<Uint8Array<ArrayBuffer>>) => {
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || m.lib.voiceNote.convertFailed))
    }
    const job: Mp3Job = { pcm, sampleRate, kbps: KBPS }
    worker.postMessage(job, [pcm.buffer])
  })
}

// ---------- Onda do áudio no chat ----------

const waves = new Map<string, Promise<{ bars: number[]; seconds: number }>>()
/** Uma decodificação por vez: abrir uma conversa cheia de áudios não engasga o app. */
let queue: Promise<unknown> = Promise.resolve()

/** Barras da onda (0 a 1) e a duração; guardado por anexo, calculado uma vez só. */
export function voiceWave(id: string, url: string, count: number): Promise<{ bars: number[]; seconds: number }> {
  let wave = waves.get(id)
  if (!wave) {
    wave = queue.then(async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const { data, seconds } = await decodeMono(await response.arrayBuffer())
      return { bars: barsOf(data, count), seconds }
    })
    queue = wave.catch(() => {})
    waves.set(id, wave)
    wave.catch(() => waves.delete(id))
  }
  return wave
}

function barsOf(pcm: Float32Array, count: number): number[] {
  const size = Math.max(1, Math.floor(pcm.length / count))
  const bars: number[] = []
  for (let b = 0; b < count; b++) {
    let peak = 0
    let sum = 0
    const start = b * size
    for (let i = start; i < Math.min(pcm.length, start + size); i++) {
      const v = Math.abs(pcm[i])
      sum += v * v
      if (v > peak) peak = v
    }
    // Meio-termo entre o pico e o RMS: a fala aparece, o silêncio fica baixo.
    bars.push(peak * 0.4 + Math.sqrt(sum / size) * 0.6)
  }
  const max = Math.max(...bars, 1e-4)
  return bars.map((v) => Math.max(0.08, Math.min(1, v / max)))
}

/** 75 → "1:15". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
