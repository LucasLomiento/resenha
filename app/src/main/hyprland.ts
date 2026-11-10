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
import type { DesktopPrefs, ShortcutAction, ShortcutId } from '../preload/api'
import { onLocaleChange, tm } from './i18n'
import { keyCombo, type Modifier } from './keysym'

const PREFIX = 'resenha:'
/** Descrição dos binds do app: é por ela que ele reconhece os seus (o resto é da config da pessoa). */
const DESCRIPTION = 'Resenha: '

const ACTIONS: ShortcutAction[] = ['toggle-mute', 'toggle-deafen', 'toggle-share', 'leave-call', 'show-window']
/** Apertar pra falar: um evento quando a tecla desce e outro quando sobe. */
const TALK_DOWN = 'ptt-down'
const TALK_UP = 'ptt-up'

/** Bit de cada modificador no `modmask` que o `hyprctl binds -j` mostra. */
const BITS: Record<Modifier, number> = { SHIFT: 1, CTRL: 4, ALT: 8, SUPER: 64 }

export interface HyprCombo {
  /** Como vai no `hl.bind`: "CTRL + SHIFT + M". */
  keys: string
  modmask: number
  key: string
}

/** "CommandOrControl+Shift+M" -> { keys: "CTRL + SHIFT + M", modmask: 5, key: "M" }; null se não der. */
export function hyprCombo(accelerator: string): HyprCombo | null {
  const combo = keyCombo(accelerator)
  if (!combo) return null
  const modmask = combo.mods.reduce((mask, mod) => mask | BITS[mod], 0)
  return { keys: [...combo.mods, combo.key].join(' + '), modmask, key: combo.key }
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

/**
 * Os dois binds do apertar pra falar: um quando a tecla desce e um quando sobe. Nenhum "come"
 * a tecla (o jogo em foco continua recebendo). Tecla sem modificador vale com qualquer
 * modificador apertado (Shift correndo no jogo); a subida vale sempre, senão soltar o Ctrl
 * antes da tecla deixava o microfone aberto.
 */
export function talkBinds(combo: HyprCombo, label: string): string[] {
  const description = `description = ${lua(DESCRIPTION + label)}`
  const anyMods = combo.modmask === 0 ? ', ignore_mods = true' : ''
  return [
    `hl.bind(${lua(combo.keys)}, hl.dsp.event(${lua(PREFIX + TALK_DOWN)}), { ${description}, non_consuming = true${anyMods} })`,
    `hl.bind(${lua(combo.keys)}, hl.dsp.event(${lua(PREFIX + TALK_UP)}), { ${description}, release = true, non_consuming = true, ignore_mods = true })`,
  ]
}

/** Linha do socket de eventos do Hyprland -> o que o app faz com ela (null: não é do app). */
export function hyprEvent(line: string): { action: ShortcutAction } | { talk: boolean } | null {
  if (!line.startsWith(`custom>>${PREFIX}`)) return null
  const name = line.slice(`custom>>${PREFIX}`.length)
  if (name === TALK_DOWN || name === TALK_UP) return { talk: name === TALK_DOWN }
  return ACTIONS.includes(name as ShortcutAction) ? { action: name as ShortcutAction } : null
}

let wanted = {} as DesktopPrefs['shortcuts']
let onAction: (action: ShortcutAction) => void = () => {}
let onTalk: (down: boolean) => void = () => {}
/** Avisado a cada vez que os binds são refeitos (config recarregada, idioma trocado, Hyprland reiniciado). */
let onResult: (failed: ShortcutId[]) => void = () => {}
let events: Socket | null = null
let stopped = false
/** Uma passada por vez (mudança nas configurações e config recarregada podem chegar juntas). */
let queue: Promise<ShortcutId[]> = Promise.resolve([])

/**
 * Troca os binds do app pelos atalhos escolhidos e devolve os que não deu: tecla que o
 * Hyprland não conhece, ou já usada pela config da pessoa (aí o app não mexe).
 */
export function setHyprShortcuts(
  shortcuts: DesktopPrefs['shortcuts'],
  dispatch: (action: ShortcutAction) => void,
  talk: (down: boolean) => void = () => {},
  result: (failed: ShortcutId[]) => void = () => {},
): Promise<ShortcutId[]> {
  wanted = shortcuts
  onAction = dispatch
  onTalk = talk
  onResult = result
  stopped = false
  listen()
  return reapply()
}

function reapply(): Promise<ShortcutId[]> {
  // O resultado vai sempre pra quem pediu: uma tecla que passou a ter uso na config do Hyprland
  // (ou deixou de ter) depois de o app abrir era recusada (ou aceita) sem a interface saber, e a
  // tecla de falar ficava muda com o aviso dizendo "segure a tecla".
  queue = queue.then(apply, apply).then((failed) => {
    onResult(failed)
    return failed
  })
  return queue
}

async function apply(): Promise<ShortcutId[]> {
  const configured: ShortcutId[] = [...ACTIONS.filter((action) => wanted[action]), ...(wanted['push-to-talk'] ? (['push-to-talk'] as const) : [])]
  let binds: HyprBind[]
  try {
    binds = (JSON.parse(await hyprctl(['binds', '-j'])) as HyprBind[]).filter((b) => !b.submap)
  } catch {
    return configured
  }
  const lines = unbindMine(binds)
  const failed: ShortcutId[] = []
  const labels = tm().shortcuts
  for (const action of configured) {
    const combo = hyprCombo(wanted[action]!)
    if (!combo || binds.some((b) => !isMine(b) && sameKey(b, combo))) {
      failed.push(action)
      continue
    }
    if (action === 'push-to-talk') lines.push(...talkBinds(combo, labels[action]))
    else lines.push(`hl.bind(${lua(combo.keys)}, hl.dsp.event(${lua(PREFIX + action)}), { description = ${lua(DESCRIPTION + labels[action])} })`)
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
      const event = hyprEvent(line)
      if (event && 'talk' in event) onTalk(event.talk)
      else if (event) onAction(event.action)
      else if (line.startsWith('configreloaded>>')) {
        // Os binds somem com a config: se a tecla estava apertada, a subida não ia chegar.
        onTalk(false)
        clearTimeout(reload)
        reload = setTimeout(() => void reapply(), 300)
      }
    }
  })
  // Caiu (o Hyprland reiniciou): tenta de novo daqui a pouco, e refaz os binds.
  socket.on('close', () => {
    if (events === socket) events = null
    // Sem os eventos, a subida da tecla não chega: o microfone não fica aberto por engano.
    onTalk(false)
    if (!stopped) setTimeout(() => (listen(), void reapply()), 2000)
  })
  socket.on('error', () => {})
}

/** Ao fechar o app: tira os binds (senão a tecla fica presa num evento que ninguém escuta). */
export function clearHyprShortcuts() {
  stopped = true
  // O socket fecha depois, com a janela já fechada: ninguém mais pra avisar.
  onTalk = () => {}
  onResult = () => {}
  events?.destroy()
  events = null
  // Perfil de teste (e2e, capturas) não cria binds: os que estão lá são do app de verdade aberto.
  if (!hasHyprland()) return
  try {
    // Síncrono: o app está saindo.
    const binds = (JSON.parse(execFileSync('hyprctl', ['binds', '-j'], { timeout: 2000, encoding: 'utf8' })) as HyprBind[]).filter((b) => !b.submap)
    const lines = unbindMine(binds)
    if (lines.length) execFileSync('hyprctl', ['eval', lines.join('\n')], { timeout: 2000 })
  } catch {
    // o Hyprland já foi
  }
}
