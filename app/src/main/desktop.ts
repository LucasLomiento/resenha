// Integração com o sistema: ícone na bandeja, botões na barra de tarefas do
// Windows, atalhos globais e abrir junto com o computador.

import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CallState, DesktopPrefs, ShortcutAction } from '../preload/api'
import { onLocaleChange, tm } from './i18n'
import { hasHyprland, setHyprShortcuts } from './hyprland'
import { setPortalShortcuts, usesPortalShortcuts } from './portal-shortcuts'
import { whenTrayHostReady } from './tray-host'

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
/** Cancela a espera pela barra antes de criar o ícone; null quando não está esperando. */
let cancelTrayWait: (() => void) | null = null
/** Wayland sem barra passado o limite: ainda espera (devagar), mas já não conta como bandeja. */
let trayGaveUp = false
let trayGone: () => void = () => {}
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

/** Ícone que não pisca: o aviso, ou o microfone verde enquanto está na call. */
function steadyName(state: CallState) {
  return alertName(state) ?? (state.inCall ? 'tray-call' : null)
}

/** Ensurdecido > mutado > falando (verde claro) > na call (verde) > normal. */
function iconName(state: CallState) {
  return alertName(state) ?? (state.inCall ? (state.speaking ? 'tray-speaking' : 'tray-call') : 'tray')
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
  return state.deafened ? t.deafened : state.muted ? t.muted : state.inCall ? t.inCall : 'Resenha'
}

export function setTray(enabled: boolean, show: () => void, dispatch: Dispatch) {
  actions = { show, dispatch }
  if (!enabled) {
    cancelTrayWait?.()
    cancelTrayWait = null
    trayGaveUp = false
    tray?.destroy()
    tray = null
    return
  }
  if (tray || cancelTrayWait) return
  trayGaveUp = false
  // Criado antes da barra, o ícone não aparece nunca (tray-host.ts).
  const cancel = whenTrayHostReady(
    () => {
      cancelTrayWait = null
      trayGaveUp = false
      tray = new Tray(stateIcon(lastState))
      tray.setToolTip(trayTooltip(lastState))
      tray.on('click', show)
      tray.setContextMenu(trayMenu(lastState, show, dispatch))
    },
    {
      onGiveUp: () => {
        trayGaveUp = true
        trayGone()
      },
    },
  )
  // Fora do Linux o ícone já nasceu aqui dentro: não sobra espera nenhuma.
  if (!tray) cancelTrayWait = cancel
}

/** Esperando a barra conta como bandeja (a janela fica escondida e o ícone chega logo), até desistir dela. */
export function hasTray() {
  return tray !== null || (cancelTrayWait !== null && !trayGaveUp)
}

/** A bandeja deixou de contar (Wayland sem barra): a janela escondida não teria como voltar. */
export function onTrayUnavailable(callback: () => void) {
  trayGone = callback
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
    const steady = steadyName(state)
    if (steady !== steadyName(previous)) win.setIcon(steady ? image(steady, 64) : appIcon())
    return
  }
  if (process.platform !== 'win32') return

  // Windows: selo no ícone da barra de tarefas (verde na call, verde claro falando, vermelho mutado)
  // e botões na miniatura.
  if (iconChanged) taskbarOverlay(state, win)
  if (menuChanged) taskbarButtons(state, win, dispatch)
}

function taskbarOverlay(state: CallState, win: BrowserWindow) {
  const t = tm().taskbar
  const name = iconName(state)
  const label =
    state.deafened ? t.deafened
    : state.muted ? t.muted
    : name === 'tray-speaking' ? t.speaking
    : name === 'tray-call' ? t.inCall
    : ''
  win.setOverlayIcon(name === 'tray' ? null : image(name, 16), label)
}

function taskbarButtons(state: CallState, win: BrowserWindow, dispatch: Dispatch) {
  const t = tm().taskbar
  win.setThumbarButtons(
    state.inCall
      ? [
          {
            tooltip: state.muted ? t.unmute : t.mute,
            icon: image(state.muted ? 'tray-muted' : 'tray-call', 16),
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

/**
 * Registra os atalhos no sistema e devolve os que não deu (conflito ou formato inválido).
 * No Hyprland vão como binds do próprio Hyprland (ver hyprland.ts): o portal registra mas
 * não liga tecla nenhuma, e o atalho só funcionava com a janela em foco. No resto do Wayland
 * (KDE, GNOME) vão pelo portal, com o bind feito toda vez (ver portal-shortcuts.ts). No X11 e
 * no Windows, pelo `globalShortcut` do Electron.
 */
export async function registerShortcuts(shortcuts: DesktopPrefs['shortcuts'], dispatch: Dispatch): Promise<ShortcutAction[]> {
  globalShortcut.unregisterAll()
  if (hasHyprland()) return setHyprShortcuts(shortcuts, dispatch)
  if (usesPortalShortcuts()) return setPortalShortcuts(shortcuts, dispatch)
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
