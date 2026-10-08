// Rabiscos de quem assiste, por cima do monitor de quem compartilha.
//
// No Linux com Wayland (Hyprland, KDE) quem desenha é um ajudante pequeno
// (resources/ink-overlay.py, GTK4 + gtk4-layer-shell): uma camada transparente
// por cima de tudo, até de jogo em tela cheia, que não pega clique. O Electron
// não consegue criar essa camada sozinho. No Windows e no X11 é uma janela
// transparente do próprio Electron, sempre por cima e sem pegar clique.
//
// Como a camada está no monitor transmitido, quem assiste vê os rabiscos na
// própria transmissão. RESENHA_INK_DRY=1 (e2e): não abre nada, só registra.

import { BrowserWindow, app, screen } from 'electron'
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { InkMonitor } from '../preload/api'

const dry = process.env.RESENHA_INK_DRY === '1'
const wayland = process.platform === 'linux' && !!process.env.WAYLAND_DISPLAY
const LAYER_SHELL = ['/usr/lib/libgtk4-layer-shell.so', '/usr/lib64/libgtk4-layer-shell.so', '/usr/lib/x86_64-linux-gnu/libgtk4-layer-shell.so.0']

/** Só no e2e: o que chegou pra camada (o teste confere por aqui). */
const dryLog: { started: string | null; events: unknown[] } = { started: null, events: [] }
if (dry) (globalThis as Record<string, unknown>).__resenhaInk = dryLog

let helper: ChildProcessWithoutNullStreams | null = null
let overlay: BrowserWindow | null = null
/** Esconde a janela transparente quando os rabiscos acabam (a caneta dura 6,8 s depois de soltar). */
let overlayIdle: ReturnType<typeof setTimeout> | null = null
const OVERLAY_LINGER = 8000
let closed: () => void = () => {}

/** Chamado quando a camada fecha sozinha (o ajudante caiu), pra parar de oferecer os rabiscos. */
export function onInkClosed(callback: () => void) {
  closed = callback
}

function helperPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'ink-overlay.py') : join(__dirname, '../../resources/ink-overlay.py')
}

function helperEnv(): NodeJS.ProcessEnv {
  const preload = LAYER_SHELL.find((p) => existsSync(p))
  return { ...process.env, GDK_BACKEND: 'wayland', ...(preload ? { LD_PRELOAD: preload } : {}) }
}

/** Monitores onde dá pra desenhar (null: não tem como desenhar neste sistema). */
export async function inkMonitors(): Promise<InkMonitor[] | null> {
  // Dois monitores iguais (como os do Lucas): o app tem que achar o certo pelo quadradinho.
  if (dry)
    return [
      { connector: 'TESTE-1', name: 'Monitor de teste', x: 0, y: 0, width: 2560, height: 1440 },
      { connector: 'TESTE-2', name: 'Monitor de teste', x: 2560, y: 0, width: 2560, height: 1440 },
    ]
  if (wayland) {
    if (!existsSync(helperPath())) return null
    return new Promise((resolve) => {
      execFile('python3', [helperPath(), '--list'], { env: helperEnv(), timeout: 8000 }, (err, stdout) => {
        if (err) {
          console.error('rabiscos: não deu pra listar os monitores', err.message)
          return resolve(null)
        }
        try {
          const list = JSON.parse(stdout) as InkMonitor[]
          resolve(Array.isArray(list) && list.length > 0 ? list : null)
        } catch {
          resolve(null)
        }
      })
    })
  }
  return screen.getAllDisplays().map((d, i) => ({
    connector: String(d.id),
    name: d.label || `Monitor ${i + 1}`,
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
  }))
}

/** Abre a camada nesse monitor. Resolve quando ela está pronta (ou com o motivo de não ter aberto). */
export function inkStart(connector: string): Promise<{ ok: true } | { ok: false; error: string }> {
  inkStop()
  if (dry) {
    dryLog.started = connector
    return Promise.resolve({ ok: true })
  }
  if (wayland) return startHelper(connector)
  return startWindow(connector)
}

function startHelper(connector: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn('python3', [helperPath(), connector], { env: helperEnv(), stdio: 'pipe' })
    } catch (err) {
      return resolve({ ok: false, error: (err as Error).message })
    }
    helper = child
    let settled = false
    const finish = (result: { ok: true } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!result.ok && helper === child) {
        helper = null
        child.kill()
      }
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), 8000)
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      for (const line of out.split('\n').slice(0, -1)) {
        try {
          const msg = JSON.parse(line) as { ready?: string; error?: string }
          if (msg.ready) finish({ ok: true })
          if (msg.error) finish({ ok: false, error: msg.error })
        } catch {
          // linha que não é do protocolo
        }
      }
      out = out.slice(out.lastIndexOf('\n') + 1)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      if (/Error|Traceback|cannot|not found/i.test(text)) console.error('rabiscos:', text.trim().slice(0, 400))
    })
    child.on('error', (err) => finish({ ok: false, error: err.message }))
    child.on('exit', (code) => {
      const unexpected = helper === child && settled
      if (helper === child) helper = null
      finish({ ok: false, error: code === 0 ? 'closed' : `exit ${code}` })
      if (unexpected) {
        console.error('rabiscos: a camada fechou sozinha', code)
        closed()
      }
    })
    child.stdin.on('error', () => {})
  })
}

/** Windows e X11: janela transparente do Electron, sempre por cima, sem pegar clique. */
function startWindow(connector: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const display = screen.getAllDisplays().find((d) => String(d.id) === connector)
  if (!display) return Promise.resolve({ ok: false, error: 'monitor' })
  const win = new BrowserWindow({
    ...display.bounds,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  overlay = win
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  // Pronta só depois de carregar a página: antes disso, o que chega pra ela se perde.
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 8000)
    // Fica escondida até chegar rabisco: janela por cima do jogo, mesmo transparente,
    // tira o jogo do modo de tela cheia exclusiva e custa desempenho.
    win.once('ready-to-show', () => {
      clearTimeout(timer)
      resolve(win.isDestroyed() ? { ok: false, error: 'closed' } : { ok: true })
    })
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_PAGE)}`).catch(() => {})
  })
}

export function inkEvent(event: unknown) {
  if (dry) {
    if (dryLog.started) dryLog.events.push(event)
    return
  }
  const line = JSON.stringify(event)
  if (helper) helper.stdin.write(`${line}\n`)
  else if (overlay && !overlay.isDestroyed()) {
    const win = overlay
    const kind = (event as { t?: string; on?: boolean }).t
    const done = kind === 'clear' || (kind === 'probe' && (event as { on?: boolean }).on !== true)
    if (!done && !win.isVisible()) win.showInactive()
    win.webContents.executeJavaScript(`window.ink(${line})`).catch(() => {})
    if (overlayIdle) clearTimeout(overlayIdle)
    // Quadradinho de teste: fica até desligar. O resto some sozinho; depois disso, esconde.
    overlayIdle = kind === 'probe' && !done ? null : setTimeout(() => win.isDestroyed() || win.hide(), done ? 300 : OVERLAY_LINGER)
  }
}

export function inkStop() {
  if (dry) {
    dryLog.started = null
    return
  }
  if (helper) {
    const child = helper
    helper = null
    try {
      child.stdin.end(`${JSON.stringify({ t: 'quit' })}\n`)
    } catch {
      // já saiu
    }
    setTimeout(() => child.kill(), 1500).unref?.()
  }
  if (overlayIdle) clearTimeout(overlayIdle)
  overlayIdle = null
  if (overlay && !overlay.isDestroyed()) overlay.destroy()
  overlay = null
}

/** A página da janela transparente (Windows/X11): o mesmo desenho do ajudante do Linux, em canvas. */
const OVERLAY_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>html,body{margin:0;background:transparent;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style></head>
<body><canvas></canvas><script>
const PEN_LIFE = 6, PEN_FADE = 0.8, LASER = 0.7, PING = 0.9, NAME = 1.6
const canvas = document.querySelector('canvas'), cr = canvas.getContext('2d')
const strokes = new Map(); let pings = []; let frame = 0; let probe = false
const now = () => performance.now() / 1000
const clamp = (v) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : null)
function resize() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio }
addEventListener('resize', resize); resize()
window.ink = (e) => {
  const t = now()
  if (e.t === 'stroke') {
    const id = String(e.id || '').slice(0, 40)
    let s = strokes.get(id)
    if (!s) { s = { tool: e.tool === 'laser' ? 'laser' : 'pen', color: String(e.color || '#ada4ff').slice(0, 9), name: String(e.name || '').slice(0, 40), author: String(e.author || ''), points: [], ended: null, updated: t }; strokes.set(id, s) }
    const flat = Array.isArray(e.points) ? e.points.slice(0, 800) : []
    for (let i = 0; i + 1 < flat.length; i += 2) { const x = clamp(flat[i]), y = clamp(flat[i + 1]); if (x !== null && y !== null && s.points.length < 4000) s.points.push([x, y, t]) }
    s.updated = t; if (e.end) s.ended = t
  } else if (e.t === 'ping') {
    const x = clamp(e.x), y = clamp(e.y)
    if (x !== null && y !== null) pings = [...pings.slice(-49), { x, y, at: t, color: String(e.color || '#ada4ff').slice(0, 9), name: String(e.name || '').slice(0, 40) }]
  } else if (e.t === 'probe') {
    probe = e.on === true
  } else if (e.t === 'clear') {
    if (e.author) { for (const [k, s] of strokes) if (s.author === e.author) strokes.delete(k) } else { strokes.clear(); pings = [] }
  }
  if (!frame) frame = requestAnimationFrame(draw)
}
function label(name, color, x, y, u, a) {
  if (!name || a <= 0) return
  cr.font = 'bold ' + 13 * u + 'px sans-serif'; const w = cr.measureText(name).width + 14 * u, h = 21 * u
  cr.globalAlpha = 0.95 * a; cr.fillStyle = color; cr.beginPath(); cr.roundRect(x + 12 * u, y + 12 * u, w, h, h / 2); cr.fill()
  cr.globalAlpha = 0.9 * a; cr.fillStyle = '#0d0b17'; cr.fillText(name, x + 19 * u, y + 27 * u); cr.globalAlpha = 1
}
function draw() {
  frame = 0
  const t = now(), W = canvas.width, H = canvas.height, u = Math.max(1, Math.min(W, H) / 1080)
  cr.clearRect(0, 0, W, H); cr.lineCap = 'round'; cr.lineJoin = 'round'
  if (probe) { cr.fillStyle = '#ff00ff'; cr.fillRect(0, 0, 48 * devicePixelRatio, 48 * devicePixelRatio) }
  for (const [k, s] of strokes) {
    if (s.tool === 'laser') {
      if ((s.ended !== null && t - s.ended > LASER) || t - s.updated > 5) { strokes.delete(k); continue }
      const live = s.points.filter((p) => t - p[2] < LASER)
      for (let i = 1; i < live.length; i++) {
        const f = Math.max(0, 1 - (t - live[i][2]) / LASER)
        for (const [w, a] of [[14, 0.18], [5.5, 0.95]]) { cr.globalAlpha = a * f; cr.strokeStyle = s.color; cr.lineWidth = w * u * (0.4 + 0.6 * f); cr.beginPath(); cr.moveTo(live[i - 1][0] * W, live[i - 1][1] * H); cr.lineTo(live[i][0] * W, live[i][1] * H); cr.stroke() }
      }
    } else {
      const last = s.ended ?? s.updated
      if (t - last > PEN_LIFE + PEN_FADE + (s.ended === null ? 30 : 0)) { strokes.delete(k); continue }
      const a = s.ended !== null && t - s.ended > PEN_LIFE ? Math.max(0, 1 - (t - s.ended - PEN_LIFE) / PEN_FADE) : 1
      for (const [w, c, ca] of [[8, '#000', 0.45], [4.8, s.color, 1]]) { cr.globalAlpha = ca * a; cr.strokeStyle = c; cr.lineWidth = w * u; cr.beginPath(); s.points.forEach((p, i) => (i ? cr.lineTo(p[0] * W, p[1] * H) : cr.moveTo(p[0] * W, p[1] * H))); cr.stroke() }
    }
    cr.globalAlpha = 1
    // Nome parado no começo do traço (como no ink-overlay.py).
    const p = s.points[0]
    if (p && t - s.updated < NAME) label(s.name, s.color, p[0] * W, p[1] * H, u, 1)
  }
  pings = pings.filter((p) => t - p.at < PING)
  for (const p of pings) {
    const k = (t - p.at) / PING, x = p.x * W, y = p.y * H
    cr.globalAlpha = Math.max(0, 1 - k); cr.strokeStyle = p.color; cr.lineWidth = 4 * u; cr.beginPath(); cr.arc(x, y, (10 + 70 * (1 - (1 - k) ** 3)) * u, 0, 7); cr.stroke()
    cr.fillStyle = p.color; cr.beginPath(); cr.arc(x, y, 7 * u, 0, 7); cr.fill(); cr.globalAlpha = 1
    label(p.name, p.color, x + 6 * u, y - 40 * u, u, Math.max(0, 1 - k))
  }
  if (strokes.size || pings.length || probe) frame = requestAnimationFrame(draw)
}
</script></body></html>`
