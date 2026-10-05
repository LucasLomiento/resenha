// Atalhos de teclado no formato de "accelerator" do Electron, que é o mesmo
// que o processo principal registra como atalho global no sistema.

import type { ShortcutAction } from '../../preload/api'

export const ACTIONS: { id: ShortcutAction; label: string }[] = [
  { id: 'toggle-mute', label: 'Mutar / desmutar o microfone' },
  { id: 'toggle-deafen', label: 'Ensurdecer / voltar a ouvir' },
  { id: 'toggle-share', label: 'Compartilhar / parar a tela' },
  { id: 'leave-call', label: 'Sair da call' },
  { id: 'show-window', label: 'Mostrar o Resenha' },
]

const NAMED: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Pause: 'Pause',
  ScrollLock: 'Scrolllock',
  PrintScreen: 'PrintScreen',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
}

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code
  if (/^Numpad\d$/.test(code)) return `num${code.slice(6)}`
  return NAMED[code] ?? null
}

/** Tecla apertada -> accelerator. Exige modificador, menos nas teclas F e de mídia/pausa. */
export function acceleratorFrom(event: KeyboardEvent): string | null {
  const key = keyName(event.code)
  if (!key) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')
  if (parts.length === 0 && !/^(F\d+|Pause|Scrolllock|PrintScreen|Insert)$/.test(key)) return null
  return [...parts, key].join('+')
}

export function describeAccelerator(accelerator: string | null, platform: string): string {
  if (!accelerator) return 'Nenhum'
  return accelerator
    .split('+')
    .map((part) =>
      part === 'CommandOrControl'
        ? 'Ctrl'
        : part === 'Super'
          ? platform === 'win32'
            ? 'Win'
            : 'Super'
          : part.replace(/^num(\d)$/, 'Num $1').replace(/^Up$/, '↑').replace(/^Down$/, '↓').replace(/^Left$/, '←').replace(/^Right$/, '→'),
    )
    .join(' + ')
}
