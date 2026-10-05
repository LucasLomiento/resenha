const COLORS = ['#e8875b', '#5fb3a1', '#7c8cff', '#d873c8', '#e5b94e', '#5aa7e0', '#9bcf6a', '#ef6f7f']

export function userColor(id: string): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

export function formatTime(ms: number): string {
  return timeFmt.format(ms)
}

export function formatStamp(ms: number): string {
  const date = new Date(ms)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (date.toDateString() === today.toDateString()) return `Hoje às ${timeFmt.format(date)}`
  if (date.toDateString() === yesterday.toDateString()) return `Ontem às ${timeFmt.format(date)}`
  return `${dateFmt.format(date)} ${timeFmt.format(date)}`
}

export function formatDay(ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(ms)
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatBitrate(bps: number): string {
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bps / 1000)} kbps`
}

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'block'; text: string }

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g

function linkify(text: string, out: Segment[]) {
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    if (match.index! > last) out.push({ kind: 'text', text: text.slice(last, match.index) })
    out.push({ kind: 'link', text: match[0] })
    last = match.index! + match[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
}

/** Texto da mensagem em pedaços: ```bloco```, `código`, links e texto puro. */
export function parseMessage(content: string): Segment[] {
  const out: Segment[] = []
  const re = /```(?:[\w-]*\n)?([\s\S]*?)```|`([^`\n]+)`/g
  let last = 0
  for (const match of content.matchAll(re)) {
    if (match.index! > last) linkify(content.slice(last, match.index), out)
    if (match[1] !== undefined) out.push({ kind: 'block', text: match[1].replace(/\n$/, '') })
    else out.push({ kind: 'code', text: match[2] })
    last = match.index! + match[0].length
  }
  if (last < content.length) linkify(content.slice(last), out)
  return out
}
