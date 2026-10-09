// Atalhos globais no Hyprland. O Hyprland não liga tecla nenhuma aos atalhos do portal
// (o Chromium registra com um id sorteado e ninguém faz o bind), então eles só funcionavam
// com a janela em foco. Aqui o app cria os binds sozinho, em tempo de execução
// (`hl.bind` pelo `hyprctl eval`), cada um disparando `hl.dsp.event("resenha:<ação>")`, e
// escuta esses eventos no socket2 do Hyprland. Os binds somem quando a config recarrega
// (o app refaz ao ver o `configreloaded`) e quando o app fecha (o app tira).

import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import type { DesktopPrefs, ShortcutAction } from '../preload/api'
import { onLocaleChange, tm } from './i18n'

const PREFIX = 'resenha:'
/** Descrição dos binds do app: é por ela que ele reconhece os seus (o resto é da config da pessoa). */
const DESCRIPTION = 'Resenha: '

const ACTIONS: ShortcutAction[] = ['toggle-mute', 'toggle-deafen', 'toggle-share', 'leave-call', 'show-window']

const MODS: Record<string, { name: string; bit: number }> = {
  Shift: { name: 'SHIFT', bit: 1 },
  CommandOrControl: { name: 'CTRL', bit: 4 },
  Control: { name: 'CTRL', bit: 4 },
  Ctrl: { name: 'CTRL', bit: 4 },
  Alt: { name: 'ALT', bit: 8 },
  Super: { name: 'SUPER', bit: 64 },
  Meta: { name: 'SUPER', bit: 64 },
}

/** Tecla do accelerator do Electron -> nome do keysym do xkb (o que o Hyprland entende). */
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

export interface HyprCombo {
  /** Como vai no `hl.bind`: "CTRL + SHIFT + M". */
  keys: string
  modmask: number
  key: string
}

/** "CommandOrControl+Shift+M" -> { keys: "CTRL + SHIFT + M", modmask: 5, key: "M" }; null se não der. */
export function hyprCombo(accelerator: string): HyprCombo | null {
  const parts = accelerator.split('+')
  // "+" sozinho como tecla não existe no app (vira "numadd" ou "=" com Shift).
  const last = parts.pop()
  if (!last) return null
  let modmask = 0
  const mods: string[] = []
  for (const part of parts) {
    const mod = MODS[part]
    if (!mod) return null
    if (modmask & mod.bit) continue
    modmask |= mod.bit
    mods.push(mod.name)
  }
  const key = /^[A-Z0-9]$/.test(last) || /^F\d{1,2}$/.test(last) ? last : /^num\d$/.test(last) ? `KP_${last.slice(3)}` : KEYS[last]
  if (!key) return null
  return { keys: [...mods, key].join(' + '), modmask, key }
}

interface HyprBind {
  modmask: number
  key: string
  description: string
  submap: string
}

/** Lua em string: o JSON serve (aspas e barras escapadas do mesmo jeito). */
const lua = (text: string) => JSON.stringify(text)

export const hyprlandSocket = (name: '.socket.sock' | '.socket2.sock') => {
  const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE
  const runtime = process.env.XDG_RUNTIME_DIR
  return signature && runtime ? join(runtime, 'hypr', signature, name) : null
}

/** Hyprland rodando, com o socket de eventos, e o app fora de um perfil de teste (e2e, capturas). */
export function hasHyprland(): boolean {
  const events = hyprlandSocket('.socket2.sock')
  return !process.env.RESENHA_PROFILE && !!events && existsSync(events)
}

function hyprctl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('hyprctl', args, { timeout: 3000 }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  )
}

const isMine = (bind: HyprBind) => bind.description?.startsWith(DESCRIPTION) ?? false
const sameKey = (a: { modmask: number; key: string }, b: { modmask: number; key: string }) =>
  a.modmask === b.modmask && a.key.toLowerCase() === b.key.toLowerCase()

/** modmask + tecla -> "CTRL + SHIFT + M" (o que o `hl.unbind` recebe). */
function keysOf(bind: { modmask: number; key: string }): string {
  const mods = [
    [64, 'SUPER'],
    [4, 'CTRL'],
    [8, 'ALT'],
    [1, 'SHIFT'],
  ] as const
  return [...mods.filter(([bit]) => bind.modmask & bit).map(([, name]) => name), bind.key].join(' + ')
}

/**
 * Os `hl.unbind` dos binds do app que estão no Hyprland (deste app aberto ou de um que
 * travou). Combinação que também tem bind da config fica: o `unbind` tiraria os dois.
 */
function unbindMine(binds: HyprBind[]): string[] {
  const lines = new Set<string>()
  for (const bind of binds.filter(isMine)) {
    if (binds.some((other) => !isMine(other) && sameKey(other, bind))) continue
    lines.add(`hl.unbind(${lua(keysOf(bind))})`)
  }
  return [...lines]
}

let wanted = {} as DesktopPrefs['shortcuts']
let onAction: (action: ShortcutAction) => void = () => {}
let events: Socket | null = null
let stopped = false
/** Uma passada por vez (mudança nas configurações e config recarregada podem chegar juntas). */
let queue: Promise<ShortcutAction[]> = Promise.resolve([])

/**
 * Troca os binds do app pelos atalhos escolhidos e devolve os que não deu: tecla que o
 * Hyprland não conhece, ou já usada pela config da pessoa (aí o app não mexe).
 */
export function setHyprShortcuts(shortcuts: DesktopPrefs['shortcuts'], dispatch: (action: ShortcutAction) => void): Promise<ShortcutAction[]> {
  wanted = shortcuts
  onAction = dispatch
  stopped = false
  listen()
  return reapply()
}

function reapply(): Promise<ShortcutAction[]> {
  queue = queue.then(apply, apply)
  return queue
}

async function apply(): Promise<ShortcutAction[]> {
  const configured = ACTIONS.filter((action) => wanted[action])
  let binds: HyprBind[]
  try {
    binds = (JSON.parse(await hyprctl(['binds', '-j'])) as HyprBind[]).filter((b) => !b.submap)
  } catch {
    return configured
  }
  const lines = unbindMine(binds)
  const failed: ShortcutAction[] = []
  const labels = tm().shortcuts
  for (const action of configured) {
    const combo = hyprCombo(wanted[action]!)
    if (!combo || binds.some((b) => !isMine(b) && sameKey(b, combo))) {
      failed.push(action)
      continue
    }
    lines.push(`hl.bind(${lua(combo.keys)}, hl.dsp.event(${lua(PREFIX + action)}), { description = ${lua(DESCRIPTION + labels[action])} })`)
  }
  if (!lines.length) return failed
  try {
    await hyprctl(['eval', lines.join('\n')])
    return failed
  } catch {
    return configured
  }
}

// A descrição dos binds aparece na lista de atalhos do sistema: acompanha o idioma.
onLocaleChange(() => {
  if (events) void reapply()
})

/** Escuta os eventos do Hyprland: o atalho apertado e a config recarregada (que apaga os binds). */
function listen() {
  if (events || stopped) return
  const path = hyprlandSocket('.socket2.sock')
  if (!path) return
  let buffer = ''
  let reload: ReturnType<typeof setTimeout> | undefined
  const socket = connect(path)
  events = socket
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith(`custom>>${PREFIX}`)) {
        const action = line.slice(`custom>>${PREFIX}`.length) as ShortcutAction
        if (ACTIONS.includes(action)) onAction(action)
      } else if (line.startsWith('configreloaded>>')) {
        clearTimeout(reload)
        reload = setTimeout(() => void reapply(), 300)
      }
    }
  })
  // Caiu (o Hyprland reiniciou): tenta de novo daqui a pouco, e refaz os binds.
  socket.on('close', () => {
    if (events === socket) events = null
    if (!stopped) setTimeout(() => (listen(), void reapply()), 2000)
  })
  socket.on('error', () => {})
}

/** Ao fechar o app: tira os binds (senão a tecla fica presa num evento que ninguém escuta). */
export function clearHyprShortcuts() {
  stopped = true
  events?.destroy()
  events = null
  try {
    // Síncrono: o app está saindo.
    const binds = (JSON.parse(execFileSync('hyprctl', ['binds', '-j'], { timeout: 2000, encoding: 'utf8' })) as HyprBind[]).filter((b) => !b.submap)
    const lines = unbindMine(binds)
    if (lines.length) execFileSync('hyprctl', ['eval', lines.join('\n')], { timeout: 2000 })
  } catch {
    // o Hyprland já foi
  }
}
