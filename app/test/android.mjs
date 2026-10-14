// Teste do app de Android num emulador (ou celular ligado pelo adb), contra o servidor local
// de teste. Builda a interface apontando pro servidor (pelo `adb reverse`, o 127.0.0.1 do
// aparelho é o do PC), gera o APK de teste (depurável, aceita http), instala, abre e mexe
// na interface pelo depurador do WebView (o modo Android do Playwright, pelo adb).
//
// Precisa do SDK do Android e de um aparelho no `adb devices` (o emulador sobe à parte).
// Ferramentas: RESENHA_ANDROID_HOME (padrão ~/.local/share/resenha-android, com jdk/ e sdk/).
//   RESENHA_SHOTS=pasta          capturas da tela do aparelho (com as barras do sistema)
//   RESENHA_ANDROID_SKIP_BUILD=1 usa o APK que já está instalado
//
// Uso: npm -w app run test:android

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { _android as android } from 'playwright-core'
import { startServer } from './local-server.mjs'

const ROOT = new URL('../..', import.meta.url).pathname
const MOBILE = join(ROOT, 'mobile')
const PACKAGE = 'com.lucasreis.resenha'
const PORT = Number(process.env.RESENHA_ANDROID_PORT ?? 8798)
const SERVER = `http://127.0.0.1:${PORT}`
const PASSWORD = 'senha-de-teste-1'
const SHOTS = process.env.RESENHA_SHOTS
const TOOLS = process.env.RESENHA_ANDROID_HOME ?? join(homedir(), '.local/share/resenha-android')

const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME ?? join(TOOLS, 'jdk'),
  ANDROID_HOME: process.env.ANDROID_HOME ?? join(TOOLS, 'sdk'),
  PATH: `${join(TOOLS, 'jdk/bin')}:${join(TOOLS, 'sdk/platform-tools')}:${process.env.PATH}`,
}

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { env, stdio: 'inherit', ...options })
const adb = (...args) => execFileSync('adb', args, { env, encoding: 'utf8' }).trim()

let failures = 0
function check(ok, label, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/** O aparelho no Playwright (captura da tela, teclas do sistema). */
let device = null

/** Captura da tela do aparelho (o que a pessoa vê, com as barras do sistema). */
async function shot(page, name) {
  if (!SHOTS) return
  await page.waitForTimeout(400)
  writeFileSync(join(SHOTS, `${name}.png`), await device.screenshot())
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
        resolve(msg.invite.code)
      }
    }
  })
}

/** Microfone e câmera de mentira (o emulador não tem, e o do PC não pode entrar no teste). */
function installFakeMedia() {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  gain.gain.value = 0
  const dest = ctx.createMediaStreamDestination()
  osc.connect(gain).connect(dest)
  osc.start()
  const cam = document.createElement('canvas')
  cam.width = 480
  cam.height = 640
  const g = cam.getContext('2d')
  let t = 0
  setInterval(() => {
    g.fillStyle = `hsl(${(t += 4) % 360} 60% 45%)`
    g.fillRect(0, 0, 480, 640)
  }, 33)
  const camStream = cam.captureStream(30)
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (constraints?.video) {
      window.__facing = constraints.video.facingMode?.ideal ?? null
      return new MediaStream([camStream.getVideoTracks()[0].clone()])
    }
    return new MediaStream([dest.stream.getAudioTracks()[0].clone()])
  }
}

/** Aperta o voltar do Android. */
async function back(page) {
  await device.shell('input keyevent KEYCODE_BACK')
  await page.waitForTimeout(500)
}

/** Botão da barra lateral pelo nome exato (canal de texto "geral" ≠ voz "Geral"). */
function channel(page, name) {
  return page.locator('nav button.channel').filter({ hasText: new RegExp(`^\\s*${name}\\s*\\d*\\s*$`) }).first()
}

/** Toca num texto da interface do sistema (gaveta de notificações), achado pelo uiautomator. */
async function tapSystem(page, text) {
  for (let i = 0; i < 10; i++) {
    adb('shell', 'uiautomator', 'dump', '/sdcard/resenha-ui.xml')
    const xml = adb('shell', 'cat', '/sdcard/resenha-ui.xml')
    const node = xml.match(new RegExp(`text="${text}"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i'))
    if (node) {
      const [x1, y1, x2, y2] = node.slice(1).map(Number)
      adb('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1))
      return true
    }
    await page.waitForTimeout(500)
  }
  return false
}

/** O serviço da call (notificação fixa) está rodando em primeiro plano? */
const callService = () => adb('shell', 'dumpsys', 'activity', 'services', `${PACKAGE}/.CallService`).includes('isForeground=true')

const pane = (page) => page.evaluate(() => (document.querySelector('.shell.main-open') ? 'main' : 'nav'))

// ---------------------------------------------------------------------------

if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const devices = adb('devices').split('\n').slice(1).filter((l) => l.endsWith('\tdevice'))
if (!devices.length) throw new Error('nenhum aparelho no adb (suba o emulador antes)')

if (process.env.RESENHA_ANDROID_SKIP_BUILD !== '1') {
  run('npm', ['-w', 'app', 'run', 'build:mobile'], { cwd: ROOT, env: { ...env, VITE_DEFAULT_SERVER: SERVER } })
  run('npx', ['cap', 'sync', 'android'], { cwd: MOBILE, env: { ...env, RESENHA_ANDROID_DEBUG: '1' } })
  run('./gradlew', ['assembleDebug', '--no-daemon', '-q'], { cwd: join(MOBILE, 'android') })
  adb('install', '-r', join(MOBILE, 'android/app/build/outputs/apk/debug/app-debug.apk'))
}

const server = await startServer(PORT)
try {
  const owner = await api('/api/register', { username: 'lucas', name: 'Lucas', password: PASSWORD })
  const guild = await api('/api/guilds', { name: 'Turma' }, owner.token)
  const code = await inviteFor(guild.id, owner.token)
  const duarte = await api('/api/register', { username: 'duarte', name: 'Duarte', password: PASSWORD, invite: code })
  await api('/api/friends', { username: 'lucas' }, duarte.token)
  await api(`/api/friends/${duarte.user.id}/accept`, {}, owner.token)
  check(true, 'contas, servidor e amizade criados pela API')

  // App limpo, com as permissões já dadas (o diálogo do sistema não é da interface).
  adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`)
  adb('shell', 'pm', 'clear', PACKAGE)
  for (const permission of ['RECORD_AUDIO', 'CAMERA', 'POST_NOTIFICATIONS']) adb('shell', 'pm', 'grant', PACKAGE, `android.permission.${permission}`)
  adb('shell', 'am', 'start', '-W', '-n', `${PACKAGE}/.MainActivity`)
  ;[device] = await android.devices()
  const page = await (await device.webView({ pkg: PACKAGE }, { timeout: 20_000 })).page()
  // Em português (o e2e procura os textos do catálogo pt), qualquer que seja a língua do aparelho.
  await page.evaluate(() => localStorage.setItem('resenha.settings', JSON.stringify({ language: 'pt' })))
  await page.reload()
  await page.evaluate(installFakeMedia)

  // ---------- Entrar ----------
  await page.getByLabel('Nome de usuário').waitFor({ timeout: 20_000 })
  const toLogin = page.getByRole('tab', { name: 'Entrar', exact: true })
  if ((await toLogin.getAttribute('aria-selected')) !== 'true') await toLogin.click()
  await page.getByLabel('Nome de usuário').fill('lucas')
  await page.getByLabel('Senha').fill(PASSWORD)
  await shot(page, '0-entrar')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.shell[data-status=open]').waitFor({ timeout: 20_000 })
  check((await page.locator('.shell.compact').count()) === 1, 'celular abre no layout de uma tela só')
  check((await pane(page)) === 'nav', 'abre na lista (trilho e conversas)')
  await shot(page, '1-inicio')

  // ---------- Amigos e conversa privada ----------
  await page.locator('aside.sidebar').getByRole('button', { name: /Amigos/ }).first().click()
  await page.getByRole('heading', { name: 'Amigos' }).waitFor({ timeout: 5000 })
  check((await pane(page)) === 'main', 'tocar em Amigos mostra o conteúdo')
  await page.getByRole('tab', { name: /Todos/ }).click()
  await shot(page, '2-amigos')
  await back(page)
  check((await pane(page)) === 'nav', 'o voltar do Android volta pra lista')

  await page.locator('aside.sidebar').getByRole('button', { name: /Amigos/ }).first().click()
  await page.getByRole('tab', { name: /Todos/ }).click()
  await page.getByRole('button', { name: 'Mensagem', exact: true }).first().click()
  const composer = page.getByPlaceholder('Mensagem pra Duarte')
  await composer.waitFor({ timeout: 5000 })
  await composer.fill('oi do celular')
  // No celular, o Enter do teclado pula linha: quem envia é o botão.
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await page.locator('.scroller').getByText('oi do celular').waitFor({ timeout: 5000 })
  check(true, 'conversa privada: o botão de enviar manda a mensagem')
  await page.getByRole('button', { name: 'Perfil', exact: true }).click()
  await page.locator('.aside.drawer').waitFor({ timeout: 3000 })
  await shot(page, '3-perfil-na-conversa')
  await back(page)
  check((await page.locator('.aside.drawer').count()) === 0, 'o voltar fecha a gaveta do perfil antes de sair da conversa')
  check((await pane(page)) === 'main', 'continua na conversa depois de fechar a gaveta')
  await shot(page, '4-conversa')
  await back(page)

  // ---------- Servidor: lista de canais, chat, membros ----------
  await page.getByRole('button', { name: 'Turma', exact: true }).click()
  await channel(page, 'geral').waitFor({ timeout: 10_000 })
  check((await pane(page)) === 'nav', 'tocar no servidor mostra os canais (fica na lista)')
  await shot(page, '5-canais')
  await channel(page, 'geral').click()
  const chat = page.getByPlaceholder(/Conversar em #geral|Mensagem em #geral/)
  await chat.waitFor({ timeout: 5000 })
  check((await pane(page)) === 'main', 'tocar no canal abre o chat')
  await chat.fill('mensagem no canal')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await page.locator('.scroller').getByText('mensagem no canal').waitFor({ timeout: 5000 })
  await shot(page, '6-chat')
  await page.getByRole('button', { name: 'Membros', exact: true }).click()
  await page.locator('.aside.drawer').waitFor({ timeout: 3000 })
  await shot(page, '7-membros')
  await back(page)
  await page.getByRole('button', { name: 'Voltar', exact: true }).first().click()
  check((await pane(page)) === 'nav', 'a setinha do cabeçalho volta pra lista')

  // ---------- Call ----------
  await channel(page, 'Geral').click()
  await page.locator('.dock .call').waitFor({ timeout: 10_000 })
  await page.waitForFunction(() => !document.querySelector('.dock .call .call-info:disabled'), null, { timeout: 15_000 })
  check((await pane(page)) === 'nav', 'entrar na sala de voz fica na lista, com a call no painel de baixo')
  await page.waitForTimeout(500)
  check(callService(), 'na call, o serviço em primeiro plano segura o microfone (notificação "Na call")')
  await shot(page, '8-na-call')
  // O botão "Mutar" da notificação muta a call (e a notificação passa a oferecer "Desmutar").
  adb('shell', 'cmd', 'statusbar', 'expand-notifications')
  await page.waitForTimeout(800)
  if (SHOTS) writeFileSync(join(SHOTS, '8b-notificacao.png'), await device.screenshot())
  const tapped = await tapSystem(page, 'Mutar')
  const muted = tapped && (await page.waitForFunction(() => document.querySelector('.dock [aria-label="Desmutar"]'), null, { timeout: 5000 }).then(() => true, () => false))
  check(muted, '"Mutar" na notificação da call muta', tapped ? '' : 'botão não achado')
  if (muted) {
    await tapSystem(page, 'Desmutar')
    await page.waitForFunction(() => document.querySelector('.dock [aria-label="Mutar"]'), null, { timeout: 5000 }).catch(() => {})
  }
  adb('shell', 'cmd', 'statusbar', 'collapse')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Abrir a call', exact: false }).first().click()
  await page.locator('section .controls').waitFor({ timeout: 5000 })
  check((await pane(page)) === 'main', 'abrir a call mostra a tela da call')
  await page.locator('section .controls').getByRole('button', { name: 'Ligar câmera' }).click()
  await page.locator('section .controls').getByRole('button', { name: 'Virar a câmera' }).waitFor({ timeout: 5000 })
  const facing = await page.evaluate(() => window.__facing)
  check(facing === 'user', 'a câmera liga pela da frente, sem perguntar qual', String(facing))
  await page.locator('section .controls').getByRole('button', { name: 'Virar a câmera' }).click()
  await page.waitForTimeout(500)
  check((await page.evaluate(() => window.__facing)) === 'environment', 'virar a câmera troca pra de trás')
  await shot(page, '9-call')
  await page.locator('section .controls').getByRole('button', { name: 'Sair da call' }).click()
  await page.locator('.dock .call').waitFor({ state: 'detached', timeout: 5000 })
  check(true, 'sair da call pelos botões da tela da call')
  await page.waitForTimeout(500)
  check(!callService(), 'fora da call, o serviço e a notificação somem')

  // ---------- Configurações ----------
  // Saiu da call pela tela da call: fica no chat; o painel de baixo está na lista.
  await back(page)
  await page.locator('.dock').getByRole('button', { name: 'Configurações', exact: true }).click()
  await page.locator('.settings.compact').waitFor({ timeout: 5000 })
  check((await page.locator('.settings.compact .panel').isVisible()) === false, 'configurações abrem na lista de páginas')
  check((await page.locator('.settings-nav').getByText('Atalhos').count()) === 0, 'sem a página de atalhos no celular')
  await shot(page, '10-configuracoes')
  await page.locator('.settings-nav').getByRole('button', { name: 'Voz e vídeo' }).click()
  check(await page.locator('.settings.compact .panel').isVisible(), 'tocar numa página abre ela inteira')
  check((await page.getByText('Saída', { exact: true }).count()) === 0, 'sem escolher a saída do som no celular')
  await shot(page, '11-voz')
  await back(page)
  check(await page.locator('.settings-nav').isVisible(), 'o voltar da página volta pra lista das configurações')
  await back(page)
  check((await page.locator('.settings').count()) === 0, 'o voltar da lista fecha as configurações')
} finally {
  await device?.close().catch(() => {})
  try {
    adb('reverse', '--remove', `tcp:${PORT}`)
  } catch {
    // aparelho saiu
  }
  server.stop()
}

console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo')
process.exit(failures ? 1 : 0)
