import type { Presence, Status } from '../../shared/protocol'

/**
 * Status visível de quem tem várias conexões (vários aparelhos): vale o "mais
 * online". Invisível conta como offline, e o texto dele não aparece.
 */
export function aggregate(states: { status?: Status; text?: string | null }[]): Presence {
  const visible = states.filter((s) => (s.status ?? 'online') !== 'invisible')
  if (visible.length === 0) return { status: 'offline', text: null }
  const statuses = visible.map((s) => s.status ?? 'online')
  const status = statuses.includes('online') ? 'online' : statuses.includes('dnd') ? 'dnd' : 'idle'
  return { status, text: visible.find((s) => s.text)?.text ?? null }
}

export function samePresence(a: Presence, b: Presence): boolean {
  return a.status === b.status && a.text === b.text
}
