// Integração com o sistema: ícone na bandeja, botões na barra de tarefas do
// Windows, atalhos globais e abrir junto com o computador.

import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CallState, DesktopPrefs, ShortcutAction } from '../preload/api'
import { onLocaleChange, tm } from './i18n'

type Dispatch = (action: ShortcutAction) => void

const buildDir = () => (app.isPackaged ? join(process.resourcesPath, 'build') : join(__dirname, '../../build'))

function image(name: string, size: number): NativeImage {
  for (const candidate of [`${name}.png`, 'icon.png']) {
    const path = join(buildDir(), candidate)
    if (existsSync(path)) {
      const img = nativeImage.createFromPath(path)
      // tray@2x.png ao lado do tray.png é pego sozinho pelo Electron em telas HiDPI.
      return candidate === 'icon.png' ? img.resize({ width: size, height: size }) : img
    }
  }
  return nativeImage.createEmpty()
}

export function appIcon(): NativeImage {
  return image('icon', 256)
}

// ---------- Bandeja ----------

let tray: Tray | null = null
let lastState: CallState = { inCall: false, muted: false, deafened: false, sharing: false, speaking: false }
/** O que o menu e os botões chamam, e a janela: guardados pra refazer tudo quando o idioma muda. */
let actions: { show: () => void; dispatch: Dispatch } | null = null
let lastWin: BrowserWindow | null = null

/** Mutado ou ensurdecido: o ícone inteiro vira o aviso (vermelho), que lê até nos 12 px do tray do Omarchy. */
function alertName(state: CallState) {
  if (state.deafened) return 'tray-deafened'
  if (state.muted) return 'tray-muted'
  return null
}

/** Ensurdecido > mutado > falando (verde inteiro) > normal. */
function iconName(state: CallState) {
  return alertName(state) ?? (state.inCall && state.speaking ? 'tray-speaking' : 'tray')
}

function stateIcon(state: CallState) {
  return image(iconName(state), 32)
}

function trayMenu(state: CallState, show: () => void, dispatch: Dispatch) {
  const t = tm().tray
  return Menu.buildFromTemplate([
    { label: t.open, click: show },
    { type: 'separator' },
    { label: t.mute, type: 'checkbox', checked: state.muted, click: () => dispatch('toggle-mute') },
    { label: t.deafen, type: 'checkbox', checked: state.deafened, click: () => dispatch('toggle-deafen') },
    { label: t.leave, enabled: state.inCall, click: () => dispatch('leave-call') },
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ])
}

function trayTooltip(state: CallState) {
  const t = tm().tray
  return state.deafened ? t.deafened : state.muted ? t.muted : 'Resenha'
}

export function setTray(enabled: boolean, show: () => void, dispatch: Dispatch) {
  actions = { show, dispatch }
  if (!enabled) {
    tray?.destroy()
    tray = null
    return
  }
  if (tray) return
  tray = new Tray(stateIcon(lastState))
  tray.setToolTip(trayTooltip(lastState))
  tray.on('click', show)
  tray.setContextMenu(trayMenu(lastState, show, dispatch))
}

export function hasTray() {
  return tray !== null
}

/** Atualiza bandeja e barra de tarefas quando muta, ensurdece, fala, entra ou sai da call. */
export function showCallState(state: CallState, win: BrowserWindow | null, show: () => void, dispatch: Dispatch) {
  const previous = lastState
  lastState = state
  actions = { show, dispatch }
  lastWin = win
  const iconChanged = iconName(state) !== iconName(previous)
  // Falar liga e desliga várias vezes por segundo: o menu só é refeito quando o resto muda.
  const menuChanged = state.inCall !== previous.inCall || state.muted !== previous.muted || state.deafened !== previous.deafened

  if (tray) {
    if (iconChanged) tray.setImage(stateIcon(state))
    if (menuChanged) {
      tray.setToolTip(trayTooltip(state))
      tray.setContextMenu(trayMenu(state, show, dispatch))
    }
  }
  if (!win) return

  // Linux: a janela também troca de ícone (barra de tarefas do KDE e afins). Falando não troca,
  // porque acende e apaga várias vezes por segundo.
  if (process.platform === 'linux') {
    const alert = alertName(state)
    if (alert !== alertName(previous)) win.setIcon(alert ? image(alert, 64) : appIcon())
    return
  }
  if (process.platform !== 'win32') return

  // Windows: selo no ícone da barra de tarefas (verde falando, vermelho mutado) e botões na miniatura.
  if (iconChanged) taskbarOverlay(state, win)
  if (menuChanged) taskbarButtons(state, win, dispatch)
}

function taskbarOverlay(state: CallState, win: BrowserWindow) {
  const t = tm().taskbar
  const name = iconName(state)
  const label = state.deafened ? t.deafened : state.muted ? t.muted : name === 'tray-speaking' ? t.speaking : ''
  win.setOverlayIcon(name === 'tray' ? null : image(name, 16), label)
}

function taskbarButtons(state: CallState, win: BrowserWindow, dispatch: Dispatch) {
  const t = tm().taskbar
  win.setThumbarButtons(
    state.inCall
      ? [
          {
            tooltip: state.muted ? t.unmute : t.mute,
            icon: image(state.muted ? 'tray-muted' : 'tray', 16),
            click: () => dispatch('toggle-mute'),
          },
          {
            tooltip: state.deafened ? t.undeafen : t.deafen,
            icon: image(state.deafened ? 'tray-deafened' : 'tray', 16),
            click: () => dispatch('toggle-deafen'),
          },
        ]
      : [],
  )
}

// A interface trocou de idioma: refaz o menu e as dicas da bandeja (e os botões do Windows).
onLocaleChange(() => {
  if (!actions) return
  if (tray) {
    tray.setToolTip(trayTooltip(lastState))
    tray.setContextMenu(trayMenu(lastState, actions.show, actions.dispatch))
  }
  if (process.platform !== 'win32' || !lastWin || lastWin.isDestroyed()) return
  taskbarOverlay(lastState, lastWin)
  taskbarButtons(lastState, lastWin, actions.dispatch)
})

// ---------- Atalhos globais ----------

/** Registra os atalhos no sistema e devolve os que não deu (conflito ou formato inválido). */
export function registerShortcuts(shortcuts: DesktopPrefs['shortcuts'], dispatch: Dispatch): ShortcutAction[] {
  globalShortcut.unregisterAll()
  const failed: ShortcutAction[] = []
  for (const [action, accelerator] of Object.entries(shortcuts) as [ShortcutAction, string | null][]) {
    if (!accelerator) continue
    try {
      if (!globalShortcut.register(accelerator, () => dispatch(action))) failed.push(action)
    } catch {
      failed.push(action)
    }
  }
  return failed
}

// ---------- Abrir junto com o computador ----------

const autostartFile = () => join(homedir(), '.config', 'autostart', 'resenha.desktop')

export function setAutostart(enabled: boolean) {
  if (!app.isPackaged) return // em desenvolvimento não faz sentido
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
    return
  }
  // Linux: arquivo do padrão XDG de autostart (KDE, GNOME, e o uwsm no Hyprland).
  if (!enabled) return rmSync(autostartFile(), { force: true })
  const exec = process.env.APPIMAGE ?? process.execPath
  mkdirSync(join(homedir(), '.config', 'autostart'), { recursive: true })
  writeFileSync(
    autostartFile(),
    ['[Desktop Entry]', 'Type=Application', 'Name=Resenha', `Exec="${exec}" --hidden`, 'Icon=resenha', 'X-GNOME-Autostart-enabled=true', ''].join(
      '\n',
    ),
  )
}
