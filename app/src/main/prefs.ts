// Preferências que o processo principal precisa antes da interface abrir
// (bandeja, atalhos globais, início com o PC). Ficam num JSON no userData.

import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DesktopPrefs } from '../preload/api'

/** No Hyprland a bandeja é opcional e quase ninguém usa; nos outros (KDE, Windows) vem ligada. */
export const isHyprland = /hyprland/i.test(process.env.XDG_CURRENT_DESKTOP ?? '') || !!process.env.HYPRLAND_INSTANCE_SIGNATURE

const defaults: DesktopPrefs = {
  tray: !isHyprland,
  closeToTray: !isHyprland,
  autostart: false,
  startHidden: true,
  zoom: 1,
  shortcuts: {
    'toggle-mute': 'CommandOrControl+Shift+M',
    'toggle-deafen': 'CommandOrControl+Shift+D',
    'toggle-share': null,
    'leave-call': null,
    'show-window': null,
  },
}

const file = () => join(app.getPath('userData'), 'desktop.json')

export function loadPrefs(): DesktopPrefs {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as Partial<DesktopPrefs>
    return { ...defaults, ...saved, shortcuts: { ...defaults.shortcuts, ...saved.shortcuts } }
  } catch {
    return structuredClone(defaults)
  }
}

export function savePrefs(prefs: DesktopPrefs) {
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(prefs, null, 2))
}
