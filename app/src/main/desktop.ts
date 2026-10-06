// Integração com o sistema: ícone na bandeja, botões na barra de tarefas do
// Windows, atalhos globais e abrir junto com o computador.

import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CallState, DesktopPrefs, ShortcutAction } from '../preload/api'

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

/** Ensurdecido > mutado > falando (acende em verde) > normal. */
function iconName(state: CallState) {
  if (state.deafened) return 'tray-deafened'
  if (state.muted) return 'tray-muted'
  return state.inCall && state.speaking ? 'tray-speaking' : 'tray'
}

function stateIcon(state: CallState) {
  return image(iconName(state), 32)
}

function trayMenu(state: CallState, show: () => void, dispatch: Dispatch) {
  return Menu.buildFromTemplate([
    { label: 'Abrir o Resenha', click: show },
    { type: 'separator' },
    { label: 'Mutar microfone', type: 'checkbox', checked: state.muted, click: () => dispatch('toggle-mute') },
    { label: 'Ensurdecer', type: 'checkbox', checked: state.deafened, click: () => dispatch('toggle-deafen') },
    { label: 'Sair da call', enabled: state.inCall, click: () => dispatch('leave-call') },
    { type: 'separator' },
    { label: 'Fechar o Resenha', click: () => app.quit() },
  ])
}

export function setTray(enabled: boolean, show: () => void, dispatch: Dispatch) {
  if (!enabled) {
    tray?.destroy()
    tray = null
    return
  }
  if (tray) return
  tray = new Tray(stateIcon(lastState))
  tray.setToolTip('Resenha')
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
  const iconChanged = iconName(state) !== iconName(previous)
  // Falar liga e desliga várias vezes por segundo: o menu só é refeito quando o resto muda.
  const menuChanged = state.inCall !== previous.inCall || state.muted !== previous.muted || state.deafened !== previous.deafened

  if (tray) {
    if (iconChanged) tray.setImage(stateIcon(state))
    if (menuChanged) {
      tray.setToolTip(state.deafened ? 'Resenha · ensurdecido' : state.muted ? 'Resenha · mutado' : 'Resenha')
      tray.setContextMenu(trayMenu(state, show, dispatch))
    }
  }
  if (process.platform !== 'win32' || !win) return

  // Windows: selo no ícone da barra de tarefas (verde falando, vermelho mutado) e botões na miniatura.
  if (iconChanged) {
    const name = iconName(state)
    const label = state.deafened ? 'Ensurdecido' : state.muted ? 'Mutado' : name === 'tray-speaking' ? 'Falando' : ''
    win.setOverlayIcon(name === 'tray' ? null : image(name, 16), label)
  }
  if (!menuChanged) return
  win.setThumbarButtons(
    state.inCall
      ? [
          {
            tooltip: state.muted ? 'Desmutar' : 'Mutar',
            icon: image(state.muted ? 'tray-muted' : 'tray', 16),
            click: () => dispatch('toggle-mute'),
          },
          {
            tooltip: state.deafened ? 'Voltar a ouvir' : 'Ensurdecer',
            icon: image(state.deafened ? 'tray-deafened' : 'tray', 16),
            click: () => dispatch('toggle-deafen'),
          },
        ]
      : [],
  )
}

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
