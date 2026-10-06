// Processa o microfone fora da thread da interface (AudioWorklet):
//  1. Redução de ruído com RNNoise (o mesmo filtro do noise-suppression-for-voice),
//     em blocos de 480 amostras (10 ms a 48 kHz).
//  2. Limiar: só deixa passar quando o volume passa do limiar escolhido, ou,
//     no automático, quando o RNNoise detecta voz. Abre na hora, segura um
//     pouco depois que a voz para e fecha suave, sem estalo.
// Manda pro app, ~20 vezes por segundo, o nível e se o limiar está aberto.

import createRnnoise from '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js'

declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

export interface MicOptions {
  denoise: boolean
  gate: boolean
  /** No automático, quem decide é a detecção de voz do RNNoise. */
  auto: boolean
  thresholdDb: number
}

const FRAME = 480
const HOLD_FRAMES = 30 // 300 ms segurando aberto depois da última fala
const REPORT_EVERY = 5 // 50 ms

class MicProcessor extends AudioWorkletProcessor {
  private options: MicOptions
  /** null se o RNNoise não subiu: aí segue só com o limiar por volume. */
  private rnnoise: ReturnType<typeof createRnnoise> | null = null
  private state = 0
  private inPtr = 0
  private outPtr = 0
  private alive = true
  private input = new Float32Array(FRAME * 4)
  private inputLength = 0
  // Começa com um bloco de silêncio: é o atraso fixo (~10 ms) que garante
  // sempre ter amostra processada pra entregar.
  private output = new Float32Array(FRAME * 4)
  private outputLength = FRAME
  private gain = 0
  private hold = 0
  private open = false
  private frames = 0
  private levelDb = -100
  private vad = 0
  /** Buffer reaproveitado: nada é alocado dentro do loop de áudio. */
  private frameOut = new Float32Array(FRAME)

  constructor(init: { processorOptions: MicOptions }) {
    super()
    this.options = init.processorOptions
    try {
      this.rnnoise = createRnnoise()
      this.state = this.rnnoise._rnnoise_create()
      this.inPtr = this.rnnoise._malloc(FRAME * 4)
      this.outPtr = this.rnnoise._malloc(FRAME * 4)
    } catch (err) {
      this.rnnoise = null
      this.port.postMessage({ error: `RNNoise não carregou: ${(err as Error)?.message ?? err}` })
    }
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data === 'close') return this.destroy()
      this.options = { ...this.options, ...event.data }
    }
  }

  private destroy() {
    this.alive = false
    if (!this.rnnoise || !this.state) return
    this.rnnoise._rnnoise_destroy(this.state)
    this.rnnoise._free(this.inPtr)
    this.rnnoise._free(this.outPtr)
    this.state = 0
  }

  private processFrame(frame: Float32Array): Float32Array {
    const { denoise, gate, auto, thresholdDb } = this.options
    const out = this.frameOut
    out.set(frame)
    if (this.rnnoise && (denoise || (gate && auto))) {
      // O RNNoise espera amostras na escala de 16 bits.
      const heap = this.rnnoise.HEAPF32
      const inIndex = this.inPtr >> 2
      const outIndex = this.outPtr >> 2
      for (let i = 0; i < FRAME; i++) heap[inIndex + i] = frame[i] * 32768
      this.vad = this.rnnoise._rnnoise_process_frame(this.state, this.outPtr, this.inPtr)
      if (denoise) for (let i = 0; i < FRAME; i++) out[i] = heap[outIndex + i] / 32768
    }

    let sum = 0
    for (let i = 0; i < FRAME; i++) sum += out[i] * out[i]
    this.levelDb = Math.max(-100, 10 * Math.log10(sum / FRAME + 1e-12))

    // Sem RNNoise o automático cai pro limiar por volume.
    const byVoice = auto && this.rnnoise !== null
    const active = !gate || (byVoice ? this.vad > (this.open ? 0.3 : 0.6) : this.levelDb > thresholdDb)
    if (active) this.hold = HOLD_FRAMES
    else if (this.hold > 0) this.hold--
    this.open = this.hold > 0

    // Abre em ~2 ms e fecha em ~30 ms: rápido pra não comer o começo da palavra, suave pra não estalar.
    const target = this.open ? 1 : 0
    const attack = 1 - Math.exp(-1 / (0.002 * sampleRate))
    const release = 1 - Math.exp(-1 / (0.03 * sampleRate))
    for (let i = 0; i < FRAME; i++) {
      this.gain += (target - this.gain) * (target > this.gain ? attack : release)
      out[i] *= this.gain
    }

    if (++this.frames % REPORT_EVERY === 0) {
      this.port.postMessage({ levelDb: this.levelDb, open: this.open, vad: this.vad })
    }
    return out
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.alive) return false
    const input = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    if (!output) return true
    if (input) {
      this.input.set(input, this.inputLength)
      this.inputLength += input.length
      while (this.inputLength >= FRAME) {
        const processed = this.processFrame(this.input.subarray(0, FRAME))
        this.input.copyWithin(0, FRAME, this.inputLength)
        this.inputLength -= FRAME
        this.output.set(processed, this.outputLength)
        this.outputLength += FRAME
      }
    }
    const take = Math.min(output.length, this.outputLength)
    output.set(this.output.subarray(0, take))
    if (take < output.length) output.fill(0, take)
    this.output.copyWithin(0, take, this.outputLength)
    this.outputLength -= take
    // Saída mono do microfone vai pros dois canais do nó.
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(output)
    return true
  }
}

registerProcessor('resenha-mic', MicProcessor)
