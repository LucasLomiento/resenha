import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  safeStorage,
  session,
  shell,
  type Streams,
} from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { dirname, join } from 'node:path'
import type { CaptureSource, PlatformInfo, SavedSession } from '../preload/api'
import { screenAudioAvailable, startScreenAudio, stopScreenAudio, unmuteScreenAudio } from './screen-audio-linux'

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
if (isLinux) app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
const hidden = process.env.RESENHA_HIDDEN === '1'

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 560,
    title: 'Resenha',
    backgroundColor: '#17181c',
    autoHideMenuBar: true,
    show: !hidden,
    icon: join(__dirname, '../../build/icon.png'),
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

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) event.preventDefault()
  })
  win.on('focus', () => win?.flashFrame(false))
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('renderer caiu:', details.reason, details.exitCode)
    if (details.reason !== 'clean-exit') win?.webContents.reload()
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
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

ipcMain.handle('share:sources', async (): Promise<CaptureSource[]> => {
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

ipcMain.handle('share:select', (_event, choice: { sourceId: string | null; audio: boolean }) => {
  pendingShare = choice
})

ipcMain.handle('screen-audio:start', () => startScreenAudio())
ipcMain.handle('screen-audio:unmute', () => unmuteScreenAudio())
ipcMain.handle('screen-audio:stop', () => stopScreenAudio())

ipcMain.handle('platform:info', (): PlatformInfo => {
  let screenAudio: PlatformInfo['screenAudio'] = 'none'
  if (isLinux && screenAudioAvailable()) screenAudio = 'venmic'
  else if (isWindows) screenAudio = windowsExcludesSelf ? 'exclude-self' : 'loopback-all'
  return { platform: process.platform, portalPicker, screenAudio, version: app.getVersion() }
})

ipcMain.on('attention', () => {
  if (win && !win.isFocused()) win.flashFrame(true)
})

ipcMain.on('download', (_event, url: string) => {
  if (/^https?:\/\//.test(url)) win?.webContents.downloadURL(url)
})

// ---------- Sessão salva (criptografada com o chaveiro do sistema quando dá) ----------

const sessionFile = () => join(app.getPath('userData'), 'session.json')

ipcMain.handle('session:get', (): SavedSession | null => {
  try {
    const saved = JSON.parse(readFileSync(sessionFile(), 'utf8')) as { encrypted: boolean; data: string }
    const raw = Buffer.from(saved.data, 'base64')
    return JSON.parse(saved.encrypted ? safeStorage.decryptString(raw) : raw.toString('utf8'))
  } catch {
    return null
  }
})

ipcMain.handle('session:set', (_event, value: SavedSession | null) => {
  const file = sessionFile()
  if (!value) return rmSync(file, { force: true })
  const encrypted = safeStorage.isEncryptionAvailable()
  const raw = encrypted ? safeStorage.encryptString(JSON.stringify(value)) : Buffer.from(JSON.stringify(value))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ encrypted, data: raw.toString('base64') }), { mode: 0o600 })
})

// ---------- App ----------

app.whenReady().then(() => {
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  setupDisplayMedia()
  createWindow()
})

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.on('window-all-closed', () => {
  stopScreenAudio()
  app.quit()
})
