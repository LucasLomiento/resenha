import type { Embed } from '../../shared/protocol'
import { signProxyUrl } from './auth'

// Prévia de link (título, descrição e imagem do site). Quem busca o site é o
// servidor, e a imagem passa pelo nosso proxy: o app de quem lê nunca acessa o
// site, então o IP de ninguém vaza pra quem mandou o link.

const HOUR = 3_600_000
const MAX_HTML = 512 * 1024
const cache = new Map<string, { at: number; embed: Embed | null }>()

/** Links da mensagem que viram prévia (até 3). Link entre <…> não vira, como no Discord. */
export function extractUrls(content: string): string[] {
  const text = content.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
  const out: string[] = []
  for (const match of text.matchAll(/<?https?:\/\/[^\s<>"'`]+>?/gi)) {
    let raw = match[0]
    if (raw.startsWith('<') && raw.endsWith('>')) continue
    raw = raw.replace(/^</, '').replace(/>$/, '')
    // Pontuação no fim é da frase, não do link (parêntese só se estiver sobrando).
    for (;;) {
      const last = raw.at(-1)
      if (last && '.,;:!?\'"]}'.includes(last)) raw = raw.slice(0, -1)
      else if (last === ')' && (raw.match(/\(/g)?.length ?? 0) < (raw.match(/\)/g)?.length ?? 0)) raw = raw.slice(0, -1)
      else break
    }
    if (raw.length > 2000 || out.includes(raw)) continue
    out.push(raw)
    if (out.length === 3) break
  }
  return out
}

function privateIPv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** Só endereço público, http(s), sem usuário/senha e na porta padrão. */
export function safeUrl(raw: string, selfHost?: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  if (url.port && url.port !== '80' && url.port !== '443') return null
  const host = url.hostname.toLowerCase()
  if (host.startsWith('[') || !host.includes('.')) return null
  if (/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host)) return null
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && privateIPv4(host)) return null
  if (selfHost && host === selfHost.toLowerCase()) return null
  return url
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** O HTMLRewriter entrega atributo e texto sem decodificar as entidades. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    const lower = code.toLowerCase()
    if (lower.startsWith('#x')) return safeChar(parseInt(lower.slice(2), 16)) ?? whole
    if (lower.startsWith('#')) return safeChar(parseInt(lower.slice(1), 10)) ?? whole
    return NAMED[lower] ?? whole
  })
}

function safeChar(code: number): string | null {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null
}

function limited(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let seen = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (seen >= max) {
        reader.cancel().catch(() => {})
        return controller.close()
      }
      const { done, value } = await reader.read()
      if (done) return controller.close()
      seen += value.byteLength
      controller.enqueue(value)
    },
    cancel() {
      reader.cancel().catch(() => {})
    },
  })
}

async function readHead(body: ReadableStream<Uint8Array>): Promise<{ meta: Map<string, string>; title: string }> {
  const meta = new Map<string, string>()
  let title = ''
  let titleDone = false
  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const key = (el.getAttribute('property') ?? el.getAttribute('name') ?? '').toLowerCase()
        const content = el.getAttribute('content')
        if (key && content && !meta.has(key)) meta.set(key, content)
      },
    })
    .on('title', {
      text(chunk) {
        if (titleDone) return
        if (title.length < 400) title += chunk.text
        if (chunk.lastInTextNode) titleDone = true
      },
    })
  await rewriter.transform(new Response(limited(body, MAX_HTML), { headers: { 'Content-Type': 'text/html' } })).arrayBuffer()
  return { meta, title }
}

async function fetchEmbed(url: URL, secret: string, selfHost: string): Promise<Embed | null> {
  const res = await fetch(url.href, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ResenhaBot/1.0; link preview)',
      Accept: 'text/html,application/xhtml+xml,image/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(5000),
  })
  const final = safeUrl(res.url || url.href, selfHost)
  if (!res.ok || !res.body || !final) {
    res.body?.cancel().catch(() => {})
    return null
  }
  const type = (res.headers.get('Content-Type') ?? '').toLowerCase()
  if (/^image\/(png|jpe?g|gif|webp|avif)/.test(type)) {
    res.body.cancel().catch(() => {})
    return { url: url.href, title: '', description: '', siteName: final.hostname.replace(/^www\./, ''), image: await signProxyUrl(secret, final.href) }
  }
  if (!type.includes('text/html') && !type.includes('application/xhtml')) {
    res.body.cancel().catch(() => {})
    return null
  }

  const { meta, title } = await readHead(res.body)
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)?.trim()).find((v) => !!v) ?? ''
  const embedTitle = clip(decode(pick('og:title', 'twitter:title') || title), 256)
  const description = clip(decode(pick('og:description', 'twitter:description', 'description')), 350)
  const siteName = clip(decode(pick('og:site_name', 'application-name')) || final.hostname.replace(/^www\./, ''), 100)
  let image: string | null = null
  const rawImage = decode(pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'))
  if (rawImage) {
    try {
      const absolute = safeUrl(new URL(rawImage, final).href, selfHost)
      if (absolute) image = await signProxyUrl(secret, absolute.href)
    } catch {
      // imagem com endereço inválido: fica sem
    }
  }
  if (!embedTitle && !description && !image) return null
  return { url: url.href, title: embedTitle, description, siteName, image }
}

/** Monta a prévia de um link (com cache curto na memória). Nunca lança erro. */
export async function unfurl(raw: string, secret: string, selfHost: string): Promise<Embed | null> {
  const url = safeUrl(raw, selfHost)
  if (!url) return null
  const hit = cache.get(url.href)
  if (hit && Date.now() - hit.at < HOUR) return hit.embed
  let embed: Embed | null = null
  try {
    embed = await fetchEmbed(url, secret, selfHost)
  } catch {
    embed = null
  }
  cache.set(url.href, { at: Date.now(), embed })
  if (cache.size > 300) cache.delete(cache.keys().next().value!)
  return embed
}

export async function unfurlAll(content: string, secret: string, selfHost: string): Promise<Embed[]> {
  const urls = extractUrls(content)
  if (urls.length === 0) return []
  const embeds = await Promise.all(urls.map((u) => unfurl(u, secret, selfHost)))
  return embeds.filter((e): e is Embed => e !== null)
}
