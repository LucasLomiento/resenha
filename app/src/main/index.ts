import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  Menu,
  powerMonitor,
  safeStorage,
  session,
  shell,
  type Streams,
} from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CallState, CaptureSource, DesktopPrefs, PlatformInfo, SavedSession, ShortcutAction } from '../preload/api'
import { attachContextMenu } from './context-menu'
import { appIcon, closeNotice, hasTray, onTrayUnavailable, registerShortcuts, setAutostart, setTray, showCallState, showNotice } from './desktop'
import { isLocale, localeFrom, mainLocale, setMainLocale, tm, type Locale } from './i18n'
import { clearHyprShortcuts } from './hyprland'
import { inkEvent, inkMonitors, inkStart, inkStop, onInkClosed } from './ink'
import { clearPortalShortcuts } from './portal-shortcuts'
import { isHyprland, loadPrefs, savePrefs } from './prefs'
import {
  listPlayingApps,
  screenAudioAvailable,
  startScreenAudio,
  stopScreenAudio,
  unmuteScreenAudio,
  type ScreenAudioOptions,
} from './screen-audio-linux'
import {
  installLibrespot,
  setSpotifyTarget,
  spotifyConnect,
  spotifyDisconnect,
  spotifyFlush,
  spotifyKill,
  spotifyRequest,
  spotifyStart,
  spotifyStatus,
  spotifyStop,
  spotifySupported,
  spotifyWant,
} from './spotify'
import { checkForUpdates, downloadUpdate, installUpdate, setUpdaterCall, setUpdaterCleanup, setupUpdater, takeRejoin, updateState } from './updater'

// RESENHA_PROFILE=b roda uma segunda instância com outra conta no mesmo PC.
const profile = process.env.RESENHA_PROFILE
if (profile) app.setPath('userData', join(app.getPath('appData'), `resenha-${profile}`))

// Já tem um Resenha aberto: ele recebe os argumentos (`second-instance`) e este sai na hora, sem
// montar nada. Antes do laço de eventos o `app.exit` sai direto, sem `will-quit`: a limpeza da
// saída tiraria os atalhos do Hyprland do outro (são achados pela descrição, não por processo).
const primary = app.requestSingleInstanceLock()
if (!primary) app.exit(0)

const isLinux = process.platform === 'linux'
const isWindows = process.platform === 'win32'
const portalPicker = isLinux && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)
/** Servidor do Vite no desenvolvimento. No app empacotado, a variável não vale (ninguém troca a página por outra). */
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
/**
 * Windows: o Electron 44 só aceita 'loopback' e 'loopbackWithMute' no áudio da tela (os tipos e
 * a mensagem "audio must be a WebFrameMain, "loopback" or "loopbackWithMute"" no binário). O
 * 'loopbackWithoutChrome', que tiraria o som do próprio app, era recusado e a tela com som nem
 * abria. Com 'loopback' vai o som do computador inteiro, com a voz da call (`loopback-all`).
 * Se mesmo assim o Electron recusar, o áudio da tela some daqui pra frente (só o vídeo).
 */
let windowsScreenAudio = isWindows

// O inspecionar (DevTools) só abre em desenvolvimento: no app instalado as janelas têm
// `devTools: false`, o F12 não faz nada e o `--remote-debugging-port` não abre porta. O
// `--inspect` e o `NODE_OPTIONS` do processo principal saem pelos fuses (`electronFuses`).
if (app.isPackaged) {
  app.commandLine.removeSwitch('remote-debugging-port')
  app.commandLine.removeSwitch('remote-debugging-pipe')
}

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
// Captura de tela pelo PipeWire. Os atalhos globais no Wayland não vão pelo portal do Chromium
// (o GlobalShortcutsPortal pula o bind e no KDE 6.7.4+ o atalho fica inativo): o app fala com o
// portal sozinho (portal-shortcuts.ts) ou, no Hyprland, cria os binds (hyprland.ts).
if (isLinux) app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')
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
if (!profile && primary) {
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
    backgroundColor: '#09090b',
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
      devTools: !app.isPackaged,
    },
  })

  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  // Recarregou: a camada dos rabiscos era da transmissão de antes. Só a página do app: o
  // `did-start-loading` também dispara com iframe carregando (o Street View no meio da transmissão).
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) inkStop()
  })
  attachContextMenu(win)
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
  win.on('closed', () => {
    win = null
  })
  win.webContents.on('did-finish-load', () => win?.webContents.setZoomFactor(prefs.zoom))
  // Sem menu de aplicativo (evita Ctrl+W/Ctrl+R por engano); DevTools no F12 só em desenvolvimento.
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
        win?.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }
  setSpotifyTarget(win.webContents)
  const page = win
  win.webContents.on('render-process-gone', (_event, details) => {
    // O que a página cuidava caiu junto: o bot do Spotify (recarregar também para; o app pede ao
    // abrir), o áudio da tela (o venmic deixaria os apps desviados) e a camada dos rabiscos.
    void spotifyStop()
    stopScreenAudio()
    inkStop()
    console.error('renderer caiu:', details.reason, details.exitCode)
    if (details.reason !== 'clean-exit' && !page.isDestroyed()) recoverPage(page)
  })

  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Quando a página caiu no último minuto (pra não recarregar em laço se ela cai de novo logo). */
const crashes: number[] = []

function recoverPage(page: BrowserWindow) {
  const now = Date.now()
  while (crashes.length > 0 && now - crashes[0] > 60_000) crashes.shift()
  crashes.push(now)
  if (crashes.length <= 3) return page.webContents.reload()
  // Caiu de novo e de novo (falta de memória, placa de vídeo...): pergunta em vez de insistir.
  const t = tm().crashed
  void dialog
    .showMessageBox(page, { type: 'error', message: t.message, detail: t.detail, buttons: [t.reload, t.quit], defaultId: 0, cancelId: 1 })
    .then(({ response }) => {
      if (page.isDestroyed()) return
      if (response !== 0) return app.quit()
      crashes.length = 0
      page.webContents.reload()
    })
}

// ---------- IPC: só a janela do próprio app fala com o processo principal ----------

const devOrigin = devUrl ? new URL(devUrl).origin : null

/** Endereço (ou origem) da página do app: o arquivo do pacote, ou o servidor do Vite no desenvolvimento. */
function fromApp(url: string | undefined): boolean {
  if (!url) return false
  if (url.startsWith('file:')) return true
  try {
    return !!devOrigin && new URL(url).origin === devOrigin
  } catch {
    return false
  }
}

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!win && event.sender === win.webContents && fromApp(event.senderFrame?.url)
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
      if (windowsScreenAudio && request.audioRequested && choice?.audio) streams.audio = 'loopback'
      try {
        callback(streams)
      } catch (err) {
        // O Electron recusou o pedido (e já respondeu com erro pra página): o áudio da tela sai daqui pra frente.
        if (!streams.audio) throw err
        windowsScreenAudio = false
        console.error('getDisplayMedia: o Electron recusou o áudio da tela; daqui pra frente vai só o vídeo', err)
        win?.webContents.send('screen-audio:unavailable')
      }
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

handle('spotify:status', () => spotifyStatus())
handle('spotify:connect', (_event, clientId: unknown) => spotifyConnect(clientId))
handle('spotify:disconnect', () => spotifyDisconnect())
handle('spotify:install', () => installLibrespot())
handle('spotify:start', () => spotifyStart())
handle('spotify:stop', () => spotifyStop())
handle('spotify:request', (_event, op: unknown) => spotifyRequest(op))
listen('spotify:want', (_event, bytes: unknown) => spotifyWant(bytes))
listen('spotify:flush', () => spotifyFlush())

handle('platform:info', (): PlatformInfo => {
  let screenAudio: PlatformInfo['screenAudio'] = 'none'
  if (isLinux && screenAudioAvailable()) screenAudio = 'venmic'
  else if (windowsScreenAudio) screenAudio = 'loopback-all'
  return { platform: process.platform, portalPicker, screenAudio, version: app.getVersion(), hyprland: isHyprland, music: spotifySupported(), mobile: false }
})

/**
 * Os avisos de licença do que vai no app (gerados no build, ao lado do index.html). No pacote
 * ficam soltos em resources/ (o electron-builder tira do app.asar o que vai como extraResources).
 */
handle('licenses:get', (): string | null => {
  const file = app.isPackaged ? join(process.resourcesPath, 'THIRD_PARTY_LICENSES.txt') : join(__dirname, '../renderer/THIRD_PARTY_LICENSES.txt')
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
})

listen('attention', () => {
  if (win && !win.isFocused()) win.flashFrame(true)
})
listen('show-window', () => showWindow())

listen('notify', (_event, tag: unknown, title: unknown, body: unknown) => {
  if (typeof tag !== 'string' || typeof title !== 'string' || typeof body !== 'string') return
  showNotice(tag, title, body, () => win?.webContents.send('notify:click', tag))
})
listen('notify:close', (_event, tag: unknown) => {
  if (typeof tag === 'string') closeNotice(tag)
})

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
      title: tm().verifyTitle,
      backgroundColor: '#0c0c0e',
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'turnstile', devTools: !app.isPackaged },
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

/** Os atalhos que o sistema recusou da última vez (a página de atalhos mostra ao abrir). */
let shortcutFailures: ShortcutAction[] = []

async function applyPrefs(previous: DesktopPrefs | null): Promise<ShortcutAction[]> {
  setTray(prefs.tray, showWindow, dispatch)
  if (!previous || previous.autostart !== prefs.autostart) setAutostart(prefs.autostart)
  win?.webContents.setZoomFactor(prefs.zoom)
  shortcutFailures = await registerShortcuts(prefs.shortcuts, dispatch)
  return shortcutFailures
}

handle('desktop:get', () => prefs)
handle('desktop:failed', () => shortcutFailures)

handle('desktop:set', async (_event, patch: Partial<DesktopPrefs>) => {
  const previous = prefs
  prefs = { ...prefs, ...patch, shortcuts: { ...prefs.shortcuts, ...patch.shortcuts } }
  prefs.zoom = Math.min(2, Math.max(0.5, Number(prefs.zoom) || 1))
  savePrefs(prefs)
  return { prefs, failed: await applyPrefs(previous) }
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

// A interface trocou de idioma: guarda (a bandeja abre nele da próxima vez) e o corretor acompanha.
listen('locale', (_event, value: unknown) => {
  if (!isLocale(value)) return
  setMainLocale(value)
  setSpellCheck(value)
  if (prefs.locale !== value) {
    prefs = { ...prefs, locale: value }
    savePrefs(prefs)
  }
})

/** Corretor no idioma do app, com o inglês de reserva (o português junto, pra quem escreve misturado). */
function setSpellCheck(locale: Locale) {
  const wanted = { pt: ['pt-BR', 'en-US'], en: ['en-US', 'pt-BR'], es: ['es', 'es-419', 'en-US'] }[locale]
  const available = new Set(session.defaultSession.availableSpellCheckerLanguages)
  session.defaultSession.setSpellCheckerLanguages(wanted.filter((tag) => available.size === 0 || available.has(tag)))
}

handle('update:state', () => updateState())
handle('update:check', () => checkForUpdates())
handle('update:download', () => downloadUpdate())
handle('update:install', (_event, rejoin: unknown) => installUpdate(rejoin))
handle('update:take-rejoin', () => takeRejoin())

// ---------- Sessão salva (criptografada com o chaveiro do sistema quando dá) ----------

const sessionFile = () => join(app.getPath('userData'), 'session.json')
/** O login que não deu pra decifrar fica guardado aqui (não some com o login novo por cima). */
const unreadableFile = () => join(app.getPath('userData'), 'session.unreadable.json')
/** Tinha login salvo mas o chaveiro não abriu (trancado, ainda subindo no início automático). */
let unreadable = false

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

handle('session:get', async (): Promise<SavedSession | null> => {
  let saved: { encrypted: boolean; data: string }
  try {
    saved = JSON.parse(readFileSync(sessionFile(), 'utf8')) as { encrypted: boolean; data: string }
  } catch {
    return null // sem login salvo (ou o arquivo estragou)
  }
  const raw = Buffer.from(saved.data, 'base64')
  /** Abriu: o login antigo que não tinha aberto (se sobrou) já não serve pra nada. */
  const opened = (session: SavedSession) => {
    rmSync(unreadableFile(), { force: true })
    return session
  }
  if (!saved.encrypted) {
    try {
      const session = JSON.parse(raw.toString('utf8')) as SavedSession
      // Salvo em texto puro numa versão antiga e agora tem chaveiro: regrava criptografado.
      if (safeStorage.isEncryptionAvailable()) writeSession(session)
      return opened(session)
    } catch {
      return null
    }
  }
  // O chaveiro pode estar trancado ou ainda subindo (início automático com o KeePassXC): tenta
  // umas vezes, pelo caminho assíncrono também, antes de desistir. O arquivo não é apagado.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return opened(JSON.parse(safeStorage.decryptString(raw)) as SavedSession)
    } catch {
      // tenta pelo outro caminho
    }
    try {
      if (await safeStorage.isAsyncEncryptionAvailable()) {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(raw)
        const session = JSON.parse(result) as SavedSession
        if (shouldReEncrypt) writeSession(session)
        return opened(session)
      }
    } catch {
      // ainda não
    }
    await wait(2000)
  }
  unreadable = true
  console.warn('sessão: não deu pra decifrar o login salvo (o chaveiro está trancado?); o arquivo fica guardado')
  return null
})

handle('session:set', (_event, value: SavedSession | null) => {
  if (!value) {
    rmSync(unreadableFile(), { force: true })
    return rmSync(sessionFile(), { force: true })
  }
  // Entrou de novo porque o salvo não abriu: o antigo vai pro lado em vez de sumir.
  if (unreadable && existsSync(sessionFile())) renameSync(sessionFile(), unreadableFile())
  unreadable = false
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
  if (!primary) return
  Menu.setApplicationMenu(null)
  prefs = loadPrefs()
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen'])
  // Microfone, câmera, tela, notificação e área de transferência: só pra página do próprio app
  // (não pro iframe do Street View). Tela cheia vale pra janela inteira (o botão do Street View).
  const may = (wc: Electron.WebContents | null, permission: string, url: string | undefined) =>
    wc === win?.webContents && allowed.has(permission) && (permission === 'fullscreen' || fromApp(url))
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => callback(may(wc, permission, details.requestingUrl)))
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details) => may(wc, permission, details.requestingUrl ?? origin))
  onTrayUnavailable(() => {
    // Wayland sem barra (GNOME sem a extensão de AppIndicator): sem ícone, a janela escondida não teria como voltar.
    if (win && !win.isVisible()) win.showInactive()
  })
  setMainLocale(prefs.locale ?? localeFrom(app.getLocale()))
  setSpellCheck(mainLocale())
  setupDisplayMedia()
  createWindow()
  // O PC acordou: a página confere as conexões na hora (as que morreram durante o sono pareciam abertas).
  powerMonitor.on('resume', () => win?.webContents.send('resume'))
  void applyPrefs(null)
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

/** Fechando (pelo jeito normal ou pra atualizar): solta atalhos e mata o que o app abriu por fora. */
function cleanup() {
  clearHyprShortcuts()
  clearPortalShortcuts()
  stopScreenAudio()
  inkStop()
  spotifyKill()
}

app.on('will-quit', () => {
  if (primary) cleanup()
})
setUpdaterCleanup(cleanup)

app.on('window-all-closed', () => {
  app.quit()
})
