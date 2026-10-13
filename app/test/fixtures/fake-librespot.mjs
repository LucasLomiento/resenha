#!/usr/bin/env node
// librespot de mentira pro e2e (RESENHA_LIBRESPOT aponta pra cá). Faz o que o
// app espera do de verdade: entra na conta (com o token em LIBRESPOT_ACCESS_TOKEN,
// como o de verdade lê do ambiente, ou com a credencial guardada no
// --system-cache), avisa no stderr e escreve PCM s16le
// 44,1 kHz estéreo no --device (o FIFO do app). O som é um tom diferente em
// cada lado (esquerda muda com a música, direita fixa em 1500 Hz) e só sai
// enquanto o Spotify de mentira diz que está tocando; pausado, fecha o FIFO
// (o de verdade fecha a saída ao pausar). Escreve o mais rápido que o FIFO
// deixa: quem segura o ritmo é o app (o teste confere quanto ele andou na frente).

import { closeSync, existsSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const base = (process.env.RESENHA_SPOTIFY_API ?? '').replace(/\/v1$/, '')
const cache = option('--system-cache')
const device = option('--device')
const credentials = join(cache, 'credentials.json')

const token = process.env.LIBRESPOT_ACCESS_TOKEN ?? option('--access-token')
if (!token && !existsSync(credentials)) {
  console.error('[ERROR librespot] Credentials are required if discovery and oauth login are disabled.')
  process.exit(1)
}
mkdirSync(cache, { recursive: true })
writeFileSync(credentials, JSON.stringify({ username: 'teste', auth_type: 1 }))
console.error("[2026-10-13T00:00:00Z INFO  librespot_core::session] Authenticated as 'teste' !")

const post = (path, body) => fetch(`${base}/__fake/${path}`, { method: 'POST', body: JSON.stringify(body) }).catch(() => {})
await post('started', { args, tokenFromEnv: !!process.env.LIBRESPOT_ACCESS_TOKEN })

const RATE = 44_100
const FRAMES = 2205
let tone = { playing: false, left: 440, right: 1500 }
setInterval(async () => {
  try {
    tone = await (await fetch(`${base}/__fake/tone`)).json()
  } catch {
    // o teste acabou
  }
}, 150)

// Quanto som saiu e quanto tempo passou tocando: o app tem que segurar o librespot perto do que toca.
let written = 0
let playingMs = 0
let last = Date.now()
setInterval(() => {
  const now = Date.now()
  if (tone.playing) playingMs += now - last
  last = now
}, 50)
setInterval(() => void post('written', { audio: written / (RATE * 4), playing: playingMs / 1000 }), 500)

let left = 0
let right = 0
const buffer = Buffer.alloc(FRAMES * 4)
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
process.on('SIGTERM', () => process.exit(0))

let out = null
for (;;) {
  if (!tone.playing) {
    if (out !== null && out !== 1) closeSync(out)
    out = null
    await pause(30)
    continue
  }
  out ??= device ? openSync(device, 'w') : 1
  for (let i = 0; i < FRAMES; i++) {
    buffer.writeInt16LE(Math.round(Math.sin(left) * 9000), i * 4)
    buffer.writeInt16LE(Math.round(Math.sin(right) * 9000), i * 4 + 2)
    left += (2 * Math.PI * tone.left) / RATE
    right += (2 * Math.PI * tone.right) / RATE
  }
  try {
    // Bloqueia enquanto o pipe está cheio (é assim que o app segura o ritmo).
    writeSync(out, buffer)
  } catch {
    process.exit(0)
  }
  written += buffer.length
  // Deixa os timers rodarem entre um pedaço e outro.
  await new Promise((r) => setImmediate(r))
}
