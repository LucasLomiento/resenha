// Converte a gravação (PCM mono em Float32) pra MP3 fora da tela, pra não travar
// o app: o LAME em JavaScript leva uns segundos pra uma mensagem longa.

import { Mp3Encoder } from '@breezystack/lamejs'

export interface Mp3Job {
  pcm: Float32Array
  sampleRate: number
  kbps: number
}

/** Quadro do MP3 (o LAME trabalha de 1152 em 1152 amostras). */
const FRAME = 1152

self.onmessage = (event: MessageEvent<Mp3Job>) => {
  const { pcm, sampleRate, kbps } = event.data
  const encoder = new Mp3Encoder(1, sampleRate, kbps)
  const chunks: Uint8Array[] = []
  const block = new Int16Array(FRAME)
  for (let i = 0; i < pcm.length; i += FRAME) {
    const length = Math.min(FRAME, pcm.length - i)
    for (let j = 0; j < length; j++) {
      const s = Math.max(-1, Math.min(1, pcm[i + j]))
      block[j] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const out = encoder.encodeBuffer(length === FRAME ? block : block.subarray(0, length))
    if (out.length) chunks.push(out.slice())
  }
  const tail = encoder.flush()
  if (tail.length) chunks.push(tail.slice())
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const mp3 = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    mp3.set(c, at)
    at += c.length
  }
  ;(self as unknown as Worker).postMessage(mp3, [mp3.buffer])
}
