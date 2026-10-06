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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

/** RESENHA_SHOTS=pasta salva capturas da interface pra revisão visual. */
const SHOTS = process.env.RESENHA_SHOTS
const APP_DIR = new URL('..', import.meta.url).pathname
const withAudio = process.env.RESENHA_E2E_AUDIO === '1' && process.platform === 'linux'
const full = process.env.RESENHA_E2E_FULL === '1'
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
    env: { ...process.env, RESENHA_PROFILE: profile, RESENHA_HIDDEN: '1' },
  })
  const page = await app.firstWindow()
  // Sem sons do app durante o teste (nada toca na caixa de som de quem roda). Sem RNNoise
  // também: o microfone falso é um tom puro, e pro RNNoise apito não é voz.
  await page.evaluate(() => localStorage.setItem('resenha.settings', JSON.stringify({ sounds: false, noiseReduction: 'off' })))
  await page.reload()
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    console.log(`   [${profile}] ${msg.text()}`)
    if (/processamento do microfone indisponível|RNNoise não carregou|processador do microfone parou/.test(msg.text())) {
      micFallbacks.push(profile)
    }
  })
  page.on('pageerror', (err) => console.log(`   [${profile}] pageerror: ${err.message}`))
  return { app, page }
}

/** Microfone falso (oscilador) no lugar do real; o microfone virtual do venmic passa direto. */
async function fakeMic(page) {
  await page.evaluate(() => {
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
  })
}

/** "Tela" falsa: canvas 2560x1440 a 60 fps com movimento e o Date.now() em 48 blocos no topo. */
async function fakeScreen(page) {
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2560
    canvas.height = 1440
    const g = canvas.getContext('2d')
    let frame = 0
    setInterval(() => {
      frame++
      g.fillStyle = `hsl(${frame % 360} 50% 35%)`
      g.fillRect(0, 0, 2560, 1440)
      for (let i = 0; i < 24; i++) {
        g.fillStyle = `hsl(${(frame * 7 + i * 30) % 360} 80% 60%)`
        g.fillRect((frame * 17 + i * 113) % 2400, 80 + ((i * 61) % 1300), 160, 100)
      }
      const t = Date.now()
      for (let b = 0; b < 48; b++) {
        g.fillStyle = Math.floor(t / 2 ** b) % 2 ? '#fff' : '#000'
        g.fillRect(b * 40, 0, 40, 40)
      }
    }, 1000 / 60)
    const stream = canvas.captureStream(60)
    navigator.mediaDevices.getDisplayMedia = async () => new MediaStream([stream.getVideoTracks()[0].clone()])
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

async function login(side, name, invite) {
  const { page } = side
  // O servidor vem do build (VITE_DEFAULT_SERVER); espera a tela descobrir se é servidor novo.
  await page.waitForTimeout(700)
  if (invite) {
    // Na tela de entrar, o link "Criar conta" embaixo do cartão troca pro cadastro com convite.
    const toRegister = page.locator('.switch button', { hasText: 'Criar conta' })
    if (await toRegister.isVisible()) await toRegister.click({ force: true })
    await page.getByLabel('Convite').fill(invite)
  }
  await page.getByLabel('Apelido').fill(name)
  await page.getByLabel('Senha').fill('senha-de-teste')
  await shot(side, invite ? '0b-cadastro-convite' : '0-cadastro')
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click({ force: true })
  await page.locator('.shell[data-status=open]').waitFor({ timeout: 10_000 })
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

// ---------------------------------------------------------------------------

const a = await launch('e2e-a')
const b = await launch('e2e-b')

try {
  // Contas: A cria o servidor (admin) e gera o convite; B entra com ele.
  await login(a, 'Lucas')
  check(true, 'A criou a primeira conta (admin)')
  await a.page.getByRole('button', { name: 'Configurações', exact: true }).click({ force: true })
  await a.page.getByRole('button', { name: 'Grupo', exact: true }).click({ force: true })
  await a.page.getByRole('button', { name: 'Gerar convite' }).click({ force: true })
  await a.page.locator('.invite code').waitFor({ timeout: 5000 })
  const invite = (await a.page.locator('.invite code').textContent())?.trim()
  check(!!invite, 'convite gerado', invite)
  await shot(a, '0c-grupo-convite')
  await a.page.keyboard.press('Escape')

  await login(b, 'Amigo', invite)
  check(true, 'B entrou com o convite')

  // Chat e anexo.
  await b.page.getByPlaceholder('Mensagem em #geral').fill('salve, tá me ouvindo?')
  await b.page.keyboard.press('Enter')
  await a.page.getByText('salve, tá me ouvindo?').waitFor({ timeout: 5000 })
  check(true, 'mensagem de B chegou em A')

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  await b.page.locator('input[type=file]').setInputFiles({ name: 'print.png', mimeType: 'image/png', buffer: png })
  await b.page.locator('.upload .upload-meta', { hasText: /\d+ B$/ }).waitFor({ timeout: 10_000 })
  await b.page.getByPlaceholder('Mensagem em #geral').press('Enter')
  const img = a.page.locator('article img[alt="print.png"]')
  await img.waitFor({ timeout: 5000 })
  const loaded = await img.evaluate((el) => (el.complete ? el.naturalWidth : new Promise((r) => (el.onload = () => r(el.naturalWidth)))))
  check(loaded === 1, 'imagem enviada por B aparece em A (URL assinada)')
  await b.page.getByPlaceholder('Mensagem em #geral').fill('olha esse código: `npm run dev` e o link https://example.com')
  await b.page.keyboard.press('Enter')
  await a.page.getByText('olha esse código').waitFor()
  await shot(a, '1-chat')

  // Rolagem do chat: com mensagem suficiente, a lista tem que rolar (era o bug da 0.1.0).
  for (let i = 0; i < 30; i++) {
    await b.page.getByPlaceholder('Mensagem em #geral').fill(`mensagem ${i}`)
    await b.page.keyboard.press('Enter')
  }
  await a.page.getByText('mensagem 29').waitFor()
  const scroll = await a.page.locator('.scroller').evaluate((el) => {
    const before = el.scrollTop
    el.scrollTop = 0
    return { scrollable: el.scrollHeight > el.clientHeight + 50, moved: before !== el.scrollTop }
  })
  check(scroll.scrollable && scroll.moved, 'chat rola quando tem mensagem que não cabe')

  if (SHOTS) {
    // Confirmação de apagar (cancelada com Esc) e o visualizador de imagem.
    await a.page.locator('.scroller').evaluate((el) => (el.scrollTop = el.scrollHeight))
    const last = a.page.locator('article', { hasText: 'mensagem 29' })
    await last.hover({ force: true })
    await last.getByRole('button', { name: 'Apagar' }).click({ force: true })
    await a.page.locator('.modal').waitFor()
    await shot(a, '1e-confirmar')
    await a.page.keyboard.press('Escape')
    await a.page.locator('.modal').waitFor({ state: 'detached' })
    await a.page.locator('article img[alt="print.png"]').click({ force: true })
    await a.page.locator('.lightbox').waitFor()
    await shot(a, '1f-imagem')
    await a.page.keyboard.press('Escape')
    await a.page.locator('.lightbox').waitFor({ state: 'detached' })
  }

  // Mensagem privada: B manda pra A; A vê o aviso e abre.
  await b.page.locator('button.person', { hasText: 'Lucas' }).click({ force: true })
  await b.page.getByPlaceholder('Mensagem para Lucas').fill('oi no privado')
  await b.page.keyboard.press('Enter')
  await a.page.locator('button.person.unread', { hasText: 'Amigo' }).waitFor({ timeout: 5000 })
  await shot(a, '1b-nao-lida')
  await a.page.locator('button.person', { hasText: 'Amigo' }).click({ force: true })
  await a.page.locator('.scroller').getByText('oi no privado').waitFor({ timeout: 5000 })
  check(true, 'mensagem privada chega e aparece como não lida')
  await shot(a, '1c-privado')
  await a.page.locator('nav button.channel', { hasText: 'geral' }).click({ force: true })
  await b.page.locator('nav button.channel', { hasText: 'geral' }).click({ force: true })

  // Call P2P.
  await fakeMic(a.page)
  await fakeMic(b.page)
  const micBefore = await rectOf(a.page, 'Mutar')
  await a.page.locator('nav button.channel', { hasText: 'Resenha' }).click({ force: true })
  await b.page.locator('nav button.channel', { hasText: 'Resenha' }).click({ force: true })
  await a.page.locator('.dock .status', { hasText: 'Na call' }).waitFor({ timeout: 10_000 })
  const micAfter = await rectOf(a.page, 'Mutar')
  check(micBefore === micAfter, 'mutar/ensurdecer/configurações não mudam de lugar ao entrar na call', `${micBefore} → ${micAfter}`)
  // As barras do sinal aparecem já medindo; o ping (em texto pra leitor de tela) chega em seguida.
  const ping = a.page.locator('.member .ping').first()
  await ping.waitFor({ timeout: 15_000 })
  await a.page.waitForFunction(() => /\d+ ms/.test(document.querySelector('.member .ping')?.textContent ?? ''), null, { timeout: 15_000 })
  const pingText = await ping.textContent()
  check(!pingText.includes('relay'), 'A e B conectados direto (P2P)', pingText.trim())

  // Volume de cada um pro outro em 0 (nada sai na caixa de som) e o tom liga.
  for (const [page, other] of [
    [a.page, 'Amigo'],
    [b.page, 'Lucas'],
  ]) {
    await page.locator('.member-main', { hasText: other }).click({ force: true })
    await page.locator('.volume input[type=range]').fill('0')
    await page.evaluate(() => (window.__micGain.gain.value = 0.3))
  }
  await a.page.waitForTimeout(800)
  const speaking = await a.page.locator('.member', { hasText: 'Amigo' }).locator('.avatar.speaking').count()
  check(speaking === 1, 'A vê o indicador de fala de B')
  check(micFallbacks.length === 0, 'microfone passa pelo processador (RNNoise/limiar) carregado no AudioWorklet')

  // Webcam: B liga, A abre a tela da call e vê o vídeo; B desliga e volta o avatar.
  const camBefore = await rectOf(b.page, 'Ligar câmera')
  await b.page.getByRole('button', { name: 'Ligar câmera', exact: true }).click({ force: true })
  await a.page.locator('.member', { hasText: 'Amigo' }).locator('.cam').waitFor({ timeout: 10_000 })
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
  await a.page.locator('nav button.channel', { hasText: 'geral' }).click({ force: true })
  await shot(a, '2-call')

  // Tela: A compartilha (áudio pelo venmic no Linux) e B assiste.
  const player = withAudio ? silentPlayer() : null
  await a.page.waitForTimeout(500)
  await fakeScreen(a.page)
  const screenBefore = await rectOf(a.page, 'Compartilhar tela')
  await a.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).click({ force: true })
  await a.page.locator('.modal').waitFor()
  await a.page.waitForTimeout(300)
  await shot(a, '3-compartilhar')
  await a.page.locator('.segmented button', { hasText: full ? '1440p' : '720p' }).click({ force: true })
  const audioBox = a.page.locator('.modal input[type=checkbox]')
  if ((await audioBox.isChecked()) !== withAudio) await audioBox.click({ force: true })
  await a.page.locator('.modal').getByRole('button', { name: 'Compartilhar', exact: true }).click({ force: true })
  const live = b.page.locator('button.live')
  await live.waitFor({ timeout: 10_000 })
  await live.click({ force: true })
  await b.page.waitForFunction(() => document.querySelector('.stream video')?.videoWidth > 0, null, { timeout: 15_000 })
  check(true, 'B recebeu o vídeo da tela de A')

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
  await b.page.waitForFunction(() => document.querySelector('.stats')?.textContent?.includes('H264'), null, { timeout: 20_000 })
    .then(() => check(true, 'codec trocou pra H264 ao vivo'))
    .catch(() => check(false, 'codec trocou pra H264 ao vivo', 'continuou o mesmo'))
  await b.page.waitForFunction(() => document.querySelector('.stream video')?.videoWidth > 1280, null, { timeout: 30_000 })
    .then(() => check(true, 'resolução subiu de 720p pra 1080p ao vivo'))
    .catch(() => check(false, 'resolução subiu de 720p pra 1080p ao vivo'))
  console.log('   estatísticas em B depois da troca:', (await b.page.locator('.stats').innerText()).replace(/\n/g, ' | '))

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
  for (const page of ['Minha conta', 'Voz e vídeo', 'Notificações', 'Atalhos', 'Aplicativo', 'Grupo']) {
    await a.page.locator('.settings-nav button', { hasText: page }).click({ force: true })
    tops.push(await positions())
    await shot(a, `6-configuracoes-${page.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[̀-ͯ]/g, '')}`)
  }
  check(new Set(tops).size === 1, 'navegação e título das configurações ficam no mesmo lugar em todas as páginas', tops.join(','))
  await a.page.locator('.settings-nav button', { hasText: 'Aplicativo' }).click({ force: true })
  await shot(a, '7-configuracoes-app')
  await a.page.keyboard.press('Escape')

  // Parar de compartilhar some com o player de B.
  await livePanel()
  await a.page.locator('.share-panel').getByRole('button', { name: 'Parar', exact: true }).click({ force: true })
  await b.page.locator('.stream').waitFor({ state: 'detached', timeout: 5000 })
  check(true, 'parar de compartilhar fecha o player de B')
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
  }
} catch (err) {
  failures++
  console.error('✘ falhou:', err)
  for (const [name, side] of [['A', a], ['B', b]]) {
    console.error(`   tela de ${name}:`, (await side.page.locator('body').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 600))
  }
} finally {
  await a.app.close()
  await b.app.close()
}

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.')
process.exit(failures ? 1 : 0)
