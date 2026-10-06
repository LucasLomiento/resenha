// Testa o processador do microfone (RNNoise + limiar) no Node, sem áudio de
// verdade: monta o worklet com um AudioWorkletProcessor de mentira e alimenta
// blocos de 128 amostras, como o navegador faz.
// Uso: node --test test/mic-worklet.test.mjs

import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const RATE = 48_000
const QUANTUM = 128

let Processor
globalThis.sampleRate = RATE
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { postMessage: (msg) => this.messages.push(msg), onmessage: null }
    this.messages = []
  }
}
globalThis.registerProcessor = (_name, cls) => (Processor = cls)

const bundle = await build({
  entryPoints: [new URL('../src/renderer/lib/mic-worklet.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'silent',
})
await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

function make(options) {
  return new Processor({ processorOptions: { denoise: false, gate: false, auto: false, thresholdDb: -50, ...options } })
}

/** Roda `seconds` de sinal e devolve a saída inteira. */
function run(processor, signal) {
  const out = new Float32Array(signal.length)
  for (let i = 0; i + QUANTUM <= signal.length; i += QUANTUM) {
    const output = [[new Float32Array(QUANTUM)]]
    processor.process([[signal.subarray(i, i + QUANTUM)]], output)
    out.set(output[0][0], i)
  }
  return out
}

const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
const seconds = (s) => new Float32Array(Math.round(RATE * s))
let seed = 1
const noise = (amp) => (seed = (seed * 16807) % 2147483647) / 2147483647 * 2 * amp - amp

test('sem nada ligado, passa igual, só com o atraso fixo de um bloco de 10 ms', () => {
  const p = make({})
  const input = seconds(0.2).map((_, i) => Math.sin((i / RATE) * 2 * Math.PI * 440) * 0.5)
  const out = run(p, input)
  // Procura o atraso que alinha a saída com a entrada.
  let best = { lag: -1, err: Infinity }
  for (let lag = 0; lag <= 960; lag++) {
    let err = 0
    for (let i = 2000; i < 6000; i++) err += Math.abs(out[i + lag] - input[i])
    if (err < best.err) best = { lag, err }
  }
  assert.equal(best.lag, 480, `atraso de ${best.lag} amostras`)
  assert.ok(best.err < 1e-3)
})

test('RNNoise derruba ruído branco', () => {
  const input = seconds(1).map(() => noise(0.1))
  const plain = run(make({}), input).subarray(RATE / 2)
  const denoised = run(make({ denoise: true }), input).subarray(RATE / 2)
  const drop = 20 * Math.log10(rms(denoised) / rms(plain))
  assert.ok(drop < -15, `caiu só ${drop.toFixed(1)} dB`)
})

test('limiar manual: corta o som baixo e deixa passar o alto', () => {
  const quiet = seconds(0.5).map((_, i) => Math.sin(i / 7) * 0.001) // ~ -63 dB
  const loud = seconds(0.5).map((_, i) => Math.sin(i / 7) * 0.3) // ~ -13 dB
  const p = make({ gate: true, thresholdDb: -40 })
  const out = run(p, Float32Array.from([...quiet, ...loud]))
  assert.ok(rms(out.subarray(4800, 23_000)) < 1e-5, 'baixo devia sair mudo')
  assert.ok(rms(out.subarray(30_000, 47_000)) > 0.15, 'alto devia passar')
  const last = p.messages.at(-1)
  assert.equal(last.open, true)
})

test('limiar segura uns 300 ms depois da voz parar, e depois fecha', () => {
  const loud = seconds(0.3).map((_, i) => Math.sin(i / 7) * 0.3)
  const silence = seconds(0.6)
  const p = make({ gate: true, thresholdDb: -40 })
  run(p, Float32Array.from([...loud, ...silence]))
  // 50 ms entre mensagens: ~200 ms depois do fim ainda aberto, ~500 ms depois já fechado.
  const opens = p.messages.map((m) => m.open)
  const endOfVoice = Math.round(0.3 / 0.05)
  assert.equal(opens[endOfVoice + 3], true)
  assert.equal(opens.at(-1), false)
})
