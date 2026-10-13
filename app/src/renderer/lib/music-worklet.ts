// Som do bot do Spotify, dentro de um AudioWorklet: o PCM cru do librespot
// (s16le, 44,1 kHz, estéreo, vindo do processo principal aos pedaços) vira a
// saída do nó, que vira a faixa que vai pra call. Roda num AudioContext de
// 44,1 kHz, então não precisa reamostrar.
//
// Guarda um pouco de som (~0,4 s, quem pede é o renderer pelo nível que este
// nó informa) e só começa a tocar com uma folga, pra não picotar. Faltou som
// (pausou, a rede do Spotify engasgou): sai silêncio e espera a folga de novo.

declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

/** Começa (ou volta) a tocar com isso guardado. */
const PRIME = 0.15
/** Mais que isso guardado é engano (pediram demais): descarta o mais velho. */
const CAPACITY = 3

export type MusicWorkletMessage = { pcm: ArrayBuffer } | { flush: true }

class MusicProcessor extends AudioWorkletProcessor {
  private left = new Float32Array(Math.ceil(sampleRate * CAPACITY))
  private right = new Float32Array(Math.ceil(sampleRate * CAPACITY))
  private read = 0
  private size = 0
  private playing = false
  private blocks = 0

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<MusicWorkletMessage>) => {
      const data = event.data
      if ('flush' in data) {
        this.read = this.size = 0
        this.playing = false
        this.report()
      } else if (data.pcm instanceof ArrayBuffer) this.push(new Int16Array(data.pcm, 0, data.pcm.byteLength >> 1))
    }
  }

  private push(samples: Int16Array) {
    const capacity = this.left.length
    const frames = samples.length >> 1
    for (let i = 0; i < frames; i++) {
      if (this.size === capacity) {
        this.read = (this.read + 1) % capacity
        this.size--
      }
      const at = (this.read + this.size) % capacity
      this.left[at] = samples[i * 2] / 32768
      this.right[at] = samples[i * 2 + 1] / 32768
      this.size++
    }
  }

  /** Quanto som tem guardado (quadros), pro renderer pedir o que falta. */
  private report() {
    this.port.postMessage({ level: this.size })
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [outLeft, outRight] = outputs[0]
    const frames = outLeft.length
    if (!this.playing && this.size >= sampleRate * PRIME) this.playing = true
    if (this.playing && this.size >= frames) {
      const capacity = this.left.length
      for (let i = 0; i < frames; i++) {
        outLeft[i] = this.left[this.read]
        if (outRight) outRight[i] = this.right[this.read]
        this.read = (this.read + 1) % capacity
      }
      this.size -= frames
    } else {
      outLeft.fill(0)
      outRight?.fill(0)
      // Acabou o que tinha: espera juntar a folga antes de voltar (senão picota).
      this.playing = false
    }
    // ~25 vezes por segundo.
    if (++this.blocks % 14 === 0) this.report()
    return true
  }
}

registerProcessor('resenha-music', MusicProcessor)
