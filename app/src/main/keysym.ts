// Atalho no formato do Electron ("CommandOrControl+Shift+M") -> modificadores e o nome
// da tecla no xkb, que é o que o Hyprland e o portal de atalhos (KDE, GNOME) entendem.

export type Modifier = 'SHIFT' | 'CTRL' | 'ALT' | 'SUPER'

const MODS: Record<string, Modifier> = {
  Shift: 'SHIFT',
  CommandOrControl: 'CTRL',
  Control: 'CTRL',
  Ctrl: 'CTRL',
  Alt: 'ALT',
  Super: 'SUPER',
  Meta: 'SUPER',
}

/** Tecla do accelerator do Electron -> nome do keysym do xkb. */
const KEYS: Record<string, string> = {
  Space: 'space',
  Tab: 'Tab',
  Backspace: 'BackSpace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'Prior',
  PageDown: 'Next',
  Up: 'Up',
  Down: 'Down',
  Left: 'Left',
  Right: 'Right',
  '`': 'grave',
  '-': 'minus',
  '=': 'equal',
  '[': 'bracketleft',
  ']': 'bracketright',
  '\\': 'backslash',
  ';': 'semicolon',
  "'": 'apostrophe',
  ',': 'comma',
  '.': 'period',
  '/': 'slash',
  Pause: 'Pause',
  Scrolllock: 'Scroll_Lock',
  PrintScreen: 'Print',
  numadd: 'KP_Add',
  numsub: 'KP_Subtract',
  nummult: 'KP_Multiply',
  numdiv: 'KP_Divide',
  numdec: 'KP_Decimal',
}

export interface KeyCombo {
  /** Sem repetir, na ordem em que vieram. */
  mods: Modifier[]
  /** Nome do keysym ("M", "F12", "space", "KP_5"). */
  key: string
}

/** "CommandOrControl+Shift+M" -> { mods: ['CTRL', 'SHIFT'], key: 'M' }; null se não der. */
export function keyCombo(accelerator: string): KeyCombo | null {
  const parts = accelerator.split('+')
  // "+" sozinho como tecla não existe no app (vira "numadd" ou "=" com Shift).
  const last = parts.pop()
  if (!last) return null
  const mods: Modifier[] = []
  for (const part of parts) {
    const mod = MODS[part]
    if (!mod) return null
    if (!mods.includes(mod)) mods.push(mod)
  }
  const key = /^[A-Z0-9]$/.test(last) || /^F\d{1,2}$/.test(last) ? last : /^num\d$/.test(last) ? `KP_${last.slice(3)}` : KEYS[last]
  return key ? { mods, key } : null
}
