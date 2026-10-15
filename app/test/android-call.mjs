// Call entre o celular (emulador) e o computador (Electron), contra o servidor local de teste:
// o som chega dos dois lados? Quantas mensagens o celular manda pro servidor na call?
// Nada toca na caixa de som: o computador roda com --mute-audio e o emulador sobe com -no-audio.
// Uso: node test/android-call.mjs (emulador ligado; RESENHA_ANDROID_SKIP_BUILD=1 reaproveita os builds)

import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { _android as android, _electron as electron } from 'playwright-core'
import { startServer } from './local-server.mjs'

const ROOT = new URL('../..', import.meta.url).pathname
const APP_DIR = new URL('..', import.meta.url).pathname
const MOBILE = join(ROOT, 'mobile')
const PACKAGE = 'com.lucasreis.resenha'
const PORT = Number(process.env.RESENHA_ANDROID_PORT ?? 8798)
const SERVER = `http://127.0.0.1:${PORT}`
const PASSWORD = 'senha-de-teste-1'
const TOOLS = join(homedir(), '.local/share/resenha-android')
const NOISE = process.env.RESENHA_CALL_NOISE ?? 'off'
const env = {
  ...process.env,
  JAVA_HOME: join(TOOLS, 'jdk'),
  ANDROID_HOME: join(TOOLS, 'sdk'),
  PATH: `${join(TOOLS, 'jdk/bin')}:${join(TOOLS, 'sdk/platform-tools')}:${process.env.PATH}`,
}
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { env, stdio: 'inherit', ...options })
const adb = (...args) => execFileSync('adb', args, { env, encoding: 'utf8' }).trim()

async function api(path, body, token) {
  const res = await fetch(SERVER + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`${path}: ${data.error}`)
  return data
}

async function inviteFor(guildId, token) {
  const ws = new WebSocket(`${SERVER.replace('http', 'ws')}/api/g/${guildId}/ws`)
  return new Promise((resolve) => {
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }))
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.t === 'ready') ws.send(JSON.stringify({ t: 'invite.create', maxAge: 0, maxUses: null }))
      if (msg.t === 'invite.created') resolve((ws.close(), msg.invite.code))
    }
  })
}

/** Microfone de mentira que faz som (um tom, ou um "falatório" de tons trocando, que o RNNoise deixa passar melhor). */
function fakeMic() {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  osc.frequency.value = 440
  const gain = ctx.createGain()
  gain.gain.value = 0.4
  const dest = ctx.createMediaStreamDestination()
  osc.connect(gain).connect(dest)
  osc.start()
  window.__micGain = gain
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c?.video) throw new DOMException('sem câmera', 'NotFoundError')
    return new MediaStream([dest.stream.getAudioTracks()[0].clone()])
  }
}

/** Conta o que o app manda pelos WebSockets (por tipo). */
function countSends() {
  window.__sent = {}
  const send = WebSocket.prototype.send
  WebSocket.prototype.send = function (data) {
    try {
      const t = JSON.parse(data).t
      window.__sent[t] = (window.__sent[t] ?? 0) + 1
    } catch {
      window.__sent['?'] = (window.__sent['?'] ?? 0) + 1
    }
    return send.call(this, data)
  }
}

/** Áudio que chega (amostras e nível) e o estado da conexão de cada um da call. */
function audioIn() {
  return (async () => {
    const out = []
    for (const peer of window.__call?.peerList ?? []) {
      let samples = 0
      let level = 0
      let bytes = 0
      ;(await peer.pc.getStats()).forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'audio' && s.totalSamplesReceived >= samples) {
          samples = s.totalSamplesReceived
          level = s.audioLevel ?? 0
          bytes = s.bytesReceived
        }
      })
      out.push({ state: peer.pc.connectionState, ice: peer.pc.iceConnectionState, samples, level: Math.round(level * 1000) / 1000, bytes })
    }
    return out
  })()
}

function audioOut() {
  return (async () => {
    const out = []
    for (const peer of window.__call?.peerList ?? []) {
      let bytes = 0
      ;(await peer.pc.getStats()).forEach((s) => {
        if (s.type === 'outbound-rtp' && s.kind === 'audio') bytes = Math.max(bytes, s.bytesSent)
      })
      out.push(bytes)
    }
    return out
  })()
}

// ---------------------------------------------------------------------------

if (process.env.RESENHA_ANDROID_SKIP_BUILD !== '1') {
  run('npm', ['-w', 'app', 'run', 'build:mobile'], { cwd: ROOT, env: { ...env, VITE_DEFAULT_SERVER: SERVER, VITE_E2E: '1' } })
  run('npx', ['cap', 'sync', 'android'], { cwd: MOBILE, env: { ...env, RESENHA_ANDROID_DEBUG: '1' } })
  run('./gradlew', ['assembleDebug', '--no-daemon', '-q'], { cwd: join(MOBILE, 'android') })
  adb('install', '-r', join(MOBILE, 'android/app/build/outputs/apk/debug/app-debug.apk'))
  run('npx', ['electron-vite', 'build'], { cwd: APP_DIR, env: { ...env, VITE_DEFAULT_SERVER: SERVER, VITE_E2E: '1' } })
}

const server = await startServer(PORT)
let desktop = null
let device = null
try {
  const owner = await api('/api/register', { username: 'lucas', name: 'Lucas', password: PASSWORD })
  const guild = await api('/api/guilds', { name: 'Turma' }, owner.token)
  const code = await inviteFor(guild.id, owner.token)
  await api('/api/register', { username: 'duarte', name: 'Duarte', password: PASSWORD, invite: code })

  // ---------- Computador (Duarte) ----------
  rmSync(join(homedir(), '.config', 'resenha-android-call'), { recursive: true, force: true })
  // Mudo: o som do celular (um tom) tocaria na caixa ou no fone de quem roda o teste. As
  // estatísticas do que chega continuam valendo.
  desktop = await electron.launch({
    executablePath: electronPath,
    args: [APP_DIR, '--mute-audio'],
    env: { ...process.env, RESENHA_PROFILE: 'android-call', RESENHA_HIDDEN: '1', LANGUAGE: 'pt_BR' },
  })
  const pc = await desktop.firstWindow()
  await pc.evaluate(() => localStorage.setItem('resenha.settings', JSON.stringify({ sounds: false, noiseReduction: 'off' })))
  await pc.reload()
  await pc.evaluate(fakeMic)
  await pc.getByLabel('Nome de usuário').waitFor({ timeout: 15_000 })
  const tab = pc.getByRole('tab', { name: 'Entrar', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click({ force: true })
  await pc.getByLabel('Nome de usuário').fill('duarte')
  await pc.getByLabel('Senha').fill(PASSWORD)
  await pc.getByRole('button', { name: 'Entrar', exact: true }).click({ force: true })
  await pc.locator('.shell[data-status=open]').waitFor({ timeout: 15_000 })
  await pc.getByRole('button', { name: 'Turma', exact: true }).click({ force: true })
  const voicePc = pc.locator('nav button.channel').filter({ hasText: /^\s*Geral\s*\d*\s*$/ }).first()
  await voicePc.waitFor({ timeout: 10_000 })
  await voicePc.click({ force: true })
  console.log('computador na sala')

  // ---------- Celular (Lucas) ----------
  adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`)
  adb('shell', 'pm', 'clear', PACKAGE)
  for (const p of ['RECORD_AUDIO', 'CAMERA', 'POST_NOTIFICATIONS']) adb('shell', 'pm', 'grant', PACKAGE, `android.permission.${p}`)
  adb('shell', 'am', 'start', '-W', '-n', `${PACKAGE}/.MainActivity`)
  ;[device] = await android.devices()
  const phone = await (await device.webView({ pkg: PACKAGE }, { timeout: 20_000 })).page()
  const logs = []
  phone.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') logs.push(`${msg.type()}: ${msg.text()}`)
  })
  await phone.evaluate((noise) => localStorage.setItem('resenha.settings', JSON.stringify({ language: 'pt', noiseReduction: noise })), NOISE)
  await phone.reload()
  await phone.evaluate(fakeMic)
  await phone.evaluate(countSends)
  await phone.getByLabel('Nome de usuário').waitFor({ timeout: 20_000 })
  const ptab = phone.getByRole('tab', { name: 'Entrar', exact: true })
  if ((await ptab.getAttribute('aria-selected')) !== 'true') await ptab.click()
  await phone.getByLabel('Nome de usuário').fill('lucas')
  await phone.getByLabel('Senha').fill(PASSWORD)
  await phone.getByRole('button', { name: 'Entrar', exact: true }).click()
  await phone.locator('.shell[data-status=open]').waitFor({ timeout: 20_000 })
  await phone.getByRole('button', { name: 'Turma', exact: true }).click()
  const voicePhone = phone.locator('nav button.channel').filter({ hasText: /^\s*Geral\s*\d*\s*$/ }).first()
  await voicePhone.waitFor({ timeout: 10_000 })
  await phone.evaluate(() => (window.__sent = {}))
  await voicePhone.click()
  console.log('celular na sala')

  for (let second = 5; second <= 30; second += 5) {
    await phone.waitForTimeout(5000)
    const sent = await phone.evaluate(() => window.__sent)
    console.log(`\n${second} s`)
    console.log('  celular mandou:', JSON.stringify(sent))
    console.log('  celular recebe:', JSON.stringify(await phone.evaluate(audioIn)), 'manda bytes:', JSON.stringify(await phone.evaluate(audioOut)))
    console.log('  computador recebe:', JSON.stringify(await pc.evaluate(audioIn)))
    console.log('  celular falando:', await phone.evaluate(() => window.__call?.selfSpeaking), 'nível:', await phone.evaluate(() => window.__call?.mic?.levelDb ?? null))
  }
  const toasts = await phone.locator('.toast, [role=alert], [role=status]').allInnerTexts()
  console.log('\navisos na tela do celular:', JSON.stringify(toasts))
  console.log('erros no console do celular:\n ', logs.slice(0, 30).join('\n  '))
} finally {
  await desktop?.close().catch(() => {})
  await device?.close().catch(() => {})
  try {
    adb('reverse', '--remove', `tcp:${PORT}`)
  } catch {
    // aparelho saiu
  }
  server.stop()
}
