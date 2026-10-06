// Formatação das mensagens, no mesmo estilo do Discord. O resultado é uma
// árvore de dados (nunca HTML): a interface monta os elementos, então nada que
// alguém escreva vira código na tela.

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler'; children: Inline[] }
  | { t: 'link'; url: string }
  | { t: 'user'; id: string }
  | { t: 'role'; id: string }
  | { t: 'channel'; id: string }
  | { t: 'everyone'; text: '@everyone' | '@here' }
  | { t: 'br' }

export type Block =
  | { t: 'paragraph'; children: Inline[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; children: Block[] }
  | { t: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: Inline[][] }

interface Rule {
  re: RegExp
  make(match: RegExpExecArray, before: string): Inline | null
}

const wrap = (t: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler') => (m: RegExpExecArray) =>
  ({ t, children: parseInline(m[1]) }) as Inline

/** Fim de link: pontuação final fica de fora; parêntese só se sobrar. */
function trimUrl(raw: string): string {
  let url = raw
  for (;;) {
    const last = url.at(-1)
    if (last && '.,;:!?\'"]}*_~'.includes(last)) url = url.slice(0, -1)
    else if (last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1)
    else return url
  }
}

const RULES: Rule[] = [
  // \* escreve o asterisco em vez de formatar.
  { re: /\\([^\w\s])/y, make: (m) => ({ t: 'text', text: m[1] }) },
  {
    re: /(`+)([\s\S]*?[^`])\1(?!`)/y,
    make: (m) => {
      const text = m[2].startsWith(' ') && m[2].endsWith(' ') && m[2].trim() ? m[2].slice(1, -1) : m[2]
      return { t: 'code', text }
    },
  },
  { re: /<@!?([\w-]{1,64})>/y, make: (m) => ({ t: 'user', id: m[1] }) },
  { re: /<@&([\w-]{1,64})>/y, make: (m) => ({ t: 'role', id: m[1] }) },
  { re: /<#([\w-]{1,64})>/y, make: (m) => ({ t: 'channel', id: m[1] }) },
  {
    re: /@(everyone|here)(?![\w])/y,
    make: (m, before) => (/\w$/.test(before) ? null : { t: 'everyone', text: `@${m[1]}` as '@everyone' | '@here' }),
  },
  // <https://...> é link sem prévia.
  { re: /<(https?:\/\/[^\s<>]+)>/y, make: (m) => ({ t: 'link', url: m[1] }) },
  {
    re: /https?:\/\/[^\s<>"'`]+/y,
    make: (m) => {
      const url = trimUrl(m[0])
      return url.length > 'https://'.length ? { t: 'link', url } : null
    },
  },
  { re: /\*\*([\s\S]+?)\*\*(?!\*)/y, make: wrap('bold') },
  { re: /__([\s\S]+?)__(?!_)/y, make: wrap('underline') },
  { re: /\*(?=\S)([\s\S]*?\S)\*(?!\*)/y, make: wrap('italic') },
  {
    re: /_(?=\S)([\s\S]*?\S)_(?![_\w])/y,
    // nome_de_arquivo não vira itálico: o _ precisa estar no começo de palavra.
    make: (m, before) => (/\w$/.test(before) ? null : wrap('italic')(m)),
  },
  { re: /~~([\s\S]+?)~~/y, make: wrap('strike') },
  { re: /\|\|([\s\S]+?)\|\|/y, make: wrap('spoiler') },
  { re: /\n/y, make: () => ({ t: 'br' }) },
]

const SPECIAL = /[\\`<@*_~|\nh]/

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) out.push({ t: 'text', text: buffer })
    buffer = ''
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    let matched = false
    if (SPECIAL.test(ch)) {
      for (const rule of RULES) {
        rule.re.lastIndex = i
        const m = rule.re.exec(text)
        if (!m) continue
        const node = rule.make(m, buffer || text.slice(Math.max(0, i - 1), i))
        if (!node) continue
        flush()
        // O link pode ter perdido pontuação do fim: ela volta como texto.
        const used = node.t === 'link' && !m[0].startsWith('<') ? node.url.length : m[0].length
        out.push(node)
        i += used
        matched = true
        break
      }
    }
    if (!matched) {
      buffer += ch
      i += 1
    }
  }
  flush()
  return out
}

/** Linhas (sem bloco de código) → citações, títulos, listas e parágrafos. */
function parseLines(text: string, allowQuote = true): Block[] {
  const blocks: Block[] = []
  const lines = text.split('\n')
  let paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ t: 'paragraph', children: parseInline(paragraph.join('\n')) })
    paragraph = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (allowQuote && line.startsWith('>>> ')) {
      flushParagraph()
      blocks.push({ t: 'quote', children: parseLines([line.slice(4), ...lines.slice(i + 1)].join('\n'), false) })
      return blocks
    }
    if (allowQuote && /^> ?/.test(line) && line !== '>') {
      flushParagraph()
      const quoted: string[] = []
      while (i < lines.length && /^> ?/.test(lines[i]) && lines[i] !== '>') quoted.push(lines[i++].replace(/^> ?/, ''))
      i -= 1
      blocks.push({ t: 'quote', children: parseLines(quoted.join('\n'), false) })
      continue
    }
    const heading = /^(#{1,3}) (\S.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ t: 'heading', level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2]) })
      continue
    }
    const bullet = /^(\s*)[-*] (\S.*)$/.exec(line)
    const numbered = /^(\s*)(\d{1,9})\. (\S.*)$/.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = !!numbered
      const items: Inline[][] = []
      const start = numbered ? Number(numbered[2]) : 1
      while (i < lines.length) {
        const b = /^\s*[-*] (\S.*)$/.exec(lines[i])
        const n = /^\s*\d{1,9}\. (\S.*)$/.exec(lines[i])
        const item = ordered ? n : b
        if (!item) break
        items.push(parseInline(item[1]))
        i += 1
      }
      i -= 1
      blocks.push({ t: 'list', ordered, start, items })
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  return blocks
}

export function parseMarkdown(content: string): Block[] {
  const blocks: Block[] = []
  const fence = /```(?:([\w+#.-]{1,20})\n)?\n?([\s\S]*?)```/g
  let last = 0
  for (const m of content.matchAll(fence)) {
    const before = content.slice(last, m.index).replace(/\n$/, '')
    if (before.trim()) blocks.push(...parseLines(before))
    blocks.push({ t: 'code', lang: (m[1] ?? '').toLowerCase(), text: m[2].replace(/\n$/, '') })
    last = m.index + m[0].length
  }
  const rest = content.slice(last).replace(/^\n/, '')
  if (rest.trim() || blocks.length === 0) blocks.push(...parseLines(rest))
  return blocks
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator}|‍|️|⃣|\s)+$/u
const EMOJI_UNIT = /\p{Regional_Indicator}{2}|(?:\p{Extended_Pictographic}|[#*0-9]️?⃣)(?:️|\p{Emoji_Modifier})*(?:‍(?:\p{Extended_Pictographic})(?:️|\p{Emoji_Modifier})*)*/gu

/** Mensagem só de emoji (até 27): aparece grande, como no Discord. */
export function isJumbo(content: string): boolean {
  const text = content.trim()
  if (!text || !EMOJI_ONLY.test(text) || /^[\d#*\s]+$/.test(text)) return false
  const count = text.match(EMOJI_UNIT)?.length ?? 0
  return count > 0 && count <= 27
}

/** Texto puro (pra notificação, resposta, prévia): menções viram nomes. */
export function plainText(content: string, names: { user(id: string): string; role(id: string): string; channel(id: string): string }): string {
  return content
    .replace(/<@!?([\w-]{1,64})>/g, (_, id) => `@${names.user(id)}`)
    .replace(/<@&([\w-]{1,64})>/g, (_, id) => `@${names.role(id)}`)
    .replace(/<#([\w-]{1,64})>/g, (_, id) => `#${names.channel(id)}`)
    .replace(/```[\w+#.-]*\n?([\s\S]*?)```/g, '$1')
    .replace(/\|\|([\s\S]+?)\|\|/g, '▒▒▒')
    .replace(/(\*\*|__|~~|\*|`)/g, '')
}
