// Atalhos globais pelo portal do sistema (org.freedesktop.portal.GlobalShortcuts), no
// Wayland fora do Hyprland (KDE, GNOME 48+). O Chromium do Electron também fala com esse
// portal, mas pula o BindShortcuts quando o ListShortcuts já devolve os atalhos de antes; e
// desde o xdg-desktop-portal-kde 6.7.4 o atalho só fica ativo com BindShortcuts na sessão
// atual. Resultado: no KDE, funcionava só na primeira vez. Aqui o app abre a sessão e faz o
// bind toda vez que abre (como o KeePassXC, PR #13579); no KDE, atalho que já existe não abre
// diálogo. Sem nada do Electron aqui: o teste roda no Node, contra o portal de verdade.

import dbus, { Message, Variant, type MessageBus } from 'dbus-next'
import type { DesktopPrefs, ShortcutAction } from '../preload/api'
import { onLocaleChange, tm } from './i18n'
import { keyCombo } from './keysym'

const PORTAL = 'org.freedesktop.portal.Desktop'
const PORTAL_PATH = '/org/freedesktop/portal/desktop'
const SHORTCUTS = 'org.freedesktop.portal.GlobalShortcuts'
const ACTIONS: ShortcutAction[] = ['toggle-mute', 'toggle-deafen', 'toggle-share', 'leave-call', 'show-window']
/** BindShortcuts pode esperar a pessoa responder o diálogo do sistema (atalho novo). */
const BIND_TIMEOUT = 5 * 60_000

/**
 * "CommandOrControl+Shift+M" -> "CTRL+SHIFT+M", no formato do portal (modificadores
 * SHIFT, CTRL, ALT, LOGO e o nome da tecla no xkb); null se não der.
 */
export function xdgTrigger(accelerator: string): string | null {
  const combo = keyCombo(accelerator)
  return combo ? [...combo.mods.map((mod) => (mod === 'SUPER' ? 'LOGO' : mod)), combo.key].join('+') : null
}

/**
 * Id do atalho no portal: a ação e a tecla. Trocar a tecla no Resenha vira um atalho novo
 * (o sistema guarda a tecla de cada id e ignoraria a sugestão nova num id que já existe).
 */
export const shortcutId = (action: ShortcutAction, trigger: string) => `${action}@${trigger}`

const actionOf = (id: string) => ACTIONS.find((action) => id.startsWith(`${action}@`)) ?? null

/** Wayland fora do Hyprland, e fora de um perfil de teste (e2e, capturas). */
export function usesPortalShortcuts(): boolean {
  if (process.platform !== 'linux' || process.env.RESENHA_PROFILE) return false
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE) return false
  return process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY
}

/** Id do app pro portal: o nome do .desktop (o mesmo que o Chromium usava). */
const appId = () => (process.env.CHROME_DESKTOP ?? 'resenha.desktop').replace(/\.desktop$/, '')

let bus: MessageBus | null = null
let connecting: Promise<MessageBus> | null = null
let session: string | null = null
let wanted = {} as DesktopPrefs['shortcuts']
let onAction: (action: ShortcutAction) => void = () => {}
/** Respostas esperadas dos pedidos ao portal, pelo caminho do objeto Request. */
const responses = new Map<string, (code: number, results: Record<string, Variant>) => void>()
let tokens = 0
/** Uma troca por vez (abrir o app e mudar o atalho podem chegar juntos). */
let queue: Promise<ShortcutAction[]> = Promise.resolve([])

function connect(): Promise<MessageBus> {
  if (bus) return Promise.resolve(bus)
  connecting ??= new Promise<MessageBus>((resolve, reject) => {
    const next = dbus.sessionBus()
    const fail = (err: unknown) => {
      connecting = null
      reject(err)
    }
    next.once('error', fail)
    next.once('connect', async () => {
      next.off('error', fail)
      next.on('error', () => {}) // o barramento caiu: o próximo `setPortalShortcuts` reconecta
      next.on('message', received)
      try {
        // Sinais: as respostas dos pedidos e o atalho apertado.
        await addMatch(next, "type='signal',interface='org.freedesktop.portal.Request',member='Response'")
        await addMatch(next, `type='signal',interface='${SHORTCUTS}'`)
        // Diz ao portal quem é o app (precisa vir antes de qualquer outra chamada). Precisa do
        // .desktop instalado com esse nome; portal antigo não tem o Register e descobre sozinho.
        await call(next, PORTAL_PATH, 'org.freedesktop.host.portal.Registry', 'Register', 'sa{sv}', [appId(), {}]).catch((err) =>
          console.warn('atalhos globais: o portal não registrou o app', err?.text ?? err),
        )
        bus = next
        resolve(next)
      } catch (err) {
        next.disconnect()
        fail(err)
      }
    })
  })
  return connecting
}

function addMatch(target: MessageBus, rule: string) {
  return target.call(
    new Message({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'AddMatch', signature: 's', body: [rule] }),
  )
}

function call(target: MessageBus, path: string, iface: string, member: string, signature: string, body: unknown[]) {
  return target.call(new Message({ destination: PORTAL, path, interface: iface, member, signature, body }))
}

function received(msg: Message) {
  if (msg.type !== dbus.MessageType.SIGNAL) return
  if (msg.interface === 'org.freedesktop.portal.Request' && msg.member === 'Response') {
    const settle = responses.get(msg.path)
    if (!settle) return
    responses.delete(msg.path)
    settle(msg.body[0] as number, (msg.body[1] ?? {}) as Record<string, Variant>)
  } else if (msg.interface === SHORTCUTS && msg.member === 'Activated') {
    const [from, id] = msg.body as [string, string]
    const action = from === session ? actionOf(id) : null
    if (action) onAction(action)
  }
}

/**
 * Pedido ao portal que responde depois, pelo sinal Response do objeto Request. O caminho
 * desse objeto é previsível (nome da conexão + token): fica esperando antes de chamar, pra
 * não perder uma resposta rápida.
 */
async function request(target: MessageBus, member: string, signature: string, body: (token: string) => unknown[], timeout: number) {
  const token = `resenha${process.pid}_${++tokens}`
  const sender = ((target as unknown as { name: string }).name ?? '').replace(/^:/, '').replace(/\./g, '_')
  const expected = `${PORTAL_PATH}/request/${sender}/${token}`
  return new Promise<{ code: number; results: Record<string, Variant> }>((resolve, reject) => {
    const timer = setTimeout(() => {
      responses.delete(expected)
      reject(new Error(`${member}: o portal não respondeu`))
    }, timeout)
    const settle = (code: number, results: Record<string, Variant>) => {
      clearTimeout(timer)
      resolve({ code, results })
    }
    responses.set(expected, settle)
    call(target, PORTAL_PATH, SHORTCUTS, member, signature, body(token)).then(
      (reply) => {
        // Portal antigo pode devolver outro caminho: passa a esperar por ele.
        const path = reply?.body[0] as string | undefined
        if (path && path !== expected && responses.get(expected) === settle) {
          responses.delete(expected)
          responses.set(path, settle)
        }
      },
      (err) => {
        clearTimeout(timer)
        responses.delete(expected)
        reject(err)
      },
    )
  })
}

function closeSession(target: MessageBus | null) {
  if (!session || !target) return
  target.send(new Message({ destination: PORTAL, path: session, interface: 'org.freedesktop.portal.Session', member: 'Close' }))
  session = null
}

/**
 * Troca os atalhos: fecha a sessão de antes, abre outra e faz o bind de todos. Devolve os
 * que não ficaram ativos (portal sem atalhos, pessoa recusou no diálogo, tecla inválida).
 */
export function setPortalShortcuts(shortcuts: DesktopPrefs['shortcuts'], dispatch: (action: ShortcutAction) => void): Promise<ShortcutAction[]> {
  wanted = shortcuts
  onAction = dispatch
  queue = queue.then(apply, apply)
  return queue
}

async function apply(): Promise<ShortcutAction[]> {
  const configured = ACTIONS.filter((action) => wanted[action])
  let target: MessageBus
  try {
    target = await connect()
  } catch (err) {
    console.warn('atalhos globais: sem o barramento do sistema', err)
    return configured
  }
  closeSession(target)
  const labels = tm().shortcuts
  const list: [string, Record<string, Variant>][] = []
  const failed: ShortcutAction[] = []
  for (const action of configured) {
    const trigger = xdgTrigger(wanted[action]!)
    if (!trigger) {
      failed.push(action)
      continue
    }
    const label = labels[action]
    list.push([
      shortcutId(action, trigger),
      { description: new Variant('s', label.charAt(0).toUpperCase() + label.slice(1)), preferred_trigger: new Variant('s', trigger) },
    ])
  }
  if (!list.length) return failed
  try {
    const created = await request(
      target,
      'CreateSession',
      'a{sv}',
      (token) => [{ handle_token: new Variant('s', token), session_handle_token: new Variant('s', token) }],
      10_000,
    )
    const handle = created.results.session_handle?.value as string | undefined
    if (created.code !== 0 || !handle) {
      console.warn('atalhos globais: o portal não abriu a sessão', created.code)
      return configured
    }
    session = handle
    const bound = await request(target, 'BindShortcuts', 'oa(sa{sv})sa{sv}', (token) => [handle, list, '', { handle_token: new Variant('s', token) }], BIND_TIMEOUT)
    if (bound.code !== 0) {
      console.warn('atalhos globais: o portal recusou os atalhos', bound.code)
      return configured
    }
    // O portal devolve os que ficaram ativos; sem a lista (portal antigo), vale o que foi pedido.
    const active = bound.results.shortcuts?.value as [string, unknown][] | undefined
    const ids = new Set(active ? active.map(([id]) => id) : list.map(([id]) => id))
    for (const [id] of list) {
      const action = actionOf(id)
      if (action && !ids.has(id)) failed.push(action)
    }
    return failed
  } catch (err) {
    console.warn('atalhos globais: o portal falhou', err)
    return configured
  }
}

// A descrição de cada atalho aparece nas configurações do sistema: acompanha o idioma.
onLocaleChange(() => {
  if (session) void setPortalShortcuts(wanted, onAction)
})

/** Ao fechar o app: fecha a sessão (o sistema para de mandar os atalhos pra ele). */
export function clearPortalShortcuts() {
  closeSession(bus)
  bus?.disconnect()
  bus = null
  connecting = null
}
