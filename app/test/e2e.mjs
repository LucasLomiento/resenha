// Teste de ponta a ponta com duas instâncias reais do app (janelas escondidas)
// contra o servidor local. Não usa microfone nem tela de verdade: o microfone
// é um oscilador e a "tela" é um canvas animado com o horário codificado em
// pixels, o que permite medir o atraso de ponta a ponta no lado de quem assiste.
//
// Por padrão roda leve (720p) e SEM áudio da tela, porque o venmic religa as
// saídas dos apps que estão tocando (Spotify, Discord...) e isso pode fazer o
// som do PC engasgar enquanto o teste roda. Opcional:
//   RESENHA_E2E_AUDIO=1  liga o venmic e confere no grafo do PipeWire que o
//                        áudio da tela pega outros apps mas não o próprio app
//   RESENHA_E2E_FULL=1   transmite em 1440p (duas codificações pesadas na CPU)
//
// Uso: npm run dev:server (em outro terminal) e depois npm -w app run e2e

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

/** RESENHA_SHOTS=pasta salva capturas da interface pra revisão visual. */
const SHOTS = process.env.RESENHA_SHOTS
const APP_DIR = new URL('..', import.meta.url).pathname
const withAudio = process.env.RESENHA_E2E_AUDIO === '1' && process.platform === 'linux'
const full = process.env.RESENHA_E2E_FULL === '1'
/**
 * RESENHA_E2E_SFU=1: a tela vai pelo SFU do Cloudflare de verdade já com uma pessoa
 * assistindo (precisa de REALTIME_APP_ID e REALTIME_APP_SECRET no server/.dev.vars).
 * Todas as checagens da tela passam a valer pelo SFU.
 */
const viaSfu = process.env.RESENHA_E2E_SFU === '1'
const targetWidth = full ? 2560 : 1280

let failures = 0
/** Erros de console que indicam que o microfone caiu no plano B (sem processamento). */
const micFallbacks = []

/** Captura pelo processo principal: page.screenshot trava em janela escondida. */
async function shot(side, name) {
  if (!SHOTS) return
  // A janela escondida pinta fora da tela: espera o quadro novo (e as transições curtas) antes de capturar.
  await side.page.waitForTimeout(350)
  const png = await side.app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  )
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'))
}
function check(ok, label, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function launch(profile) {
  rmSync(join(homedir(), '.config', `resenha-${profile}`), { recursive: true, force: true })
  const app = await electron.launch({
    executablePath: electronPath,
    args: [APP_DIR],
    // RESENHA_INK_DRY: a camada dos rabiscos não abre de verdade, só registra o que chegou.
    // LANGUAGE: perfil novo segue o idioma do sistema; o teste procura os textos em português.
    env: { ...process.env, RESENHA_PROFILE: profile, RESENHA_HIDDEN: '1', RESENHA_INK_DRY: '1', LANGUAGE: 'pt_BR' },
  })
  const page = await app.firstWindow()
  // As conexões com os servidores passam pelo teste, pra dar pra derrubar uma no meio (queda de rede).
  const guildSockets = []
  await page.routeWebSocket(/\/api\/g\/[^/]+\/ws$/, (ws) => {
    guildSockets.push({ ws, server: ws.connectToServer() })
  })
  // Sem sons do app durante o teste (nada toca na caixa de som de quem roda). Sem RNNoise
  // também: o microfone falso é um tom puro, e pro RNNoise apito não é voz.
  await page.evaluate(
    (sfu) =>
      localStorage.setItem(
        'resenha.settings',
        JSON.stringify({ sounds: false, noiseReduction: 'off', streamVolume: 0, ...(sfu ? { sfuMinViewers: 1 } : {}) }),
      ),
    viaSfu,
  )
  await page.reload()
  page.on('console', (msg) => {
    // Erros, e os avisos do SFU (quando a tela desiste do Cloudflare e segue direta, o motivo aparece aqui).
    if (msg.type() !== 'error' && !msg.text().startsWith('[sfu]')) return
    console.log(`   [${profile}] ${msg.text()}`)
    if (/processamento do microfone indisponível|RNNoise não carregou|processador do microfone parou/.test(msg.text())) {
      micFallbacks.push(profile)
    }
  })
  page.on('pageerror', (err) => console.log(`   [${profile}] pageerror: ${err.message}`))
  /** Derruba a conexão com o servidor como uma queda de rede (sem aviso dos dois lados) e espera o app voltar. */
  async function dropGuild() {
    const before = guildSockets.length
    const { ws, server } = guildSockets[before - 1]
    server.close({ code: 4000, reason: 'queda' })
    ws.close({ code: 4000, reason: 'queda' })
    for (let i = 0; i < 100 && guildSockets.length === before; i++) await page.waitForTimeout(100)
    return guildSockets.length > before
  }
  return { app, page, dropGuild, guildSockets }
}

/** Microfone falso (oscilador) no lugar do real; o microfone virtual do venmic passa direto. */
async function fakeMic(page) {
  await page.evaluate(installFakeMic)
}

/** Roda na página (também antes do app carregar, num recarregamento: `page.addInitScript`). */
function installFakeMic() {
  {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = 440
    const gain = ctx.createGain()
    gain.gain.value = 0
    const dest = ctx.createMediaStreamDestination()
    osc.connect(gain).connect(dest)
    osc.start()
    window.__micGain = gain
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    // Câmera falsa: um canvas pequeno animado.
    const cam = document.createElement('canvas')
    cam.width = 640
    cam.height = 360
    const g = cam.getContext('2d')
    let t = 0
    setInterval(() => {
      g.fillStyle = `hsl(${(t += 4) % 360} 60% 45%)`
      g.fillRect(0, 0, 640, 360)
    }, 33)
    const camStream = cam.captureStream(30)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.video) return new MediaStream([camStream.getVideoTracks()[0].clone()])
      if (constraints?.audio?.deviceId?.exact) return real(constraints)
      return new MediaStream([dest.stream.getAudioTracks()[0].clone()])
    }
  }
}

/**
 * "Tela" falsa: canvas 2560x1440 a 60 fps com movimento e o Date.now() em 48 blocos no topo.
 * `stereo`: com áudio de teste gerado na memória (440 Hz só na esquerda, 1500 Hz só na direita),
 * que não toca em lugar nenhum (quem assiste está com o volume da tela em 0).
 */
async function fakeScreen(page, stereo = false) {
  await page.evaluate((stereo) => {
    const canvas = document.createElement('canvas')
    canvas.width = 2560
    canvas.height = 1440
    const g = canvas.getContext('2d')
    let frame = 0
    setInterval(() => {
      frame++
      if (window.__staticScreen) {
        // Fundo liso: o teste dos rabiscos compara pixel a pixel.
        g.fillStyle = '#202028'
        g.fillRect(0, 0, 2560, 1440)
      } else {
        g.fillStyle = `hsl(${frame % 360} 50% 35%)`
        g.fillRect(0, 0, 2560, 1440)
        for (let i = 0; i < 24; i++) {
          g.fillStyle = `hsl(${(frame * 7 + i * 30) % 360} 80% 60%)`
          g.fillRect((frame * 17 + i * 113) % 2400, 80 + ((i * 61) % 1300), 160, 100)
        }
      }
      // Traços de caneta como a camada de lá desenha (ink-overlay.py), com o nome no começo.
      const u = 1440 / 1080
      for (const s of window.__inkStrokes?.values() ?? []) {
        if (s.points.length < 2) continue
        g.lineCap = 'round'
        g.lineJoin = 'round'
        for (const [width, style, alpha] of [[8 * u, '#000', 0.45], [4.8 * u, s.color, 1]]) {
          g.globalAlpha = alpha
          g.strokeStyle = style
          g.lineWidth = width
          g.beginPath()
          s.points.forEach(([x, y], i) => (i ? g.lineTo(x * 2560, y * 1440) : g.moveTo(x * 2560, y * 1440)))
          g.stroke()
        }
        if (performance.now() - s.updated < 1600) {
          g.font = `bold ${13 * u}px sans-serif`
          const [x, y] = [s.points[0][0] * 2560 + 12 * u, s.points[0][1] * 1440 + 12 * u]
          const w = g.measureText(s.name).width + 14 * u
          const h = 21 * u
          g.globalAlpha = 0.95
          g.fillStyle = s.color
          g.beginPath()
          g.roundRect(x, y, w, h, h / 2)
          g.fill()
          g.globalAlpha = 0.9
          g.fillStyle = '#0d0b17'
          g.fillText(s.name, x + 7 * u, y + 4 * u + 13 * u * 0.8)
        }
        g.globalAlpha = 1
      }
      const t = Date.now()
      for (let b = 0; b < 48; b++) {
        g.fillStyle = Math.floor(t / 2 ** b) % 2 ? '#fff' : '#000'
        g.fillRect(b * 40, 0, 40, 40)
      }
      // O quadradinho que a camada dos rabiscos desenharia no monitor (o teste liga quando ela está no "certo").
      if (window.__inkProbe) {
        g.fillStyle = '#ff00ff'
        g.fillRect(0, 0, 48, 48)
      }
    }, 1000 / 60)
    const stream = canvas.captureStream(60)
    let audio = null
    if (stereo) {
      const ctx = new AudioContext()
      const merger = ctx.createChannelMerger(2)
      for (const [hz, channel] of [
        [440, 0],
        [1500, 1],
      ]) {
        const osc = ctx.createOscillator()
        osc.frequency.value = hz
        osc.connect(merger, 0, channel)
        osc.start()
      }
      const dest = ctx.createMediaStreamDestination()
      dest.channelCount = 2
      merger.connect(dest)
      audio = dest.stream.getAudioTracks()[0]
    }
    navigator.mediaDevices.getDisplayMedia = async () => {
      // Como no Wayland: o Electron diz "janela" até pra monitor inteiro.
      const video = stream.getVideoTracks()[0].clone()
      const real = video.getSettings.bind(video)
      video.getSettings = () => ({ ...real(), displaySurface: 'window' })
      return new MediaStream([video, ...(audio ? [audio.clone()] : [])])
    }
  }, stereo)
}

/** Nível (dB) de cada tom em cada canal do áudio da tela que chega em quem assiste. */
async function stereoLevels(page) {
  return page.evaluate(async () => {
    const track = document.querySelector('.stream video')?.srcObject?.getAudioTracks?.()[0]
    if (!track) return null
    const ctx = new AudioContext()
    const split = ctx.createChannelSplitter(2)
    ctx.createMediaStreamSource(new MediaStream([track])).connect(split)
    const silent = ctx.createGain()
    silent.gain.value = 0
    silent.connect(ctx.destination)
    const analysers = [0, 1].map((channel) => {
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 8192
      split.connect(analyser, channel)
      analyser.connect(silent)
      return analyser
    })
    await new Promise((r) => setTimeout(r, 1500))
    const level = (analyser, hz) => {
      const bins = new Float32Array(analyser.frequencyBinCount)
      analyser.getFloatFrequencyData(bins)
      const i = Math.round(hz / (ctx.sampleRate / analyser.fftSize))
      return Math.round(Math.max(bins[i - 1], bins[i], bins[i + 1]))
    }
    const [left, right] = analysers
    const out = { left440: level(left, 440), left1500: level(left, 1500), right440: level(right, 440), right1500: level(right, 1500) }
    await ctx.close()
    return out
  })
}

/** Lê o horário dos pixels de cada quadro recebido: atraso = agora - horário desenhado. */
async function measureLatency(page, samples = 90) {
  return page.evaluate(async (samples) => {
    const video = document.querySelector('.stream video')
    const c = document.createElement('canvas')
    const g = c.getContext('2d', { willReadFrequently: true })
    const out = []
    const deadline = Date.now() + 15_000
    while (out.length < samples && Date.now() < deadline) {
      await new Promise((resolve) => {
        if ('requestVideoFrameCallback' in video) {
          const timer = setTimeout(resolve, 50)
          video.requestVideoFrameCallback(() => {
            clearTimeout(timer)
            resolve()
          })
        } else setTimeout(resolve, 16)
      })
      if (!video.videoWidth) continue
      const now = Date.now()
      c.width = video.videoWidth
      c.height = video.videoHeight
      g.drawImage(video, 0, 0)
      const sx = c.width / 2560
      const sy = c.height / 1440
      let t = 0
      for (let b = 0; b < 48; b++) {
        const px = g.getImageData(Math.floor((b * 40 + 20) * sx), Math.floor(20 * sy), 1, 1).data
        if (px[0] + px[1] + px[2] > 384) t += 2 ** b
      }
      const delay = now - t
      if (delay >= 0 && delay < 5000) out.push(delay)
    }
    return { delays: out, width: video.videoWidth, height: video.videoHeight }
  }, samples)
}

/** Posição e largura de um botão (pelo nome acessível), pra conferir que nada muda de lugar entre estados. */
function rectOf(page, name) {
  return page.getByRole('button', { name, exact: true }).evaluate((el) => {
    const r = el.getBoundingClientRect()
    return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}`
  })
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Entra pela tela de login (a conta já foi criada pela API). */
async function login(side, username) {
  const { page } = side
  await page.getByLabel('Nome de usuário').waitFor({ timeout: 10_000 })
  // Servidor sem a conta ainda abre em "criar conta": volta pro "entrar".
  const toLogin = page.locator('.switch button', { hasText: 'Entrar' })
  if (await toLogin.isVisible()) await toLogin.click({ force: true })
  await page.getByLabel('Nome de usuário').fill(username)
  await page.getByLabel('Senha').fill(PASSWORD)
  await shot(side, '0-entrar')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click({ force: true })
  await page.locator('.shell[data-status=open]').waitFor({ timeout: 15_000 })
}

/** Botão da barra lateral pelo nome exato (canal de texto "geral" ≠ voz "Geral"). */
function channel(page, name) {
  return page.locator('nav button.channel').filter({ hasText: new RegExp(`^\\s*${name}\\s*\\d*\\s*$`) }).first()
}

// ---------- Servidor local só do teste (porta própria, dados num diretório temporário) ----------

const PORT = Number(process.env.RESENHA_E2E_PORT ?? 8797)
const SERVER = `http://127.0.0.1:${PORT}`
const PASSWORD = 'senha-de-teste-1'

async function startServer() {
  const state = mkdtempSync(join(tmpdir(), 'resenha-e2e-server-'))
  let proc = null
  let log = ''
  const up = async () => {
    proc = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state], {
      cwd: new URL('../../server', import.meta.url).pathname,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    proc.stdout.on('data', (d) => (log += d))
    proc.stderr.on('data', (d) => (log += d))
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`${SERVER}/api/status`)).ok) return
      } catch {
        // ainda subindo
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    process.kill(-proc.pid, 'SIGTERM')
    throw new Error(`servidor de teste não subiu:\n${log.slice(-2000)}`)
  }
  const down = async () => {
    const exited = new Promise((r) => proc.once('exit', r))
    process.kill(-proc.pid, 'SIGTERM')
    await exited
    // Espera a porta soltar (o workerd sai logo depois do wrangler).
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${SERVER}/api/status`)
      } catch {
        return
      }
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  await up()
  return {
    /** Reinicia com os mesmos dados (como um deploy ou o Cloudflare reiniciando o Durable Object). */
    restart: async () => {
      await down()
      await up()
    },
    stop: () => (process.kill(-proc.pid, 'SIGTERM'), rmSync(state, { recursive: true, force: true })),
  }
}

/** Quadros que chegam no player de quem assiste durante `ms` (e o menor número de gente na call nesse tempo). */
async function watchFor(page, ms) {
  return page.evaluate(async (ms) => {
    let frames = 0
    let fewest = Infinity
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const video = document.querySelector('.stream video')
      fewest = Math.min(fewest, document.querySelectorAll('nav .members .member').length)
      if (video && 'requestVideoFrameCallback' in video) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 100)
          video.requestVideoFrameCallback(() => {
            clearTimeout(timer)
            frames++
            resolve()
          })
        })
      } else await new Promise((r) => setTimeout(r, 100))
    }
    return { frames, fewest }
  }, ms)
}

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

/** Gera um convite pelo WebSocket do servidor (como o app faz). */
async function inviteFor(guildId, token) {
  const ws = new WebSocket(`${SERVER.replace('http', 'ws')}/api/g/${guildId}/ws`)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('convite não chegou')), 10_000)
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }))
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.t === 'ready') ws.send(JSON.stringify({ t: 'invite.create', maxAge: 0, maxUses: null }))
      if (msg.t === 'invite.created') {
        clearTimeout(timer)
        ws.close()
        resolve(msg.code)
      }
    }
  })
}

/** Tom silencioso tocando no alto-falante padrão: um "outro app" pro venmic capturar. */
function silentPlayer() {
  const dir = mkdtempSync(join(tmpdir(), 'resenha-e2e-'))
  const file = join(dir, 'tom.wav')
  const rate = 48_000
  const seconds = 30
  const data = Buffer.alloc(rate * seconds * 2)
  for (let i = 0; i < rate * seconds; i++) data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(file, Buffer.concat([header, data]))
  const proc = spawn('pw-play', ['--volume', '0', file], { stdio: 'ignore' })
  return { proc, cleanup: () => (proc.kill(), rmSync(dir, { recursive: true, force: true })) }
}

/**
 * Quais apps estão alimentando o áudio da tela, pelo pw-dump. O venmic liga
 * cada app ao "vencord-sink" através de um nó próprio chamado
 * venmic-loopback-playback-<id do app>-<id do destino>.
 */
function venmicSources() {
  const dump = JSON.parse(execFileSync('pw-dump', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  const nodes = new Map(dump.filter((o) => o.type === 'PipeWire:Interface:Node').map((n) => [n.id, n]))
  const sink = [...nodes.values()].find((n) => n.info?.props?.['node.name'] === 'vencord-sink')
  if (!sink) return null
  const links = dump.filter((o) => o.type === 'PipeWire:Interface:Link' && o.info?.['input-node-id'] === sink.id)
  const feeding = [...new Set(links.map((l) => l.info['output-node-id']))]
  return feeding.map((id) => {
    const name = nodes.get(id)?.info?.props?.['node.name'] ?? ''
    const from = Number(name.match(/^venmic-loopback-playback-(\d+)-/)?.[1] ?? id)
    const props = nodes.get(from)?.info?.props ?? {}
    return {
      id: from,
      name: props['node.name'],
      app: props['application.name'],
      binary: props['application.process.binary'],
      // O pw-dump às vezes traz número, às vezes string.
      pid: props['application.process.id'] != null ? String(props['application.process.id']) : undefined,
    }
  })
}

/** Centro do mapa na tela (lng, lat, zoom), como o app mostra no `data-center`. */
async function mapCenter(page) {
  const text = await page.locator('.map-pane .stage').getAttribute('data-center')
  return text.split(',').map(Number)
}

/** Espera o mapa parar (o voo até um lugar leva alguns segundos) e devolve onde ficou. */
async function settled(page, ms = 10_000) {
  let last = await mapCenter(page)
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    await page.waitForTimeout(400)
    const now = await mapCenter(page)
    if (now.every((v, i) => Math.abs(v - last[i]) < 1e-6)) return now
    last = now
  }
  return last
}

/** Espera o centro do mapa de quem acompanha chegar perto do de quem mexeu. */
async function follows(page, [lng, lat, zoom], ms = 6000) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    const [x, y, z] = await mapCenter(page)
    if (Math.abs(x - lng) < 1e-3 && Math.abs(y - lat) < 1e-3 && Math.abs(z - zoom) < 0.02) return true
    await page.waitForTimeout(100)
  }
  return false
}

/**
 * Mapa compartilhado: A e B abrem o mapa do servidor; A arrasta e o de B vai
 * junto; o cursor de A aparece pra B; A busca um lugar e marca, e B vê o marcador.
 * As janelas do teste pintam fora da tela, mas o WebGL funciona nelas (o MapLibre desenha).
 */
async function checkMap() {
  for (const side of [a, b]) await side.page.getByRole('button', { name: /^Mapa/ }).click({ force: true })
  const opened = []
  for (const side of [a, b]) {
    await side.page.locator('.map-pane .stage[data-ready], .map-pane .veil.failed').first().waitFor({ timeout: 30_000 })
    opened.push((await side.page.locator('.map-pane .stage[data-ready]').count()) === 1)
  }
  check(opened.every(Boolean), 'mapa abre (MapLibre com WebGL e os mapas do OpenFreeMap)', opened.join(', '))
  await b.page.locator('nav .map-people .avatar').nth(1).waitFor({ timeout: 5000 })
  check(true, 'lista de canais mostra quem está no mapa')
  if (!opened.every(Boolean)) return

  // A arrasta o mapa: o de B segue.
  const box = await a.page.locator('.map-pane .stage').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await a.page.mouse.move(cx, cy)
  await a.page.mouse.down()
  await a.page.mouse.move(cx - 220, cy - 140, { steps: 12 })
  await a.page.mouse.up()
  await a.page.waitForTimeout(900)
  const dragged = await mapCenter(a.page)
  check(await follows(b.page, dragged), 'A arrasta o mapa e o de B vai junto', dragged.join(', '))

  // Cursor de A aparece pra B, com o nome.
  await a.page.mouse.move(cx + 60, cy + 40, { steps: 4 })
  await b.page
    .locator('.map-cursor:not(.gone) .map-cursor-name', { hasText: 'Lucas' })
    .waitFor({ timeout: 5000 })
    .then(() => check(true, 'cursor de A aparece pra B'))
    .catch(() => check(false, 'cursor de A aparece pra B'))
  await shot(b, '2c-mapa-cursor')

  // Busca (Nominatim, ao apertar Enter): A voa até o lugar e B vai junto.
  const search = a.page.getByLabel('Buscar lugar')
  await search.fill('Curitiba, Paraná')
  await search.press('Enter')
  await a.page.locator('.results .result').first().waitFor({ timeout: 15_000 })
  await shot(a, '2d-mapa-busca')
  await a.page.locator('.results .result').first().click({ force: true })
  const found = await settled(a.page)
  check(Math.abs(found[1] + 25.4) < 0.5 && (await follows(b.page, found)), 'busca leva A até o lugar e B vai junto', found.join(', '))

  // A marca um lugar e B vê o marcador (no mapa e na lista).
  await a.page.getByRole('button', { name: 'Marcar lugar', exact: true }).click({ force: true })
  await a.page.mouse.click(cx, cy)
  await a.page.getByLabel('Nome do lugar').fill('Padaria do Zé')
  await shot(a, '2e-mapa-marcar')
  await a.page.getByLabel('Nome do lugar').press('Enter')
  await b.page.locator('.map-pin[aria-label="Padaria do Zé"]').waitFor({ state: 'attached', timeout: 5000 })
  await b.page.getByRole('button', { name: 'Marcadores', exact: true }).click({ force: true })
  await b.page.locator('.aside .pin-label', { hasText: 'Padaria do Zé' }).waitFor({ timeout: 5000 })
  check(true, 'A marca um lugar e B vê o marcador')
  await b.page.locator('.map-pin[aria-label="Padaria do Zé"]').click({ force: true })
  await shot(b, '2f-mapa-marcadores')
  const google = await a.page.locator('a.gmaps').first().getAttribute('href')
  check(/^https:\/\/www\.google\.com\/maps\/@-?\d+\.\d+,-?\d+\.\d+,\d+\.\d+z$/.test(google), '"Google Maps" aponta pro mesmo lugar', google)

  // Street View: B abre no marcador; A vê o bonequinho de B no mapa e, clicando nele, vai junto.
  await b.page.locator('.pin-card').getByRole('button', { name: 'Street View', exact: true }).click({ force: true })
  const frameB = await b.page.locator('iframe.street-frame').getAttribute('src', { timeout: 5000 })
  const walker = a.page.locator('.map-walker', { hasText: 'Duarte' })
  await walker.waitFor({ state: 'attached', timeout: 5000 })
  await shot(a, '2g-mapa-street-view-alguem')
  await walker.click({ force: true })
  const frameA = await a.page.locator('iframe.street-frame').getAttribute('src', { timeout: 5000 })
  await shot(b, '2h-mapa-street-view')
  check(
    /^https:\/\/www\.google\.com\/maps\/embed\?/.test(frameB ?? '') && frameA === frameB,
    'Street View: B abre no marcador, A vê onde B está e vai junto',
    frameB ?? '',
  )
  for (const page of [a.page, b.page]) await page.getByRole('button', { name: 'Fechar o Street View', exact: true }).first().click({ force: true })
  // Os dois bonecos (o meu e o de quem estava) somem: espera até não sobrar nenhum.
  await a.page.locator('.map-walker').first().waitFor({ state: 'detached', timeout: 5000 })
  await b.page.getByRole('button', { name: 'Marcadores', exact: true }).click({ force: true })
}

// ---------------------------------------------------------------------------

const server = await startServer()
const owner = await api('/api/register', { username: 'lucas', name: 'Lucas', password: PASSWORD })
const guild = await api('/api/guilds', { name: 'Turma' }, owner.token)
const code = await inviteFor(guild.id, owner.token)
const duarte = await api('/api/register', { username: 'duarte', name: 'Duarte', password: PASSWORD, invite: code })
check(true, 'contas, servidor e convite criados pela API', code)
// Personalização do perfil de B (A confere no cartão e na lista de membros).
const styled = await fetch(`${SERVER}/api/me`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${duarte.token}` },
  body: JSON.stringify({ style: { theme: [0x2e8bff, 0x2ad4b0], pronouns: 'ele/dele', decoration: 'headset', effect: 'sparkles', nameFont: 'rounded', nameEffect: 'gradient' } }),
})
if (!styled.ok) throw new Error(`personalização: ${(await styled.json()).error}`)
// A primeira conta é a dona do Resenha: só ela usa a moldura e o nome exclusivos.
const patchStyle = (token, style) =>
  fetch(`${SERVER}/api/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ style }) })
const founderStyle = await patchStyle(owner.token, { decoration: 'founder', nameEffect: 'holo' })
const notFounder = await patchStyle(duarte.token, { decoration: 'founder' })
check(founderStyle.ok && notFounder.status === 400, 'moldura e nome do Fundador: o dono usa, os outros levam recusa', `${founderStyle.status}/${notFounder.status}`)
// A segunda conta é a do Pioneiro: só ela usa a moldura e o nome dele (volta pros fones depois).
const pioneerStyle = await patchStyle(duarte.token, { decoration: 'pioneer', nameEffect: 'horizon' })
const notPioneer = await patchStyle(owner.token, { nameEffect: 'horizon' })
await patchStyle(duarte.token, { decoration: 'headset', nameEffect: 'gradient' })
check(pioneerStyle.ok && notPioneer.status === 400, 'moldura e nome do Pioneiro: a primeira conta depois do dono usa, o dono leva recusa', `${pioneerStyle.status}/${notPioneer.status}`)

// Prefixo dos perfis: dá pra rodar dois e2e ao mesmo tempo (com RESENHA_E2E_PORT diferente também).
const PROFILE = process.env.RESENHA_E2E_PROFILE ?? 'e2e'
const a = await launch(`${PROFILE}-a`)
const b = await launch(`${PROFILE}-b`)
let closedA = false

try {
  await login(a, 'lucas')
  await login(b, 'duarte')
  check(true, 'A e B entraram pela tela de login')

  // Trilho: o servidor aparece e abre na barra do servidor.
  for (const side of [a, b]) {
    await side.page.getByRole('button', { name: 'Turma', exact: true }).click({ force: true })
    await channel(side.page, 'geral').waitFor({ timeout: 10_000 })
  }
  check(true, 'servidor aparece no trilho e abre com os canais')
  await shot(a, '1-servidor')

  // Organizar arrastando (A é o dono): a categoria de voz sobe e o #geral entra nela; B vê na hora.
  const header = (page, name) => page.locator('nav .category', { hasText: name })
  const row = (page, name) =>
    page.locator('nav .channel-row').filter({ has: page.locator('button.channel', { hasText: new RegExp(`^\\s*${name}\\s*\\d*\\s*$`) }) })
  const navOrder = (page) => page.locator('nav .category-toggle, nav button.channel').allInnerTexts()
  const settles = async (page, expected) => {
    for (let i = 0; i < 50; i++) {
      const now = (await navOrder(page)).map((t) => t.trim().split('\n')[0])
      if (now.join('|') === expected.join('|')) return true
      await page.waitForTimeout(100)
    }
    return false
  }
  await header(a.page, 'Canais de voz').dragTo(header(a.page, 'Canais de texto'), { targetPosition: { x: 24, y: 4 } })
  await row(a.page, 'geral').dragTo(header(a.page, 'Canais de voz'))
  const arranged = await settles(b.page, ['Canais de voz', 'geral', 'Geral'])
  // E volta como estava (o resto do teste usa a ordem padrão).
  await row(a.page, 'geral').dragTo(header(a.page, 'Canais de texto'))
  await header(a.page, 'Canais de texto').dragTo(header(a.page, 'Canais de voz'), { targetPosition: { x: 24, y: 4 } })
  const restored = await settles(b.page, ['Canais de texto', 'geral', 'Canais de voz', 'Geral'])
  check(arranged && restored, 'dono organiza canais e categorias arrastando, e todo mundo vê na hora')

  // Chat, menção e resposta.
  const composerA = a.page.getByPlaceholder('Mensagem em #geral')
  const composerB = b.page.getByPlaceholder('Mensagem em #geral')
  await composerB.fill('salve, tá me ouvindo?')
  await b.page.keyboard.press('Enter')
  await a.page.getByText('salve, tá me ouvindo?').waitFor({ timeout: 5000 })
  check(true, 'mensagem de B chegou em A')

  await composerA.fill('ei @dua')
  await composerA.press('End')
  await a.page.locator('.picker .option').first().waitFor({ timeout: 5000 })
  await shot(a, '1b-sugestao-mencao')
  await composerA.press('Tab')
  await composerA.type('olha isso')
  await composerA.press('Enter')
  await b.page.locator('article.mentioned').filter({ hasText: 'olha isso' }).waitFor({ timeout: 5000 })
  check(true, 'menção pela sugestão chega destacada pra quem foi mencionado')

  const target = b.page.locator('article', { hasText: 'olha isso' })
  await target.hover({ force: true })
  await target.getByRole('button', { name: 'Responder', exact: true }).click({ force: true })
  await composerB.fill('respondendo aqui')
  await composerB.press('Enter')
  await a.page.locator('article.has-reply', { hasText: 'respondendo aqui' }).waitFor({ timeout: 5000 })
  check(true, 'resposta aparece com a mensagem original')

  // Reação pelo seletor de emoji.
  const reply = a.page.locator('article', { hasText: 'respondendo aqui' })
  await reply.hover({ force: true })
  await reply.getByRole('button', { name: 'Reagir', exact: true }).first().click({ force: true })
  await a.page.getByLabel('Procurar emoji').fill('joinha')
  await a.page.getByLabel('Procurar emoji').press('Enter')
  await b.page.locator('article', { hasText: 'respondendo aqui' }).locator('.reaction', { hasText: '👍' }).waitFor({ timeout: 5000 })
  check(true, 'reação chega pro outro')

  // Formatação: negrito e código viram elementos, script não roda.
  await composerB.fill('**forte** e `codigo` e <img src=x onerror=alert(1)>')
  await composerB.press('Enter')
  await a.page.locator('article strong', { hasText: 'forte' }).waitFor({ timeout: 5000 })
  const injected = await a.page.locator('article img[src="x"]').count()
  check(injected === 0, 'formatação funciona e HTML na mensagem não vira elemento')

  // Anexo.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  await b.page.locator('input[type=file]').setInputFiles({ name: 'print.png', mimeType: 'image/png', buffer: png })
  await b.page.locator('.upload .upload-meta', { hasText: /\d+ B$/ }).waitFor({ timeout: 10_000 })
  await composerB.press('Enter')
  const img = a.page.locator('article img[alt="print.png"]')
  await img.waitFor({ timeout: 5000 })
  const loaded = await img.evaluate((el) => (el.complete ? el.naturalWidth : new Promise((r) => (el.onload = () => r(el.naturalWidth)))))
  check(loaded === 1, 'imagem enviada por B aparece em A (URL assinada)')

  // Mensagem de voz: B grava (microfone falso, nunca o de verdade), envia, e A recebe um MP3 de verdade.
  await fakeMic(b.page)
  const micButton = b.page.getByRole('button', { name: 'Gravar mensagem de voz', exact: true })
  await micButton.click({ force: true })
  await b.page
    .locator('.voice-row .rec-time', { hasText: '0:01' })
    .waitFor({ timeout: 5000 })
    .catch(async (err) => {
      const debug = await micButton.evaluate((el) => {
        const box = el.getBoundingClientRect()
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return { box: [box.x, box.y, box.width, box.height].map(Math.round), top: top?.outerHTML.slice(0, 200), toasts: document.querySelector('.toasts')?.textContent }
      })
      console.log('   gravação não começou:', JSON.stringify(debug))
      throw err
    })
  await b.page.waitForTimeout(500)
  await shot(b, '2a-gravando-voz')
  await b.page.getByRole('button', { name: 'Enviar (Enter)', exact: true }).click({ force: true })
  const voice = a.page.locator('article .voice').last()
  await voice.waitFor({ timeout: 20_000 })
  const voiceInfo = await voice.evaluate(async (el) => {
    const audio = el.querySelector('audio')
    if (!audio.duration) await new Promise((r) => audio.addEventListener('loadedmetadata', r, { once: true }))
    const res = await fetch(audio.src)
    const bytes = new Uint8Array(await res.arrayBuffer())
    // Quadro de MP3 (MPEG-1 Layer III): começa com 0xFFFB/0xFFFA, ou com a etiqueta ID3.
    const mp3 = (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) || String.fromCharCode(...bytes.slice(0, 3)) === 'ID3'
    return { type: res.headers.get('content-type'), mp3, seconds: Math.round(audio.duration * 10) / 10 }
  })
  const download = await voice.getByRole('button', { name: 'Baixar o áudio (.mp3)', exact: true }).count()
  await shot(a, '2a-mensagem-de-voz')
  check(
    voiceInfo.type === 'audio/mpeg' && voiceInfo.mp3 && voiceInfo.seconds >= 1 && voiceInfo.seconds <= 4 && download === 1,
    'mensagem de voz: B grava e envia, A recebe o player com um MP3 de verdade (e o botão de baixar)',
    JSON.stringify(voiceInfo),
  )
  await shot(a, '2-chat')

  // Rolagem do chat: com mensagem suficiente, a lista tem que rolar. Mensagens altas e com
  // calma (o servidor segura mais de 5 a cada 5 s).
  for (let i = 0; i < 6; i++) {
    await composerB.fill(`mensagem ${i}`)
    for (let line = 0; line < 8; line++) await composerB.press('Shift+Enter')
    await composerB.type('fim')
    await composerB.press('Enter')
    await b.page.waitForTimeout(1100)
  }
  await a.page.getByText('mensagem 5').waitFor({ timeout: 15_000 })
  const scroll = await a.page.locator('.scroller').evaluate((el) => {
    const before = el.scrollTop
    el.scrollTop = 0
    return { scrollable: el.scrollHeight > el.clientHeight + 50, moved: before !== el.scrollTop }
  })
  check(scroll.scrollable && scroll.moved, 'chat rola quando tem mensagem que não cabe')

  await checkMap()
  for (const side of [a, b]) await channel(side.page, 'geral').click({ force: true })

  // Não lidas: A vai pro início; B manda; o servidor ganha a marquinha no trilho de A.
  await a.page.getByRole('button', { name: 'Início', exact: true }).click({ force: true })
  await composerB.fill('tem novidade')
  await composerB.press('Enter')
  await a.page.locator('.slot.unread').first().waitFor({ timeout: 5000 })
  check(true, 'servidor com mensagem nova ganha a marquinha no trilho')
  await a.page.getByRole('button', { name: 'Turma', exact: true }).click({ force: true })

  // Mensagem privada: A abre o perfil de B pela lista de membros e manda mensagem.
  await a.page.locator('.members button.member', { hasText: 'Duarte' }).click({ force: true })
  await a.page.getByRole('button', { name: 'Mensagem', exact: true }).waitFor({ timeout: 5000 })
  await shot(a, '2b-perfil')
  const card = a.page.locator('.profile-pop')
  const personalized = await Promise.all([
    card.locator('.pronouns', { hasText: 'ele/dele' }).count(),
    card.locator('.shell.themed').count(),
    card.locator('.deco.headset').count(),
    card.locator('.effect.sparkles').count(),
    card.locator('h2 .name-font-rounded.name-fx-gradient').count(),
    a.page.locator('.members button.member', { hasText: 'Duarte' }).locator('.deco.headset').count(),
  ])
  check(personalized.every((n) => n === 1), 'A vê a personalização de B (tema, pronomes, moldura, efeito, nome) no cartão e na lista', personalized.join(','))
  // O dono do Resenha (A) aparece pra B com o selo, a moldura e o nome holográfico.
  const lucasForB = b.page.locator('.members button.member', { hasText: 'Lucas' })
  const founder = await Promise.all([
    lucasForB.locator('.founder-badge').count(),
    lucasForB.locator('.deco.founder').count(),
    lucasForB.locator('.name-fx-holo').count(),
    b.page.locator('.members button.member', { hasText: 'Duarte' }).locator('.founder-badge').count(),
  ])
  check(founder.join(',') === '1,1,1,0', 'B vê o selo de Fundador, a moldura e o nome holográfico só no dono', founder.join(','))
  const pioneer = await Promise.all([
    a.page.locator('.members button.member', { hasText: 'Duarte' }).locator('.pioneer-badge').count(),
    lucasForB.locator('.pioneer-badge').count(),
  ])
  check(pioneer.join(',') === '1,0', 'A vê o selo de Pioneiro no Duarte (a primeira conta depois do dono), e só nele', pioneer.join(','))
  await a.page.getByRole('button', { name: 'Mensagem', exact: true }).click({ force: true })
  await a.page.getByPlaceholder('Mensagem pra Duarte').fill('oi no privado')
  await a.page.keyboard.press('Enter')
  await b.page.getByRole('button', { name: 'Mensagem de Lucas', exact: true }).waitFor({ timeout: 5000 })
  await shot(b, '3-dm-nao-lida')
  await b.page.getByRole('button', { name: 'Mensagem de Lucas', exact: true }).click({ force: true })
  await b.page.locator('.scroller').getByText('oi no privado').waitFor({ timeout: 5000 })
  check(true, 'mensagem privada chega, aparece no trilho e abre')
  await shot(b, '3b-dm')

  // Ligação privada: A liga, B atende, os dois ficam na call; A desliga.
  await fakeMic(a.page)
  await fakeMic(b.page)
  await a.page.getByRole('button', { name: 'Ligar', exact: true }).first().click({ force: true })
  await b.page.getByRole('button', { name: 'Atender', exact: true }).waitFor({ timeout: 10_000 })
  await shot(b, '4-ligacao')
  await b.page.getByRole('button', { name: 'Atender', exact: true }).click({ force: true })
  await a.page.locator('.dock .status', { hasText: 'Na call' }).waitFor({ timeout: 10_000 })
  await b.page.locator('.dock .status', { hasText: 'Na call' }).waitFor({ timeout: 10_000 })
  check(true, 'ligação privada: B atende e os dois entram na call')
  // Como no Discord: quem fica sozinho continua na chamada até desligar também.
  await a.page.getByRole('button', { name: 'Sair da call', exact: true }).click({ force: true })
  await a.page.locator('.dock .status').waitFor({ state: 'detached', timeout: 10_000 })
  await b.page.getByRole('button', { name: 'Sair da call', exact: true }).click({ force: true })
  await b.page.locator('.dock .status').waitFor({ state: 'detached', timeout: 10_000 })
  check(true, 'cada um desliga e sai da ligação')

  for (const side of [a, b]) {
    await side.page.getByRole('button', { name: 'Turma', exact: true }).click({ force: true })
    await channel(side.page, 'geral').click({ force: true })
  }

  // Call P2P no canal de voz.
  const micBefore = await rectOf(a.page, 'Mutar')
  await a.page.getByRole('button', { name: 'Geral: entrar na call', exact: true }).click({ force: true })
  await b.page.getByRole('button', { name: 'Geral: entrar na call', exact: true }).click({ force: true })
  await a.page.locator('.dock .status', { hasText: 'Na call' }).waitFor({ timeout: 10_000 })
  const micAfter = await rectOf(a.page, 'Mutar')
  check(micBefore === micAfter, 'mutar/ensurdecer/configurações não mudam de lugar ao entrar na call', `${micBefore} → ${micAfter}`)
  // As barras do sinal aparecem já medindo; o ping (em texto pra leitor de tela) chega em seguida.
  const ping = a.page.locator('.member .ping').first()
  await ping.waitFor({ state: 'attached', timeout: 15_000 })
  await a.page.waitForFunction(() => /\d+ ms/.test(document.querySelector('.member .ping')?.textContent ?? ''), null, { timeout: 15_000 })
  const pingText = await ping.textContent()
  check(!pingText.includes('relay'), 'A e B conectados direto (P2P)', pingText.trim())
  // O ícone de conexão de cada um só aparece passando o mouse na pessoa.
  const pingAtRest = await ping.isVisible()
  await a.page.locator('.member-main', { hasText: 'Duarte' }).hover({ force: true })
  const pingOnHover = await ping.isVisible()
  await a.page.mouse.move(0, 0)
  check(!pingAtRest && pingOnHover, 'ícone de conexão de cada um só aparece passando o mouse')

  // Volume de cada um pro outro em 0 (nada sai na caixa de som) e o tom liga.
  for (const [page, other] of [
    [a.page, 'Duarte'],
    [b.page, 'Lucas'],
  ]) {
    await page.locator('.member-main', { hasText: other }).click({ force: true })
    await page.locator('.volume input[type=range]').fill('0')
    await page.evaluate(() => (window.__micGain.gain.value = 0.3))
  }
  await a.page.waitForTimeout(800)
  const speaking = await a.page.locator('.member', { hasText: 'Duarte' }).locator('.avatar.speaking').count()
  check(speaking === 1, 'A vê o indicador de fala de B')
  check(micFallbacks.length === 0, 'microfone passa pelo processador (RNNoise/limiar) carregado no AudioWorklet')

  // Webcam: B liga, A abre a tela da call e vê o vídeo; B desliga e volta o avatar.
  const camBefore = await rectOf(b.page, 'Ligar câmera')
  await b.page.getByRole('button', { name: 'Ligar câmera', exact: true }).click({ force: true })
  await a.page.locator('li.member', { hasText: 'Duarte' }).locator('.soft').waitFor({ timeout: 10_000 })
  const camAfter = await rectOf(b.page, 'Desligar câmera')
  check(camBefore === camAfter, 'botão da câmera fica no mesmo lugar ligado e desligado', `${camBefore} → ${camAfter}`)
  await a.page.getByRole('button', { name: 'Abrir a call', exact: true }).click({ force: true })
  await a.page
    .waitForFunction(() => [...document.querySelectorAll('.tile video')].some((v) => v.videoWidth > 0), null, { timeout: 15_000 })
    .then(() => check(true, 'A vê a câmera de B na tela da call'))
    .catch(() => check(false, 'A vê a câmera de B na tela da call'))
  await shot(a, '2b-camera')
  await b.page.getByRole('button', { name: 'Desligar câmera', exact: true }).click({ force: true })
  await a.page
    .waitForFunction(() => document.querySelectorAll('.tile video').length === 0, null, { timeout: 10_000 })
    .then(() => check(true, 'desligar a câmera volta o avatar'))
    .catch(() => check(false, 'desligar a câmera volta o avatar'))
  await channel(a.page, 'geral').click({ force: true })
  await shot(a, '5-call')

  // Tela: A compartilha (áudio pelo venmic no Linux) e B assiste.
  const player = withAudio ? silentPlayer() : null
  await a.page.waitForTimeout(500)
  await fakeScreen(a.page, !withAudio)
  const screenBefore = await rectOf(a.page, 'Compartilhar tela')
  await a.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).click({ force: true })
  await a.page.locator('.modal').waitFor()
  await a.page.waitForTimeout(300)
  await shot(a, '3-compartilhar')
  await a.page.locator('.segmented button', { hasText: full ? '1440p' : '720p' }).click({ force: true })
  const audioBox = a.page.locator('.modal #share-audio')
  if ((await audioBox.isChecked()) !== withAudio) await audioBox.click({ force: true })
  // A "tela" é o monitor TESTE-2 (o da direita): o quadradinho só aparece na captura quando a camada está lá.
  let probing = true
  const probeBridge = (async () => {
    for (let i = 0; probing && i < 400; i++) {
      const log = await a.app.evaluate(() => globalThis.__resenhaInk)
      const last = log.events.filter((e) => e.t === 'probe').at(-1)
      await a.page.evaluate((on) => (window.__inkProbe = on), log.started === 'TESTE-2' && last?.on === true)
      await a.page.waitForTimeout(25)
    }
  })()
  await a.page.locator('.modal').getByRole('button', { name: 'Compartilhar', exact: true }).click({ force: true })
  const live = b.page.locator('button.live')
  await live.waitFor({ timeout: 10_000 })
  await live.click({ force: true })
  await b.page.waitForFunction(() => document.querySelector('.stream video')?.videoWidth > 0, null, { timeout: 15_000 })
  check(true, 'B recebeu o vídeo da tela de A')
  if (viaSfu) {
    // Com uma pessoa assistindo (sfuMinViewers 1), A publica no SFU e B troca pra lá.
    await b.page.getByRole('button', { name: 'Estatísticas', exact: true }).click({ force: true })
    const started = Date.now()
    const onSfu = await b.page
      .waitForFunction(() => document.querySelector('.stats')?.textContent?.includes('via Cloudflare'), null, { timeout: 40_000 })
      .then(() => true, () => false)
    const seen = (await b.page.locator('.stats').innerText({ timeout: 1000 }).catch(() => '(sem estatísticas)')).replace(/\n/g, ' | ')
    check(onSfu, 'tela troca pro SFU do Cloudflare (uma cópia só, distribuída por lá)', onSfu ? `${Date.now() - started} ms` : seen)
    await b.page.waitForFunction(() => document.querySelector('.stream video')?.videoWidth > 0, null, { timeout: 15_000 })
    await b.page.getByRole('button', { name: 'Estatísticas', exact: true }).click({ force: true })
  }

  if (withAudio) {
    const audioPid = (side) => side.app.evaluate(({ app }) => app.getAppMetrics().find((p) => p.name === 'Audio Service')?.pid?.toString())
    const pid = await audioPid(a)
    const otherPid = await audioPid(b)
    await a.page.waitForTimeout(1500)
    const sources = venmicSources()
    check(sources !== null, 'venmic criou o microfone virtual')
    if (sources) {
      console.log('   ligado no venmic:', sources.map((s) => `${s.app ?? s.name} [${s.binary ?? '?'} pid ${s.pid}]`).join(', ') || 'nada')
      check(sources.some((s) => s.pid === String(player.proc.pid) || /pw-play/i.test(`${s.name} ${s.app} ${s.binary}`)), 'áudio de outro app (pw-play) entra no áudio da tela')
      check(!sources.some((s) => s.pid === pid), 'som do próprio app (Audio Service) NÃO entra no áudio da tela', `pid ${pid}`)
      // A outra instância é "outro app" pra quem compartilha: tem que entrar. Prova que o teste enxerga o Electron.
      check(sources.some((s) => s.pid === otherPid), 'som de outro Electron (a instância B) entra', `pid ${otherPid}`)
    }
    const audioTracks = await b.page.evaluate(() => document.querySelector('.stream video')?.srcObject?.getAudioTracks().length ?? 0)
    check(audioTracks === 1, 'B recebe o áudio da tela junto com o vídeo')
  } else {
    // Áudio da tela em estéreo de verdade: cada tom chega só no seu lado.
    const levels = await stereoLevels(b.page)
    const separated = !!levels && levels.left440 - levels.left1500 > 30 && levels.right1500 - levels.right440 > 30
    check(separated, 'áudio da tela chega em estéreo (esquerda e direita separadas)', JSON.stringify(levels))
  }

  // Atraso e estatísticas do lado de quem assiste, já na resolução cheia (o WebRTC começa baixo e sobe).
  await b.page
    .waitForFunction((w) => document.querySelector('.stream video')?.videoWidth >= w, targetWidth, { timeout: 30_000 })
    .catch(() => console.log(`   (não chegou a ${targetWidth}px de largura em 30 s)`))
  await b.page.waitForTimeout(2000)
  const { delays, width, height } = await measureLatency(b.page)
  const med = median(delays)
  const p95 = [...delays].sort((x, y) => x - y)[Math.floor(delays.length * 0.95)]
  check(delays.length > 30, `atraso de ponta a ponta (${delays.length} quadros)`, `mediana ${med} ms, p95 ${p95} ms, ${width}x${height}`)
  await b.page.getByRole('button', { name: 'Estatísticas', exact: true }).click({ force: true })
  await b.page.locator('.stats').waitFor()
  await b.page.waitForTimeout(2500)
  console.log('   estatísticas em B:', (await b.page.locator('.stats').innerText()).replace(/\n/g, ' | '))
  // Muda a qualidade pelo painel de quem transmite e o codec pelas configurações (Avançado), com a transmissão rolando.
  const livePanel = () => a.page.getByRole('button', { name: 'Ao vivo: opções da transmissão', exact: true }).click({ force: true })
  const screenAfter = await rectOf(a.page, 'Ao vivo: opções da transmissão')
  check(screenBefore === screenAfter, 'botão da tela fica no mesmo lugar antes e durante a transmissão', `${screenBefore} → ${screenAfter}`)
  await livePanel()
  const viewers = await a.page.locator('.share-panel .viewers').textContent()
  check(viewers?.includes('1 pessoa'), 'quem transmite vê quantas pessoas assistem', viewers ?? '')
  await shot(a, '3b-ao-vivo')
  await a.page.locator('.share-panel .segmented button', { hasText: '1080p' }).click({ force: true })
  await a.page.keyboard.press('Escape')
  await a.page.getByRole('button', { name: 'Configurações', exact: true }).click({ force: true })
  await a.page.getByRole('button', { name: 'Voz e vídeo', exact: true }).click({ force: true })
  await a.page.getByRole('button', { name: 'Avançado', exact: true }).click({ force: true })
  await a.page.locator('.settings .segmented button', { hasText: 'H264' }).click({ force: true })
  await a.page.keyboard.press('Escape')
  // Pelo SFU o codec fica o do começo da transmissão (trocar exigiria renegociar com o Cloudflare).
  if (!viaSfu)
    await b.page.waitForFunction(() => document.querySelector('.stats')?.textContent?.includes('H264'), null, { timeout: 20_000 })
      .then(() => check(true, 'codec trocou pra H264 ao vivo'))
      .catch(() => check(false, 'codec trocou pra H264 ao vivo', 'continuou o mesmo'))
  await b.page.waitForFunction(() => document.querySelector('.stream video')?.videoWidth > 1280, null, { timeout: 30_000 })
    .then(() => check(true, 'resolução subiu de 720p pra 1080p ao vivo'))
    .catch(() => check(false, 'resolução subiu de 720p pra 1080p ao vivo'))
  console.log('   estatísticas em B depois da troca:', (await b.page.locator('.stats').innerText()).replace(/\n/g, ' | '))

  // Quedas de conexão no meio da transmissão: voz e tela são P2P e não podem cair junto, e
  // ninguém sai da call pros outros. Quem assiste continua assistindo, sem clicar em nada.
  for (const [who, side] of [['quem transmite', a], ['quem assiste', b]]) {
    const watching = watchFor(b.page, 4000)
    const back = await side.dropGuild()
    const { frames, fewest } = await watching
    check(back && frames > 100 && fewest === 2, `conexão de ${who} cai e volta: B continua assistindo e ninguém sai da call`, `${frames} quadros em 4 s`)
  }
  // O servidor reinicia (todo mundo cai junto e ele esquece a call): a tela segue e tudo volta sozinho.
  const before = { a: a.guildSockets.length, b: b.guildSockets.length }
  const duringRestart = watchFor(b.page, 3000)
  await server.restart()
  const { frames: framesDuring } = await duringRestart
  for (let i = 0; i < 300 && (a.guildSockets.length === before.a || b.guildSockets.length === before.b); i++) await a.page.waitForTimeout(100)
  await b.page.waitForTimeout(1500)
  const after = await watchFor(b.page, 3000)
  const liveBadges = await b.page.locator('nav button.live').count()
  check(
    framesDuring > 60 && after.frames > 90 && after.fewest === 2 && liveBadges === 1,
    'servidor reinicia no meio da transmissão: a tela não para e a call volta sozinha',
    `${framesDuring} quadros durante, ${after.frames} depois`,
  )

  // Tirar e devolver o som da transmissão volta pro volume de antes (B ensurdecido: nada toca).
  await b.page.getByRole('button', { name: 'Ensurdecer', exact: true }).click({ force: true })
  await b.page.locator('.stream').hover({ force: true })
  const streamVolume = b.page.getByLabel('Volume da transmissão')
  await streamVolume.fill('0.3')
  await b.page.getByRole('button', { name: 'Tirar o som', exact: true }).click({ force: true })
  const whileMuted = await streamVolume.inputValue()
  await b.page.getByRole('button', { name: 'Ativar o som', exact: true }).click({ force: true })
  const volumeBack = await streamVolume.inputValue()
  check(whileMuted === '0' && volumeBack === '0.3', 'tirar e devolver o som da transmissão volta pro volume de antes', `${whileMuted} → ${volumeBack}`)
  await streamVolume.fill('0')
  await b.page.getByRole('button', { name: 'Voltar a ouvir', exact: true }).click({ force: true })

  // Rabiscos: B desenha e clica na tela de A; os traços chegam em A em 0..1 (a resolução não importa).
  const inkLog = () => a.app.evaluate(() => globalThis.__resenhaInk)
  const scribble = b.page.getByRole('button', { name: 'Rabiscar na tela', exact: true })
  await b.page.locator('.stream').hover({ force: true })
  const offered = await scribble.waitFor({ timeout: 10_000 }).then(() => true, () => false)
  probing = false
  await probeBridge
  check(
    offered && (await inkLog()).started === 'TESTE-2',
    'monitor inteiro (mesmo o Electron dizendo "janela", como no Wayland): quem assiste pode rabiscar, e a camada vai pro monitor transmitido',
    `camada em ${(await inkLog()).started}`,
  )
  if (offered) {
    await scribble.click({ force: true })
    const inkBox = await b.page.locator('.ink-layer').boundingBox()
    const view = await b.page.evaluate(() => {
      const v = document.querySelector('.stream video')
      const r = v.getBoundingClientRect()
      const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight)
      return { left: r.left + (r.width - v.videoWidth * scale) / 2, top: r.top + (r.height - v.videoHeight * scale) / 2, w: v.videoWidth * scale, h: v.videoHeight * scale }
    })
    const at = (x, y) => [view.left + x * view.w, view.top + y * view.h]
    await b.page.mouse.move(...at(0.25, 0.5))
    await b.page.mouse.down()
    await b.page.mouse.move(...at(0.75, 0.5), { steps: 20 })
    await b.page.mouse.up()
    await b.page.waitForTimeout(150)
    await b.page.mouse.click(...at(0.5, 0.25))
    await shot(b, '4c-rabiscando')
    let events = []
    for (let i = 0; i < 30; i++) {
      events = (await inkLog()).events
      if (events.some((e) => e.t === 'ping')) break
      await a.page.waitForTimeout(100)
    }
    const strokes = events.filter((e) => e.t === 'stroke')
    const points = strokes.flatMap((e) => e.points)
    const xs = points.filter((_, i) => i % 2 === 0)
    const ys = points.filter((_, i) => i % 2 === 1)
    const near = (v, want) => Math.abs(v - want) < 0.03
    const ping = events.find((e) => e.t === 'ping')
    check(
      !!inkBox && strokes.length > 0 && strokes.at(-1).end && near(Math.min(...xs), 0.25) && near(Math.max(...xs), 0.75) && ys.every((y) => near(y, 0.5)) && strokes[0].name === 'Duarte',
      'traço de B chega em A na posição certa, com o nome de quem desenhou',
      `${strokes.length} pedaços, x ${Math.min(...xs).toFixed(3)}..${Math.max(...xs).toFixed(3)}`,
    )
    check(!!ping && near(ping.x, 0.5) && near(ping.y, 0.25), 'clique rápido vira um aviso ("ping") no lugar certo', ping ? `${ping.x.toFixed(3)}, ${ping.y.toFixed(3)}` : 'não chegou')

    // Sem rabisco dobrado: o traço de B volta pelo vídeo (a "tela" de A desenha o que chega,
    // como a camada de verdade), e o eco de B tem que cobrir essa cópia inteira.
    await a.page.evaluate(() => {
      window.__staticScreen = true
      window.__inkStrokes = new Map()
    })
    let bridging = true
    let seen = (await inkLog()).events.length
    const bridge = (async () => {
      while (bridging) {
        const events = (await inkLog()).events
        const fresh = events.slice(seen)
        seen = events.length
        if (fresh.length)
          await a.page.evaluate((list) => {
            for (const e of list) {
              if (e.t !== 'stroke') continue
              const s = window.__inkStrokes.get(e.id) ?? { color: e.color, name: e.name, points: [], updated: 0 }
              for (let i = 0; i + 1 < e.points.length; i += 2) s.points.push([e.points[i], e.points[i + 1]])
              s.updated = performance.now()
              window.__inkStrokes.set(e.id, s)
            }
          }, fresh)
        await a.page.waitForTimeout(16)
      }
    })()
    await b.page.getByRole('radio', { name: 'Caneta' }).click({ force: true })
    await b.page.waitForTimeout(400)
    const wave = (k) => at(0.3 + 0.4 * k, 0.62 + 0.12 * Math.sin(k * Math.PI * 2))
    await b.page.mouse.move(...wave(0))
    await b.page.mouse.down()
    for (let k = 1; k <= 20; k++) await b.page.mouse.move(...wave(k / 40))
    await shot(b, '4d-rabiscando-no-meio')
    for (let k = 21; k <= 40; k++) await b.page.mouse.move(...wave(k / 40))
    await b.page.mouse.up()
    const coverage = () =>
      b.page.evaluate(() => {
        const video = document.querySelector('.stream video')
        const echo = document.querySelector('.ink-layer')
        const er = echo.getBoundingClientRect()
        const vr = video.getBoundingClientRect()
        const scale = Math.min(vr.width / video.videoWidth, vr.height / video.videoHeight)
        const [bw, bh] = [video.videoWidth * scale, video.videoHeight * scale]
        const [bl, bt] = [vr.left + (vr.width - bw) / 2 - er.left, vr.top + (vr.height - bh) / 2 - er.top]
        const [W, H] = [Math.round(er.width), Math.round(er.height)]
        const frame = Object.assign(document.createElement('canvas'), { width: W, height: H })
        const fg = frame.getContext('2d')
        fg.drawImage(video, bl, bt, bw, bh)
        const vid = fg.getImageData(0, 0, W, H).data
        const ratio = echo.width / er.width
        const ech = echo.getContext('2d').getImageData(0, 0, echo.width, echo.height).data
        let copy = 0
        let uncovered = 0
        // Pula a faixa de cima (os blocos do relógio) e a borda.
        for (let y = Math.ceil(bt + bh * 0.1); y < bt + bh - 2; y++)
          for (let x = Math.ceil(bl + 2); x < bl + bw - 2; x++) {
            const i = (y * W + x) * 4
            if (Math.abs(vid[i] - 0x20) + Math.abs(vid[i + 1] - 0x20) + Math.abs(vid[i + 2] - 0x28) < 40) continue
            copy++
            if (ech[(Math.floor(y * ratio) * echo.width + Math.floor(x * ratio)) * 4 + 3] === 0) uncovered++
          }
        return { copy, uncovered }
      })
    let cover = { copy: 0, uncovered: 0 }
    for (let i = 0; i < 30 && cover.copy < 400; i++) {
      await b.page.waitForTimeout(100)
      cover = await coverage()
    }
    await b.page.waitForTimeout(300)
    cover = await coverage()
    await shot(b, '4e-rabisco-sem-dobro')
    await b.page.evaluate(() => (document.querySelector('.ink-layer').style.visibility = 'hidden'))
    await shot(b, '4f-so-a-copia-do-video')
    await b.page.evaluate(() => (document.querySelector('.ink-layer').style.visibility = ''))
    check(
      cover.copy > 400 && cover.uncovered / cover.copy < 0.04,
      'quem rabisca não vê o próprio traço dobrado: o eco cobre a cópia que volta pelo vídeo',
      `${cover.copy} px da cópia no vídeo, ${cover.uncovered} de fora do eco (${((100 * cover.uncovered) / Math.max(1, cover.copy)).toFixed(1)}%)`,
    )
    bridging = false
    await bridge
    await a.page.evaluate(() => {
      window.__staticScreen = false
      window.__inkStrokes = new Map()
    })
    await b.page.getByRole('radio', { name: 'Laser' }).click({ force: true })

    await b.page.keyboard.press('Escape')
    check((await b.page.locator('.ink-layer.active').count()) === 0, 'Esc sai do modo de rabiscar')
    // Quem compartilha apaga tudo e desliga: quem assiste perde o botão na hora.
    await livePanel()
    await a.page.getByRole('button', { name: 'Limpar rabiscos', exact: true }).click({ force: true })
    check((await inkLog()).events.at(-1)?.t === 'clear', 'quem compartilha apaga os rabiscos')
    await a.page.locator('.share-panel input[role=switch]').click({ force: true })
    await a.page.keyboard.press('Escape')
    await b.page.locator('.stream').hover({ force: true })
    const gone = await scribble.waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false)
    const blocked = await b.page.getByRole('button', { name: 'Lucas não deixou rabiscar', exact: true }).waitFor({ timeout: 3000 }).then(() => true, () => false)
    check(gone && blocked, 'desligar os rabiscos tira o lápis de quem assiste (fica apagado, dizendo por quê)')
  }

  await b.page.locator('.stream').hover({ force: true })
  await shot(b, '4-assistindo')
  await b.page.getByRole('button', { name: 'Minimizar', exact: true }).click({ force: true })
  await b.page.waitForTimeout(500)
  await shot(b, '5-miniatura')

  await livePanel()
  await a.page.getByRole('button', { name: 'Ver minha tela' }).click({ force: true })
  await a.page.getByRole('button', { name: 'Estatísticas', exact: true }).click({ force: true })
  await a.page.waitForTimeout(2500)
  console.log('   estatísticas em A:', (await a.page.locator('.stats').innerText()).replace(/\n/g, ' | '))
  await a.page.getByRole('button', { name: 'Configurações', exact: true }).click({ force: true })
  await a.page.waitForTimeout(300)
  await shot(a, '6-configuracoes')
  // Configurações em tela cheia: a navegação e o título da página não mudam de lugar entre as páginas.
  const positions = () =>
    a.page.evaluate(() => {
      const nav = document.querySelector('.settings-nav button')?.getBoundingClientRect()
      const title = document.querySelector('.settings-content h1')?.getBoundingClientRect()
      return `${Math.round(nav?.top ?? -1)}/${Math.round(title?.top ?? -1)}`
    })
  const tops = []
  const pages = await a.page.locator('.settings-nav button').allInnerTexts()
  for (const page of pages.filter((p) => !/Sair/.test(p))) {
    await a.page.locator('.settings-nav button', { hasText: page.trim() }).first().click({ force: true })
    tops.push(await positions())
    await shot(a, `6-configuracoes-${page.trim().toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`)
  }
  check(new Set(tops).size === 1, 'navegação e título das configurações ficam no mesmo lugar em todas as páginas', tops.join(','))
  // A última página é a Plataforma: o dono vê os números (com os convites), o cadastro e as contas.
  // Os números e o cadastro esperam o /api/admin; a lista de contas aparece antes.
  await a.page.locator('.settings-content [data-setting="platform.invites"]').waitFor({ timeout: 5000 }).catch(() => {})
  const ownerPanel = await Promise.all(
    ['platform.invites', 'platform.signup', 'platform.accounts'].map((id) => a.page.locator(`.settings-content [data-setting="${id}"]`).count()),
  )
  check(ownerPanel.join(',') === '1,1,1', 'o dono vê a Plataforma inteira: números, convites, cadastro e contas', ownerPanel.join(','))
  // Idiomas: Aplicativo → Idioma troca a interface na hora (inglês, espanhol) e volta pro português.
  await a.page.locator('.settings-nav button', { hasText: 'Aplicativo' }).first().click({ force: true })
  const pageTitle = () => a.page.locator('.settings-content h1').innerText()
  await a.page.getByLabel('Idioma do Resenha').selectOption('en')
  const inEnglish = [await pageTitle(), await a.page.evaluate(() => document.documentElement.lang)]
  await shot(a, '6d-idioma-ingles')
  await a.page.getByLabel('Resenha language').selectOption('es')
  const inSpanish = await pageTitle()
  await shot(a, '6e-idioma-espanhol')
  await a.page.getByLabel('Idioma de Resenha').selectOption('pt')
  const backInPortuguese = await pageTitle()
  check(
    inEnglish.join('/') === 'App/en-US' && inSpanish === 'Aplicación' && backInPortuguese === 'Aplicativo',
    'trocar o idioma muda a interface na hora (inglês, espanhol) e volta pro português',
    `${inEnglish.join('/')} · ${inSpanish} · ${backInPortuguese}`,
  )
  // Inglês e espanhol de ponta a ponta: em cada um, passa pelas configurações, pela tela do servidor,
  // pelas configurações do servidor e pelo início, procurando texto que ficou em português.
  const UI_IN = {
    en: { settings: 'Settings', app: 'App', serverSettings: 'Server settings', home: 'Home' },
    es: { settings: 'Configuración', app: 'Aplicación', serverSettings: 'Configuración del servidor', home: 'Inicio' },
  }
  const portugueseOnScreen = (where) =>
    a.page.evaluate((where) => {
      // Palavras e letras que só o português tem (nem o inglês nem o espanhol usam).
      const word = /(?<![\p{L}])(não|você|pra|mensagens?|configurações|configuração|sair|ligar|chamada|tela|salvar|fechar|voltar|aparelhos?|notificações|atalhos|ouvir|mutar|ensurdecer|compartilhar|assistir|convidar|convites?|membros|excluir|carregando|digitando|agora|ontem|hoje|nenhuma?|também|quem|onde|senha|contas?|uma|um|sem|já|só|isso|esse|essa|pessoas?)(?![\p{L}])/iu
      const letters = /[ãõçêâôà]/i
      const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
      // O que as pessoas escreveram (mensagens e a citação da resposta) é dado, não texto do app.
      const written = (el) => !!el?.closest('.md, .reply-text')
      const found = new Set()
      const test = (text) => {
        const clean = text.replace(/\s+/g, ' ').trim()
        if (clean && (word.test(clean) || letters.test(clean))) found.add(clean.slice(0, 90))
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (visible(node.parentElement) && !written(node.parentElement)) test(node.textContent ?? '')
      for (const el of document.querySelectorAll('[aria-label], [title], [placeholder], [alt]')) {
        if (!visible(el) || written(el)) continue
        for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) if (el.getAttribute(attr)) test(el.getAttribute(attr))
      }
      return [...found].map((text) => `${where}: ${text}`)
    }, where)
  const leftovers = []
  for (const lang of ['en', 'es']) {
    const ui = UI_IN[lang]
    await a.page.locator('[data-setting="app.language"] select').selectOption(lang)
    for (const button of await a.page.locator('.settings-nav button').all()) {
      const name = (await button.innerText()).trim()
      if (/log out|cerrar sesi/i.test(name)) continue
      await button.click({ force: true })
      await a.page.waitForTimeout(150)
      leftovers.push(...(await portugueseOnScreen(`${lang} · ${name}`)))
      await shot(a, `7-${lang}-config-${name.toLowerCase().replace(/\W+/g, '-')}`)
    }
    const closeSettings = () => a.page.locator('.settings .close button').click({ force: true })
    await closeSettings()
    await a.page.waitForTimeout(200)
    leftovers.push(...(await portugueseOnScreen(`${lang} · servidor`)))
    await shot(a, `7-${lang}-servidor`)
    await a.page.locator('header button.server').click({ force: true })
    await a.page.getByRole('menuitem', { name: ui.serverSettings }).click({ force: true })
    for (const button of await a.page.locator('.settings-nav button').all()) {
      const name = (await button.innerText()).trim()
      if (!name) continue
      await button.click({ force: true })
      await a.page.waitForTimeout(150)
      leftovers.push(...(await portugueseOnScreen(`${lang} · ${name}`)))
      await shot(a, `7-${lang}-servidor-${name.toLowerCase().replace(/\W+/g, '-')}`)
    }
    await closeSettings()
    await a.page.locator('nav.rail button.home').click({ force: true })
    await a.page.waitForTimeout(200)
    leftovers.push(...(await portugueseOnScreen(`${lang} · início`)))
    await shot(a, `7-${lang}-inicio`)
    await a.page.locator('nav.rail').getByRole('button', { name: 'Turma', exact: true }).click({ force: true })
    await a.page.locator('.dock').getByRole('button', { name: ui.settings, exact: true }).click({ force: true })
    await a.page.locator('.settings-nav').getByRole('button', { name: ui.app, exact: true }).click({ force: true })
  }
  await a.page.locator('[data-setting="app.language"] select').selectOption('pt')
  console.log(leftovers.length ? `   português que sobrou:\n     ${leftovers.join('\n     ')}` : '   nada em português no inglês e no espanhol')
  check(leftovers.length === 0, 'em inglês e em espanhol não sobra texto em português na tela', `${leftovers.length} trechos`)
  // Busca nas configurações: "ruido" (sem acento) leva pra "Redução de ruído", que pisca.
  const settingsSearch = a.page.getByLabel('Buscar nas configurações')
  await settingsSearch.fill('ruido')
  const firstResult = a.page.locator('.settings-nav .result').first()
  await firstResult.waitFor({ timeout: 3000 })
  const resultText = (await firstResult.innerText()).replace(/\n/g, ' · ')
  await shot(a, '6b-busca-configuracoes')
  await settingsSearch.press('Enter')
  const flashed = (id) =>
    a.page.locator(`.settings-content [data-setting="${id}"].setting-flash`).waitFor({ timeout: 3000 }).then(() => true, () => false)
  check(
    resultText.startsWith('Redução de ruído') && (await flashed('voice.noise')) && (await a.page.locator('.settings-content h1').innerText()) === 'Voz e vídeo',
    'busca nas configurações ("ruido") abre a página certa e destaca a opção',
    resultText,
  )
  await a.page.keyboard.press('Escape')
  // Pelo Ctrl+K, de fora das configurações: uma opção escondida no "Avançado".
  await a.page.keyboard.press('Control+k')
  await a.page.locator('.switcher input').fill('eco')
  const settingItem = a.page.locator('.switcher .item', { hasText: 'Cancelamento de eco' })
  const listed = await settingItem.waitFor({ timeout: 3000 }).then(() => true, () => false)
  if (listed) await settingItem.click({ force: true })
  check(listed && (await flashed('voice.echo')), 'Ctrl+K acha configuração e abre direto nela (até dentro do "Avançado")')
  await a.page.keyboard.press('Escape')
  // O melhor amigo do dono (B, o Pioneiro) abre a Plataforma só pra ver: os números, sem cadastro nem contas.
  await b.page.getByRole('button', { name: 'Configurações', exact: true }).click({ force: true })
  await b.page.locator('.settings-nav button', { hasText: 'Plataforma' }).first().click({ force: true })
  const invitesForB = b.page.locator('.settings-content [data-setting="platform.invites"] .stat-value')
  const invitesText = await invitesForB.waitFor({ timeout: 5000 }).then(() => invitesForB.innerText(), () => null)
  const ownerOnly = await Promise.all([
    b.page.locator('.settings-content [data-setting="platform.signup"]').count(),
    b.page.locator('.settings-content [data-setting="platform.accounts"]').count(),
  ])
  await shot(b, '6c-plataforma-melhor-amigo')
  await b.page.keyboard.press('Escape')
  check(
    invitesText !== null && Number(invitesText) >= 1 && ownerOnly.join(',') === '0,0',
    'o melhor amigo do dono vê os números da Plataforma (com os convites ativos), sem cadastro nem contas',
    `${invitesText}/${ownerOnly.join(',')}`,
  )

  // Parar de compartilhar some com o player de B.
  await livePanel()
  await a.page.locator('.share-panel').getByRole('button', { name: 'Parar', exact: true }).click({ force: true })
  await b.page.locator('.stream').waitFor({ state: 'detached', timeout: 5000 })
  check(true, 'parar de compartilhar fecha o player de B')

  // Sala pelo Cloudflare: só o dono do Resenha (A) tem a opção; os dois veem a nuvem. Sem TURN no
  // servidor do teste, a call continua direta e avisa (o caminho de verdade só existe em produção).
  // "Geral" com G maiúsculo (a busca por texto comum ignora maiúsculas e pegaria o canal de texto "geral").
  const voiceRow = (page) => page.getByRole('navigation', { name: 'Canais' }).locator('.channel-row', { hasText: /Geral/ }).first()
  await voiceRow(b.page).click({ button: 'right', force: true })
  const bHasOption = await b.page.getByRole('menuitem', { name: /Passar pelo Cloudflare/ }).count()
  await b.page.keyboard.press('Escape')
  await voiceRow(a.page).click({ button: 'right', force: true })
  await a.page.getByRole('menuitem', { name: /Passar pelo Cloudflare/ }).click({ force: true })
  const cloudForB = await voiceRow(b.page).locator('.relay').waitFor({ timeout: 5000 }).then(() => true, () => false)
  const warned = await a.page.locator('.toast', { hasText: 'não está disponível agora' }).waitFor({ timeout: 5000 }).then(() => true, () => false)
  const stillInCall = await a.page.getByRole('button', { name: 'Sair da call', exact: true }).isEnabled()
  check(bHasOption === 0 && cloudForB && warned && stillInCall, 'sala pelo Cloudflare: só o dono liga, todo mundo vê a nuvem, e sem TURN a call segue direta avisando', `${bHasOption}/${cloudForB}/${warned}/${stillInCall}`)
  await voiceRow(a.page).click({ button: 'right', force: true })
  await a.page.getByRole('menuitem', { name: /Passar pelo Cloudflare/ }).click({ force: true })
  await voiceRow(b.page).locator('.relay').waitFor({ state: 'detached', timeout: 5000 })
  if (withAudio) {
    await a.page.waitForTimeout(500)
    check(venmicSources() === null, 'venmic desfez o microfone virtual ao parar')
  }
  player?.cleanup()

  // Janela no tamanho mínimo (940x560): nada pode cortar nem sair do lugar.
  if (SHOTS) {
    await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(940, 560))
    await a.page.waitForTimeout(400)
    await shot(a, '9-janela-minima')
    await a.page.getByRole('button', { name: 'Configurações', exact: true }).click({ force: true })
    await a.page.waitForTimeout(300)
    await shot(a, '9b-janela-minima-configuracoes')
    await a.page.keyboard.press('Escape')
    await a.page.getByRole('button', { name: /^Mapa/ }).click({ force: true })
    await a.page.locator('.map-pane .stage[data-ready]').waitFor({ timeout: 30_000 }).catch(() => {})
    await a.page.getByRole('button', { name: 'Marcadores', exact: true }).click({ force: true })
    await a.page.locator('.map-pin').first().click({ force: true })
    await shot(a, '9c-janela-minima-mapa')
    await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820))
    await a.page.keyboard.press('Control+/')
    await a.page.locator('.modal').waitFor({ timeout: 5000 })
    await shot(a, '9c-atalhos')
    await a.page.keyboard.press('Escape')
  }

  // Lista de canais mais larga: arrasta a borda; duplo clique volta ao normal.
  await a.page.getByRole('navigation', { name: 'Servidores' }).getByRole('button', { name: 'Turma', exact: true }).click({ force: true })
  const sidebarWidth = () => a.page.evaluate(() => Math.round(document.querySelector('.shell > .sidebar').getBoundingClientRect().width))
  const widthBefore = await sidebarWidth()
  const grip = await a.page.locator('.sidebar-resize').boundingBox()
  await a.page.mouse.move(grip.x + grip.width / 2, grip.y + 200)
  await a.page.mouse.down()
  await a.page.mouse.move(grip.x + grip.width / 2 + 100, grip.y + 200, { steps: 8 })
  await a.page.mouse.up()
  const widthWide = await sidebarWidth()
  await a.page.locator('.sidebar-resize').dblclick({ force: true })
  const widthReset = await sidebarWidth()
  check(widthBefore === 248 && widthWide === 348 && widthReset === 248, 'lista de canais alarga arrastando a borda (e o duplo clique volta)', `${widthBefore} → ${widthWide} → ${widthReset}`)

  // Importar do Discord por print. Quem lê o print é o Workers AI (fora do teste): aqui a
  // resposta é a que o modelo deu de verdade pro print de exemplo (test/fixtures).
  const READ = {
    server: 'Resenha dos Amigos ✨',
    channels: [{ name: '📜┃regras', kind: 'text' }],
    categories: [
      { name: 'BATE-PAPO', channels: [{ name: '💬┃geral', kind: 'text' }, { name: '😂┃memes', kind: 'text' }] },
      { name: 'CALLS', channels: [{ name: '🎮 Jogatina', kind: 'voice' }, { name: '💤 AFK', kind: 'voice' }] },
    ],
  }
  let prints = 0
  await a.page.route('**/api/import/discord', (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    prints++
    return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(READ) })
  })
  const printFile = { name: 'discord.png', mimeType: 'image/png', buffer: readFileSync(new URL('./fixtures/discord-print.png', import.meta.url)) }
  // Num servidor que existe: menu do servidor → importar; tira os emojis e cria.
  await a.page.locator('aside header button.server').click({ force: true })
  await a.page.getByRole('menuitem', { name: 'Importar canais do Discord' }).click({ force: true })
  await a.page.locator('.modal input[type=file]').setInputFiles(printFile)
  await a.page.locator('.modal .tree').waitFor({ timeout: 10_000 })
  await shot(a, '10-importar-discord')
  await a.page.locator('.modal .emoji input[role=switch]').click({ force: true })
  const names = await a.page.locator('.modal .tree input').evaluateAll((inputs) => inputs.map((i) => i.value))
  check(
    prints === 1 && names.join('|') === 'regras|Bate-papo|geral|memes|Calls|Jogatina|AFK',
    'print do Discord vira a lista pra conferir (categoria em caixa normal, sem emoji se quiser)',
    names.join(' · '),
  )
  await a.page.locator('.modal').getByRole('button', { name: /^Criar \d+ canais$/ }).click({ force: true })
  const imported = await b.page
    .locator('nav .category', { hasText: 'Calls' })
    .waitFor({ timeout: 10_000 })
    .then(() => b.page.locator('nav button.channel', { hasText: 'Jogatina' }).count())
    .catch(() => 0)
  check(imported === 1, 'canais importados aparecem pra todo mundo do servidor, nas categorias certas')

  // Servidor novo direto do print: nome do print e só os canais importados.
  await a.page.getByRole('button', { name: 'Criar ou entrar num servidor', exact: true }).click({ force: true })
  await a.page.getByRole('button', { name: /Trazer do Discord/ }).click({ force: true })
  await a.page.locator('.modal input[type=file]').setInputFiles(printFile)
  await a.page.locator('.modal .tree').waitFor({ timeout: 10_000 })
  const suggested = await a.page.getByLabel('Nome do servidor').inputValue()
  await a.page.locator('.modal').getByRole('button', { name: 'Criar servidor', exact: true }).click({ force: true })
  const fresh = await a.page
    .getByRole('navigation', { name: 'Servidores' })
    .getByRole('button', { name: 'Resenha dos Amigos', exact: true })
    .waitFor({ timeout: 15_000 })
    .then(async () => {
      for (let i = 0; i < 50; i++) {
        const list = (await a.page.locator('nav .category-toggle, nav button.channel').allInnerTexts()).map((t) => t.trim().split('\n')[0])
        if (list.join('|') === '📜┃regras|Bate-papo|💬┃geral|😂┃memes|Calls|🎮 Jogatina|💤 AFK') return true
        await a.page.waitForTimeout(100)
      }
      return (await a.page.locator('nav .category-toggle, nav button.channel').allInnerTexts()).join(' · ')
    })
    .catch(() => false)
  check(suggested === 'Resenha dos Amigos' && fresh === true, '"Trazer do Discord" cria o servidor com o nome e só os canais do print', `${suggested} · ${fresh}`)
  await shot(a, '10b-servidor-do-discord')

  // Atualizar no meio da call: o app grava a sala ao reiniciar e, ao abrir de novo, oferece
  // voltar pra ela (numa pílula em cima), mutado como estava. (Sem atualização de verdade aqui: o processo principal não instala
  // nada, e recarregar a página faz o papel do app reabrindo.)
  await a.page.getByRole('button', { name: 'Mutar', exact: true }).click({ force: true })
  await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update:state', { status: 'ready', version: '9.9.9' }))
  const restartUpdate = a.page.getByRole('button', { name: 'Reiniciar pra atualizar', exact: true })
  await restartUpdate.waitFor({ timeout: 5000 })
  await restartUpdate.click({ force: true })
  // O processo principal grava a call num arquivo, na hora (o app fecha logo depois pra instalar).
  const rejoinFile = join(homedir(), '.config', `resenha-${PROFILE}-a`, 'rejoin.json')
  let savedCall = null
  for (let i = 0; i < 20 && !savedCall; i++) {
    savedCall = existsSync(rejoinFile) ? readFileSync(rejoinFile, 'utf8') : null
    if (!savedCall) await a.page.waitForTimeout(100)
  }
  // O app volta pra call logo ao abrir: o microfone falso tem que estar lá antes dele (nunca o de verdade).
  await a.page.addInitScript(installFakeMic)
  await a.page.reload()
  // Ao abrir, uma pílula em cima pergunta se quer voltar pra call (com o nome do canal e do servidor).
  const offer = a.page.locator('.rejoin')
  const offerText = await offer.waitFor({ timeout: 15_000 }).then(() => offer.innerText(), () => '')
  await a.page.getByRole('button', { name: 'Reconectar', exact: true }).click({ force: true }).catch(() => {})
  // Entrar na call leva um instante (microfone, conexão): espera o "Sair da call" ficar ativo.
  const rejoined = await a.page
    .waitForFunction(() => {
      const leave = document.querySelector('button[aria-label="Sair da call"]')
      return !!leave && !leave.disabled && !!document.querySelector('button[aria-label="Desmutar"]')
    }, null, { timeout: 20_000 })
    .then(() => true, () => false)
  const callName = await a.page.locator('.dock').innerText().catch(() => '')
  if (!rejoined) console.log('   tela de A depois de reabrir:', (await a.page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400))
  check(
    !!savedCall && /Geral/.test(offerText) && /Turma/.test(offerText) && rejoined && callName.includes('Geral') && (await offer.count()) === 0,
    'reiniciar pra atualizar no meio da call: ao abrir, a pílula oferece voltar e "Reconectar" volta pra mesma sala, mutado',
    `${offerText.replace(/\n/g, ' ')} · ${savedCall ?? 'nada gravado'}`,
  )
  await a.page.getByRole('button', { name: 'Desmutar', exact: true }).click({ force: true })

  // Fechar o app sai da call na hora (não fica "esperando voltar" como numa queda de rede).
  closedA = true
  await a.app.close()
  await b.page
    .waitForFunction(() => document.querySelectorAll('nav .members .member').length === 1, null, { timeout: 8000 })
    .then(() => check(true, 'fechar o app tira da call na hora'))
    .catch(() => check(false, 'fechar o app tira da call na hora', 'continuou na call'))
} catch (err) {
  failures++
  console.error('✘ falhou:', err)
  for (const [name, side] of [['A', a], ['B', b]]) {
    console.error(`   tela de ${name}:`, (await side.page.locator('body').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 600))
  }
} finally {
  if (!closedA) await a.app.close()
  await b.app.close()
  server.stop()
}

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.')
process.exit(failures ? 1 : 0)
