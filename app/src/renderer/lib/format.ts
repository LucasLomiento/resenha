import { fmt, i18n, m } from './i18n.svelte'

// Cores das pessoas: um degradê por id, sempre o mesmo. As duplas seguem o
// ícone do app (violeta, roxo, coral) e vão até o verde e o azul pra variar.
const GRADIENTS: [string, string][] = [
  ['#8b7bff', '#b56dff'], // violeta
  ['#ff7a93', '#ffa070'], // coral
  ['#48b9ff', '#6a6cff'], // oceano
  ['#36d6ad', '#36a9dd'], // menta
  ['#ffc35a', '#ff8160'], // sol
  ['#ee78dc', '#9663ff'], // orquídea
  ['#9edc66', '#36c492'], // lima
  ['#ff86ad', '#cf74ff'], // rosa
]

function hashOf(id: string): number {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(hash)
}

/** Cor sólida da pessoa (primeira do degradê), pra tingir fundos. */
export function userColor(id: string): string {
  return GRADIENTS[hashOf(id) % GRADIENTS.length][0]
}

/** As duas cores do degradê da pessoa. */
export function userColors(id: string): [string, string] {
  return GRADIENTS[hashOf(id) % GRADIENTS.length]
}

/** Degradê do avatar (sem foto). */
export function userGradient(id: string): string {
  const [a, b] = userColors(id)
  return `linear-gradient(135deg, ${a}, ${b})`
}

/** Palavras que não entram nas iniciais ("Mesa de RPG" vira MR). */
const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'the', 'of'])

export function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w && !CONNECTORS.has(w.toLowerCase()))
  // Só a primeira palavra quando a segunda veio entre parênteses ou é um apelido solto.
  const first = words[0]?.[0] ?? name.trim()[0] ?? '?'
  const second = /\(/.test(name) ? '' : (words[1]?.[0] ?? '')
  return (first + second).toUpperCase()
}

// Datas no idioma em uso (o `fmt` guarda um formatador por idioma e opções).
const FULL = { dateStyle: 'full', timeStyle: 'short' } as const
const DAY = { weekday: 'long', day: 'numeric', month: 'long' } as const
const DAY_YEAR = { day: 'numeric', month: 'long', year: 'numeric' } as const
const SHORT_DATE = { day: '2-digit', month: '2-digit', year: '2-digit' } as const

/** "14:32" em português; em inglês e espanhol a hora vai sem zero na frente ("2:32 PM"). */
export function formatTime(ms: number | Date): string {
  return fmt.date(ms, { hour: i18n.locale === 'pt' ? '2-digit' : 'numeric', minute: '2-digit' })
}

/** Data e hora por extenso, pra dica do horário da mensagem. */
export function formatFull(ms: number): string {
  const text = fmt.date(ms, FULL)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString()
}

/** Horário ao lado do nome: "14:32" hoje, "Ontem 14:32", "03/10/26 14:32". */
export function formatStamp(ms: number): string {
  const date = new Date(ms)
  const today = new Date()
  if (sameDay(date, today)) return formatTime(date)
  if (sameDay(date, new Date(today.getTime() - 86_400_000))) return m.lib.format.yesterdayAt(formatTime(date))
  return `${fmt.date(date, SHORT_DATE)} ${formatTime(date)}`
}

/** Divisória de dia no chat: "Hoje", "Ontem", "sexta, 3 de outubro" ou com ano, se for de outro ano. */
export function formatDay(ms: number): string {
  const date = new Date(ms)
  const today = new Date()
  if (sameDay(date, today)) return m.lib.format.today
  if (sameDay(date, new Date(today.getTime() - 86_400_000))) return m.lib.format.yesterday
  const text = fmt.date(date, date.getFullYear() === today.getFullYear() ? DAY : DAY_YEAR)
  // "sexta-feira" vira "sexta" (só existe em português).
  return text.replace('-feira', '')
}

/** Uma casa depois da vírgula (do ponto, em inglês), sem separar milhar: "1,5 MB", "4096,0 MB". */
const SIZE_MB = { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false } as const

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${fmt.number(bytes / 1024 / 1024, SIZE_MB)} MB`
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
