import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  Menu,
  safeStorage,
  session,
  shell,
  type Streams,
} from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { dirname, join } from 'node:path'
import type { CallState, CaptureSource, DesktopPrefs, PlatformInfo, SavedSession, ShortcutAction } from '../preload/api'
import { appIcon, hasTray, registerShortcuts, setAutostart, setTray, showCallState } from './desktop'
import { inkEvent, inkMonitors, inkStart, inkStop, onInkClosed } from './ink'
import { isHyprland, loadPrefs, savePrefs } from './prefs'
import {
  listPlayingApps,
  screenAudioAvailable,
  startScreenAudio,
  stopScreenAudio,
  unmuteScreenAudio,
  type ScreenAudioOptions,
} from './screen-audio-linux'
import { checkForUpdates, downloadUpdate, installUpdate, setUpdaterCall, setupUpdater, updateState } from './updater'

// RESENHA_PROFILE=b roda uma segunda instância com outra conta no mesmo PC.
const profile = process.env.RESENHA_PROFILE
if (profile) app.setPath('userData', join(app.getPath('appData'), `resenha-${profile}`))

const isLinux = process.platform === 'linux'
const isWindows = process.platform === 'win32'
const portalPicker = isLinux && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)
// Captura do sistema sem o próprio processo (WASAPI process loopback). Na
// prática funciona a partir do Windows 10 22H2 (build 19045), igual o Vesktop.
const windowsBuild = isWindows ? Number(release().split('.')[2] ?? 0) : 0
const windowsExcludesSelf = windowsBuild >= 19045

app.commandLine.appendSwitch(
  'disable-features',
  [
    // A call não aparece como player de mídia (MPRIS) nem obedece play/pause.
    'HardwareMediaKeyHandling',
    'MediaSessionService',
    // O controle de ganho do WebRTC não mexe no volume do microfone do sistema.
    'WebRtcAllowInputVolumeAdjustment',
    // Mostra os IPs reais nos candidatos ICE em vez de nomes .local: mais
    // chance de conexão direta (IPv6, mesma rede). Entre amigos, tudo bem.
    'WebRtcHideLocalIpsWithMdns',
  ].join(','),
)
// No Wayland os atalhos globais passam pelo portal do desktop (KDE, GNOME, Hyprland).
if (isLinux) app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,GlobalShortcutsPortal')
if (isWindows) app.setAppUserModelId('com.lucasreis.resenha')
// Login salvo criptografado pelo chaveiro do sistema. KDE e GNOME o Chromium acha
// sozinho; nos outros (Hyprland, Sway...) ele cairia em texto puro, então aponta
// pro Secret Service (gnome-keyring, KeePassXC...).
if (isLinux && !/kde|gnome|unity|xfce|cinnamon|mate|deepin/i.test(process.env.XDG_CURRENT_DESKTOP ?? '')) {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
}

const ACTIONS: ShortcutAction[] = ['toggle-mute', 'toggle-deafen', 'toggle-share', 'leave-call', 'show-window']

/** `resenha --action=toggle-mute`: dá pra ligar num atalho do Hyprland ou de qualquer lugar. */
function actionFromArgs(argv: string[]): ShortcutAction | null {
  const arg = argv.find((a) => a.startsWith('--action='))?.slice('--action='.length)
  return ACTIONS.includes(arg as ShortcutAction) ? (arg as ShortcutAction) : null
}

if (!app.requestSingleInstanceLock()) app.quit()

// ---------- Links resenha:// (convites) ----------

/** `resenha://invite/<código>`: o único link que o app aceita de fora. */
function inviteFromArgs(argv: string[]): string | null {
  for (const arg of argv) {
    const match = /^resenha:\/\/invite\/([\w-]{4,32})\/?$/i.exec(arg.trim())
    if (match) return match[1]
  }
  return null
}

let pendingInvite: string | null = inviteFromArgs(process.argv)

function deliverInvite(code: string) {
  pendingInvite = code
  win?.webContents.send('invite', code)
}

// Em teste (perfil separado) não registra, pra não tomar o lugar do app instalado.
if (!profile) {
  if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient('resenha', process.execPath, [join(process.cwd(), process.argv[1])])
  else app.setAsDefaultProtocolClient('resenha')
}

let win: BrowserWindow | null = null
let quitting = false
let prefs: DesktopPrefs
const hidden = process.env.RESENHA_HIDDEN === '1'
/** Aberto pelo início automático do sistema: fica quietinho na bandeja. */
const startedHidden = process.argv.includes('--hidden')

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function dispatch(action: ShortcutAction) {
  if (action === 'show-window') return showWindow()
  win?.webContents.send('action', action)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 560,
    title: 'Resenha',
    backgroundColor: '#17181c',
    autoHideMenuBar: true,
    show: false,
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      // Voz e tela continuam rodando liso com a janela escondida ou em outro workspace.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: true,
      // Testes automáticos: renderiza fora da tela, sem abrir janela no desktop.
      offscreen: hidden,
    },
  })

  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  // Recarregou: a camada dos rabiscos era da transmissão de antes.
  win.webContents.on('did-start-loading', () => inkStop())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) event.preventDefault()
  })
  win.on('focus', () => win?.flashFrame(false))
  win.once('ready-to-show', () => {
    if (hidden) return
    if (startedHidden && prefs.startHidden) {
      // Sem bandeja não tem como reabrir uma janela escondida: só minimiza.
      if (!hasTray()) win?.minimize()
      return
    }
    win?.show()
  })
  // Fechar a janela com a bandeja ligada só esconde; a call continua.
  win.on('close', (event) => {
    if (quitting || !hasTray() || !prefs.closeToTray) return
    event.preventDefault()
    win?.hide()
  })
  win.webContents.on('did-finish-load', () => win?.webContents.setZoomFactor(prefs.zoom))
  // Sem menu de aplicativo (evita Ctrl+W/Ctrl+R por engano); DevTools no F12.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win?.webContents.toggleDevTools()
      event.preventDefault()
    }
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('renderer caiu:', details.reason, details.exitCode)
    if (details.reason !== 'clean-exit') win?.webContents.reload()
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// ---------- IPC: só a janela do próprio app fala com o processo principal ----------

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  const dev = process.env.ELECTRON_RENDERER_URL
  return !!win && event.sender === win.webContents && (url.startsWith('file://') || (!!dev && url.startsWith(dev)))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Origem não autorizada')
    return fn(event, ...args)
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function listen(channel: string, fn: (event: IpcMainEvent, ...args: any[]) => void) {
  ipcMain.on(channel, (event, ...args) => {
    if (trusted(event)) fn(event, ...args)
  })
}

// ---------- Compartilhamento de tela ----------

let pendingShare: { sourceId: string | null; audio: boolean } | null = null

function setupDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const choice = pendingShare
    pendingShare = null
    try {
      // No Wayland essa chamada abre o seletor do portal e volta só com a escolhida.
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      const video = portalPicker ? sources[0] : sources.find((s) => s.id === choice?.sourceId)
      if (!video) return callback({})

      const streams: Streams = { video }
      if (isWindows && request.audioRequested && choice?.audio) {
        // 'loopbackWithoutChrome' ainda não está nos tipos do Electron.
        streams.audio = (windowsExcludesSelf ? 'loopbackWithoutChrome' : 'loopback') as Streams['audio']
      }
      callback(streams)
    } catch (err) {
      console.error('getDisplayMedia: falhou ao listar fontes', err)
      callback({})
    }
  })
}

handle('share:sources', async (): Promise<CaptureSource[]> => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 384, height: 216 },
  })
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
  }))
})

handle('share:select', (_event, choice: { sourceId: string | null; audio: boolean }) => {
  pendingShare = choice
})

handle('ink:monitors', () => inkMonitors())
handle('ink:start', (_event, connector: unknown) => inkStart(String(connector)))
listen('ink:event', (_event, event: unknown) => {
  if (event && typeof event === 'object') inkEvent(event)
})
listen('ink:stop', () => inkStop())
onInkClosed(() => win?.webContents.send('ink:closed'))

handle('screen-audio:apps', () => listPlayingApps())
handle('screen-audio:start', (_event, options: ScreenAudioOptions) => startScreenAudio(options))
handle('screen-audio:unmute', () => unmuteScreenAudio())
handle('screen-audio:stop', () => stopScreenAudio())

handle('platform:info', (): PlatformInfo => {
  let screenAudio: PlatformInfo['screenAudio'] = 'none'
  if (isLinux && screenAudioAvailable()) screenAudio = 'venmic'
  else if (isWindows) screenAudio = windowsExcludesSelf ? 'exclude-self' : 'loopback-all'
  return { platform: process.platform, portalPicker, screenAudio, version: app.getVersion(), hyprland: isHyprland }
})

listen('attention', () => {
  if (win && !win.isFocused()) win.flashFrame(true)
})
listen('show-window', () => showWindow())

listen('download', (_event, url: string) => {
  if (/^https?:\/\//.test(url)) win?.webContents.downloadURL(url)
})

handle('invite:pending', () => {
  const code = pendingInvite
  pendingInvite = null
  return code
})

// ---------- Anti-robô do cadastro aberto (Turnstile) ----------

/**
 * Abre a página de verificação do servidor numa janelinha isolada (sem o
 * preload do app, sessão própria em memória) e devolve o token quando o
 * desafio passa. A página põe o token no título.
 */
handle('turnstile:verify', (_event, server: string): Promise<string | null> => {
  let origin: string
  try {
    const url = new URL(server)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return Promise.resolve(null)
    origin = url.origin
  } catch {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const popup = new BrowserWindow({
      parent: win ?? undefined,
      modal: !!win,
      width: 420,
      height: 520,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Verificação',
      backgroundColor: '#0d0e12',
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'turnstile' },
    })
    popup.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    popup.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`${origin}/verify`)) event.preventDefault()
    })
    let done = false
    popup.on('page-title-updated', (event, title) => {
      event.preventDefault()
      const match = /^resenha-turnstile:([\w.-]{10,4096})$/.exec(title)
      if (!match || done) return
      done = true
      resolve(match[1])
      popup.close()
    })
    popup.on('closed', () => {
      if (!done) resolve(null)
    })
    popup.loadURL(`${origin}/verify`)
  })
})

// ---------- Bandeja, atalhos, início automático, zoom ----------

function applyPrefs(previous: DesktopPrefs | null): ShortcutAction[] {
  setTray(prefs.tray, showWindow, dispatch)
  if (!previous || previous.autostart !== prefs.autostart) setAutostart(prefs.autostart)
  win?.webContents.setZoomFactor(prefs.zoom)
  return registerShortcuts(prefs.shortcuts, dispatch)
}

handle('desktop:get', () => prefs)

handle('desktop:set', (_event, patch: Partial<DesktopPrefs>) => {
  const previous = prefs
  prefs = { ...prefs, ...patch, shortcuts: { ...prefs.shortcuts, ...patch.shortcuts } }
  prefs.zoom = Math.min(2, Math.max(0.5, Number(prefs.zoom) || 1))
  savePrefs(prefs)
  return { prefs, failed: applyPrefs(previous) }
})

listen('call-state', (_event, state: CallState) => {
  showCallState(state, win, showWindow, dispatch)
  setUpdaterCall(state.inCall)
})

// Não lidas (menções e mensagens privadas) no ícone do app, onde o sistema mostra (KDE, GNOME com dock, macOS).
listen('unread', (_event, count: number) => {
  const value = Math.max(0, Math.min(999, Math.floor(Number(count) || 0)))
  app.setBadgeCount(value)
})

handle('update:state', () => updateState())
handle('update:check', () => checkForUpdates())
handle('update:download', () => downloadUpdate())
handle('update:install', () => installUpdate())

// ---------- Sessão salva (criptografada com o chaveiro do sistema quando dá) ----------

const sessionFile = () => join(app.getPath('userData'), 'session.json')

handle('session:get', (): SavedSession | null => {
  try {
    const saved = JSON.parse(readFileSync(sessionFile(), 'utf8')) as { encrypted: boolean; data: string }
    const raw = Buffer.from(saved.data, 'base64')
    const session = JSON.parse(saved.encrypted ? safeStorage.decryptString(raw) : raw.toString('utf8')) as SavedSession
    // Salvo em texto puro numa versão antiga e agora tem chaveiro: regrava criptografado.
    if (!saved.encrypted && safeStorage.isEncryptionAvailable()) writeSession(session)
    return session
  } catch {
    return null
  }
})

handle('session:set', (_event, value: SavedSession | null) => {
  if (!value) return rmSync(sessionFile(), { force: true })
  writeSession(value)
})

function writeSession(value: SavedSession) {
  const file = sessionFile()
  const encrypted = safeStorage.isEncryptionAvailable()
  const raw = encrypted ? safeStorage.encryptString(JSON.stringify(value)) : Buffer.from(JSON.stringify(value))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ encrypted, data: raw.toString('base64') }), { mode: 0o600 })
}

// ---------- App ----------

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  prefs = loadPrefs()
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen'])
  // Permissões (microfone, câmera, tela, notificação) só pra janela do app.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
    callback(wc === win?.webContents && allowed.has(permission)),
  )
  session.defaultSession.setPermissionCheckHandler((wc, permission) => wc === win?.webContents && allowed.has(permission))
  session.defaultSession.setSpellCheckerLanguages(['pt-BR', 'en-US'])
  setupDisplayMedia()
  createWindow()
  applyPrefs(null)
  if (!hidden) setupUpdater((state) => win?.webContents.send('update:state', state))
})

app.on('second-instance', (_event, argv) => {
  const action = actionFromArgs(argv)
  const invite = inviteFromArgs(argv)
  if (action) return dispatch(action)
  showWindow()
  if (invite) deliverInvite(invite)
})

app.on('before-quit', () => {
  quitting = true
})

app.on('will-quit', () => {
  stopScreenAudio()
  inkStop()
})

app.on('window-all-closed', () => {
  app.quit()
})
