// O `window.resenha` do celular (Android, pelo Capacitor): no computador quem dá isso
// é o processo principal do Electron (src/preload). Aqui só existe o que funciona no
// celular; o resto responde "não tem" e a interface esconde (PlatformInfo.mobile).
// Este módulo roda antes do app (mobile/main.ts): o app usa o window.resenha logo ao abrir.

import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Preferences } from '@capacitor/preferences'
import { PushNotifications } from '@capacitor/push-notifications'
import { registerPlugin } from '@capacitor/core'
import type { CallState, DesktopPrefs, PlatformInfo, ResenhaApi, SavedSession, ShortcutAction, UpdateState } from '../../preload/api'
import { m } from '../lib/i18n.svelte'

const VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0'
const SESSION_KEY = 'resenha.session'
/** Releases do GitHub: o APK da versão nova vem de lá (fora da Play Store). */
const RELEASES = 'https://api.github.com/repos/LucasLomiento/resenha/releases/latest'

const DESKTOP: DesktopPrefs = {
  tray: false,
  closeToTray: false,
  autostart: false,
  startHidden: false,
  zoom: 1,
  shortcuts: { 'toggle-mute': null, 'toggle-deafen': null, 'toggle-share': null, 'leave-call': null, 'show-window': null },
}

// ---------- Convites (resenha://invite/<código> ou o link /i/<código>) ----------

let pendingInvite: string | null = null
let inviteListener: ((code: string) => void) | null = null

function inviteFrom(url: string): string | null {
  const match = url.match(/(?:resenha:\/\/invite\/|\/i\/)([A-Za-z0-9_-]{4,64})/)
  return match?.[1] ?? null
}

void App.getLaunchUrl().then((launch) => {
  const code = launch?.url ? inviteFrom(launch.url) : null
  if (code) pendingInvite = code
})
void App.addListener('appUrlOpen', ({ url }) => {
  const code = inviteFrom(url)
  if (!code) return
  if (inviteListener) inviteListener(code)
  else pendingInvite = code
})

// ---------- Push (Firebase): avisos com o app fechado ----------

const PUSH = import.meta.env.VITE_PUSH === '1'
let pushOpen: ((data: Record<string, string>) => void) | null = null
let pendingOpen: Record<string, string> | null = null
let pushToken: Promise<string | null> | null = null

if (PUSH) {
  // Registrado já ao carregar: o toque que abriu o app chega antes do app estar pronto.
  void PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const data = (notification.data ?? {}) as Record<string, string>
    if (pushOpen) pushOpen(data)
    else pendingOpen = data
  })
}

async function registerPush(): Promise<string | null> {
  let permission = await PushNotifications.checkPermissions()
  if (permission.receive !== 'granted' && permission.receive !== 'denied') permission = await PushNotifications.requestPermissions()
  if (permission.receive !== 'granted') return null
  // Os canais do Android (o servidor escolhe um deles em cada aviso): mensagem aparece por cima; ligação também e toca.
  const names = m.app.pushChannels
  await PushNotifications.createChannel({ id: 'messages', name: names.messages, importance: 4, visibility: 0 })
  await PushNotifications.createChannel({ id: 'calls', name: names.calls, importance: 5, visibility: 1 })
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 20_000)
    void PushNotifications.addListener('registration', ({ value }) => {
      clearTimeout(timer)
      resolve(value)
    })
    void PushNotifications.addListener('registrationError', () => {
      clearTimeout(timer)
      resolve(null)
    })
    void PushNotifications.register()
  })
}

// ---------- Botão voltar: fecha o que está por cima; sem nada, o app vai pro fundo ----------

let backHandler: (() => boolean) | null = null
void App.addListener('backButton', () => {
  if (!backHandler?.()) void App.minimizeApp()
})

// ---------- Call com o app no fundo (o serviço do Android, com a notificação fixa) ----------

interface CallServicePlugin {
  update(options: { inCall: boolean; title?: string; text?: string; mute?: string; leave?: string; channel?: string }): Promise<void>
  addListener(event: 'action', callback: (data: { action: ShortcutAction }) => void): Promise<unknown>
}
const CallService = registerPlugin<CallServicePlugin>('CallService')

let actionListener: ((action: ShortcutAction) => void) | null = null
void CallService.addListener('action', ({ action }) => actionListener?.(action))

let lastCall = ''
function callState(state: CallState) {
  const t = m.app.dock
  const options = state.inCall
    ? { inCall: true, title: t.inCall, text: state.place ?? '', mute: state.muted ? t.unmute : t.mute, leave: t.leave, channel: m.app.call.label }
    : { inCall: false }
  // O "falando" muda o tempo todo e não aparece na notificação: só fala com o Android quando muda algo dela.
  const key = JSON.stringify(options)
  if (key === lastCall) return
  lastCall = key
  CallService.update(options).catch(() => {})
}

// ---------- Avisos (notificação do sistema; clicar abre o que avisou) ----------

const clicks = new Map<number, () => void>()
let nextNotification = 1
void LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
  clicks.get(notification.id)?.()
  clicks.delete(notification.id)
})

async function notify(title: string, body: string, onclick?: () => void) {
  const permission = await LocalNotifications.checkPermissions()
  if (permission.display !== 'granted' && (await LocalNotifications.requestPermissions()).display !== 'granted') return
  const id = nextNotification++
  if (onclick) clicks.set(id, onclick)
  await LocalNotifications.schedule({ notifications: [{ id, title, body }] })
}

// ---------- Atualização (o APK novo, das releases do GitHub) ----------

let update: UpdateState = { status: 'idle' }
let updateListener: ((state: UpdateState) => void) | null = null
let apkUrl: string | null = null

function setUpdate(state: UpdateState) {
  update = state
  updateListener?.(state)
}

/** "1.14.2" > "1.14.10"? Compara número por número. */
function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

async function checkUpdate() {
  setUpdate({ status: 'checking' })
  try {
    const release = (await (await fetch(RELEASES)).json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] }
    const version = (release.tag_name ?? '').replace(/^v/, '')
    const apk = release.assets?.find((a) => a.name.endsWith('.apk'))
    if (!apk || !newer(version, VERSION)) return setUpdate({ status: 'none' })
    apkUrl = apk.browser_download_url
    setUpdate({ status: 'available', version })
  } catch {
    setUpdate({ status: 'none' })
  }
}
setTimeout(() => void checkUpdate(), 10_000)
setInterval(() => void checkUpdate(), 6 * 60 * 60_000)

const platform: PlatformInfo = {
  platform: 'android',
  portalPicker: false,
  screenAudio: 'none',
  version: VERSION,
  hyprland: false,
  music: false,
  mobile: true,
}

const nothing = () => {}

const api: ResenhaApi = {
  platform: async () => platform,
  session: {
    get: async () => {
      const { value } = await Preferences.get({ key: SESSION_KEY })
      try {
        return value ? (JSON.parse(value) as SavedSession) : null
      } catch {
        return null
      }
    },
    set: async (session) => {
      if (session) await Preferences.set({ key: SESSION_KEY, value: JSON.stringify(session) })
      else await Preferences.remove({ key: SESSION_KEY })
    },
  },
  // Compartilhar a tela, rabiscar por cima dela e o som dela: só no computador.
  share: { sources: async () => [], select: async () => {} },
  ink: { monitors: async () => null, start: async () => ({ ok: false, error: 'mobile' }), event: nothing, stop: nothing, onClosed: nothing },
  screenAudio: { apps: async () => [], start: async () => ({ ok: false }), unmute: async () => {}, stop: async () => {} },
  attention: nothing,
  showWindow: nothing,
  pendingInvite: async () => {
    const code = pendingInvite
    pendingInvite = null
    return code
  },
  onInvite: (callback) => {
    inviteListener = callback
  },
  // Cadastro aberto com anti-robô: por enquanto só no computador (com convite funciona).
  turnstile: async () => null,
  download: (url) => void Browser.open({ url }),
  setLocale: nothing,
  notify: (title, body, onclick) => void notify(title, body, onclick),
  onBack: (callback) => {
    backHandler = callback
  },
  push: PUSH
    ? {
        token: () => (pushToken ??= registerPush().then((token) => token ?? ((pushToken = null), null))),
        onOpen: (callback) => {
          pushOpen = callback
          if (pendingOpen) callback(pendingOpen)
          pendingOpen = null
        },
      }
    : undefined,
  desktop: { get: async () => null, set: async () => ({ prefs: DESKTOP, failed: [] }), failed: async () => [] },
  spotify: {
    status: async () => ({ librespot: false, installable: false, account: null, ownRedirect: '', running: false }),
    connect: async () => ({ ok: false, error: 'missing' }),
    disconnect: async () => {},
    install: async () => false,
    start: async () => ({ ok: false, error: 'missing' }),
    stop: async () => {},
    request: async () => ({ ok: false, error: 'off' }),
    want: nothing,
    flush: nothing,
    onPcm: nothing,
    onStopped: nothing,
    onBrowser: nothing,
  },
  callState,
  unread: nothing,
  onAction: (callback) => {
    actionListener = callback
  },
  update: {
    state: async () => update,
    check: () => checkUpdate(),
    // Abre o APK no navegador: o Android baixa e pergunta se quer instalar.
    download: async () => {
      if (apkUrl) await Browser.open({ url: apkUrl })
    },
    install: async () => {
      if (apkUrl) await Browser.open({ url: apkUrl })
    },
    onState: (callback) => {
      updateListener = callback
    },
    takeRejoin: async () => null,
  },
}

;(window as unknown as { resenha: ResenhaApi }).resenha = api
