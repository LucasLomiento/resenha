import {
  MAX_ANIMATED_BYTES,
  MAX_AVATAR_BYTES,
  MAX_BANNER_BYTES,
  dmMembers,
  type ApiError,
  type InvitePreview,
  type StatusResponse,
} from '../../shared/protocol'
import { hashIp, ipPrefix, verifyFileSignature, verifyLegacyFileSignature, verifyProxyUrl } from './auth'
import type { AuthContext, ClientInfo, Result } from './directory'
import { mimeOf, readDiscordPrint } from './discord-import'
import { MEDIA_BUDGET, Sfu, SfuError, cleanLocalTracks, cleanRemoteTracks, cleanSdp, sessionToken, sfuConfig, validToken } from './media'
import { LEGACY_HEADER, USER_HEADER } from './guild'
import { HOME_HEADER } from './home'
import { IP_HEADER } from './resume'
import { conversation, directory, guild, home } from './stubs'
import { STUN_ONLY, TURN_TTL, getIceServers } from './turn'
import { safeFetch, safeUrl } from './unfurl'
import { id as validId } from './validate'

export { Conversation } from './conversation'
export { Directory } from './directory'
export { Guild } from './guild'
export { Home } from './home'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name, X-Media-Size, X-Resenha-Device',
  'Access-Control-Max-Age': '86400',
}

/** Cabeçalhos que só o Worker põe: o que vier de fora com eles é descartado. */
const INTERNAL_HEADERS = [USER_HEADER, LEGACY_HEADER, HOME_HEADER, IP_HEADER]
const MAX_JSON = 64 * 1024
const MAX_IMAGE = MAX_AVATAR_BYTES
const MAX_PROXY = 8 * 1024 * 1024

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function error(status: number, message: string): Response {
  return json({ error: message } satisfies ApiError, status)
}

function fromResult<T>(result: Result<T>): Response {
  return result.ok ? json(result.value ?? { ok: true }) : error(result.status, result.error)
}

/** Lê um corpo com teto de tamanho, mesmo sem Content-Length (para de ler ao passar). */
async function readLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_JSON) return {}
  try {
    const bytes = await readLimited(request.body, MAX_JSON)
    if (!bytes) return {}
    const body = JSON.parse(new TextDecoder().decode(bytes))
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Corpo binário pequeno (foto, ícone, banner), com teto. */
/** Print pra importar canais do Discord (o app já manda comprimido). */
const MAX_IMPORT_IMAGE = 1_500_000

async function readImage(request: Request, max = MAX_IMAGE): Promise<ArrayBuffer | null> {
  if (Number(request.headers.get('Content-Length') ?? 0) > max) return null
  const bytes = await readLimited(request.body, max)
  return bytes && bytes.byteLength > 0 ? (bytes.buffer as ArrayBuffer) : null
}

/**
 * Foto de perfil: o corpo é a imagem, ou (foto animada) um formulário com a
 * imagem (`image`) e o quadro parado (`still`).
 */
async function readAvatar(request: Request): Promise<{ image: ArrayBuffer; still: ArrayBuffer | null } | null> {
  const type = request.headers.get('Content-Type') ?? ''
  if (!type.startsWith('multipart/form-data')) {
    const image = await readImage(request, MAX_ANIMATED_BYTES)
    return image ? { image, still: null } : null
  }
  const bytes = await readImage(request, MAX_ANIMATED_BYTES + MAX_AVATAR_BYTES + 4096)
  if (!bytes) return null
  try {
    const form = await new Response(bytes, { headers: { 'Content-Type': type } }).formData()
    const image = form.get('image')
    const still = form.get('still')
    if (!(image instanceof File) || image.size === 0) return null
    return { image: await image.arrayBuffer(), still: still instanceof File && still.size > 0 ? await still.arrayBuffer() : null }
  } catch {
    return null
  }
}

/**
 * Limite de pedidos por IP (pra ninguém derrubar o plano grátis). Sem o IP
 * (testes locais), não limita.
 */
async function limited(limiter: RateLimit | undefined, key: string | null): Promise<boolean> {
  if (!limiter || !key) return false
  try {
    return !(await limiter.limit({ key })).success
  } catch {
    return false
  }
}

/**
 * Servidores e contas que existem, por 10 min (na memória desta instância do Worker): cada
 * WebSocket aberto perguntava ao Directory, e cada pergunta é um pedido na cota de Durable
 * Objects. Só o "existe" fica guardado; quem foi excluído nesse meio é recusado pelo próprio
 * objeto (4004/4001).
 */
const existing = new Map<string, number>()
const EXISTS_TTL = 10 * 60_000

async function exists(key: string, check: () => Promise<unknown>): Promise<boolean> {
  const now = Date.now()
  if ((existing.get(key) ?? 0) > now) return true
  if (!(await check())) return false
  if (existing.size >= 5000) existing.clear()
  existing.set(key, now + EXISTS_TTL)
  return true
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Página do link de convite: mostra o servidor e abre o app (ou leva pra baixar). */
function invitePage(preview: InvitePreview | null, code: string): Response {
  const title = preview ? `Convite pra ${escapeHtml(preview.guild.name)}` : 'Convite inválido'
  const icon = preview?.guild.icon ? `<img src="/media/${escapeHtml(preview.guild.icon)}" alt="">` : `<div class="icon">${preview ? escapeHtml(preview.guild.name.slice(0, 1).toUpperCase()) : '?'}</div>`
  const body = preview
    ? `${icon}<p class="small">${preview.inviter ? `${escapeHtml(preview.inviter.name)} te convidou pra entrar em` : 'Você foi convidado pra entrar em'}</p>
<h1>${escapeHtml(preview.guild.name)}</h1><p class="small">${preview.memberCount} ${preview.memberCount === 1 ? 'membro' : 'membros'}</p>
<a class="button" href="resenha://invite/${escapeHtml(code)}">Abrir no Resenha</a>
<p class="small">Ainda não tem o app? <a href="https://lucaslomiento.github.io/resenha/#baixar">Baixe aqui</a> e use o código <code>${escapeHtml(code)}</code>.</p>`
    : `<h1>Convite inválido</h1><p class="small">Esse convite venceu ou já foi usado. Peça um novo pra quem te convidou.</p>`
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Resenha</title><meta name="robots" content="noindex">
<style>html,body{height:100%;margin:0}body{background:#09090b;color:#ececef;font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;padding:16px;box-sizing:border-box}
main{max-width:380px;width:100%;text-align:center;background:#141417;border:1px solid #26262b;border-radius:20px;padding:32px 24px}
img,.icon{width:72px;height:72px;border-radius:22px;object-fit:cover;margin:0 auto 12px;display:grid;place-items:center;background:#2b6cf5;font-size:28px;font-weight:600}
h1{font-size:22px;margin:4px 0}.small{color:#a1a1aa;font-size:13px;margin:6px 0}a{color:#6f9bff}
.button{display:block;margin:20px 0 12px;padding:12px;border-radius:12px;background:#2b6cf5;color:#fff;text-decoration:none;font-weight:600}
code{background:#1f1f24;padding:2px 6px;border-radius:6px}</style></head><body><main>${body}</main></body></html>`
  return new Response(html, {
    status: preview ? 200 : 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  })
}

function clean(request: Request, extra: Record<string, string> = {}): Request {
  const headers = new Headers(request.headers)
  for (const h of INTERNAL_HEADERS) headers.delete(h)
  for (const [k, v] of Object.entries(extra)) headers.set(k, v)
  return new Request(request, { headers })
}

/** Pedaço de URL decodificado; malformado (`%E0%A4%A`) dá null em vez de erro 500. */
function decoded(text: string): string | null {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

function bearer(request: Request): string {
  return request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
}

function deviceName(request: Request): string {
  const given = request.headers.get('X-Resenha-Device')
  if (given) return given.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80)
  const ua = request.headers.get('User-Agent') ?? ''
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Aparelho'
  return /Electron/.test(ua) ? `App no ${os}` : os
}

async function clientInfo(request: Request, env: Env): Promise<ClientInfo> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
  const country = (request.cf?.country as string | undefined) ?? null
  return { device: deviceName(request), ipHash: await hashIp(env.FILE_SECRET, ip), country }
}

function signupOpen(env: Env): boolean {
  return !!env.TURNSTILE_SITE_KEY && !!env.TURNSTILE_SECRET
}

async function turnstileOk(env: Env, token: unknown, ip: string | null, host: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET || typeof token !== 'string' || !token || token.length > 4096) return false
  const form = new FormData()
  form.append('secret', env.TURNSTILE_SECRET)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    const result = (await res.json()) as { success?: boolean; hostname?: string }
    // O desafio tem que ter sido resolvido na nossa página (/verify), não num site qualquer com a mesma chave.
    return !!result.success && (!result.hostname || result.hostname === host)
  } catch {
    return false
  }
}

/** Página do anti-robô: o app abre numa janela e lê o token pelo título quando o desafio passa. */
function turnstilePage(siteKey: string): Response {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verificação</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>html,body{height:100%;margin:0;background:#0d0e12;color:#e8e9ee;font:15px system-ui,sans-serif;display:grid;place-items:center}p{opacity:.7;text-align:center}</style>
</head><body><div><p>Só confirmando que você é uma pessoa.</p>
<div class="cf-turnstile" data-sitekey="${siteKey.replace(/[^\w-]/g, '')}" data-theme="dark" data-callback="done"></div></div>
<script>function done(token){document.title='resenha-turnstile:'+token}</script></body></html>`
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; connect-src https://challenges.cloudflare.com",
    },
  })
}

/** Imagem de prévia de link, buscada pelo servidor (quem vê nunca acessa o site). */
async function proxyImage(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const target = await verifyProxyUrl(env.FILE_SECRET, url.searchParams.get('u'), url.searchParams.get('exp'), url.searchParams.get('sig'))
  const safe = target ? safeUrl(target) : null
  if (!safe) return error(403, 'Link vencido ou inválido.')
  const cache = caches.default
  const key = new Request(url.toString(), { method: 'GET' })
  const hit = await cache.match(key)
  if (hit) return hit

  let res: Response
  try {
    const fetched = await safeFetch(safe, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResenhaBot/1.0; link preview)', Accept: 'image/*' },
      signal: AbortSignal.timeout(8000),
    })
    if (!fetched) return error(415, 'Não é uma imagem.')
    res = fetched.res
  } catch {
    return error(502, 'Não deu pra buscar a imagem.')
  }
  const type = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  if (!res.ok || !/^image\/(png|jpeg|gif|webp|avif)$/.test(type)) {
    res.body?.cancel().catch(() => {})
    return error(415, 'Não é uma imagem.')
  }
  if (Number(res.headers.get('Content-Length') ?? 0) > MAX_PROXY) {
    res.body?.cancel().catch(() => {})
    return error(413, 'Imagem grande demais.')
  }
  const body = await readLimited(res.body, MAX_PROXY)
  if (!body) return error(413, 'Imagem grande demais.')
  const out = new Response(body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=86400',
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
    },
  })
  ctx.waitUntil(cache.put(key, out.clone()))
  return out
}

interface MediaUsage {
  month: string
  bytes: number
  allowed: boolean
}

/**
 * Rotas do SFU e da cota de mídia. O app só chega aqui logado; cada sessão do SFU
 * vem com um token que prova que é dessa pessoa.
 */
async function mediaRoute(
  request: Request,
  env: Env,
  pathname: string,
  method: string,
  me: string,
  dir: { mediaUsage(): Promise<MediaUsage>; addMediaUsage(userId: string, bytes: number): Promise<MediaUsage> },
): Promise<Response> {
  const config = sfuConfig(env)
  if (pathname === '/api/media' && method === 'GET') {
    const usage = await dir.mediaUsage()
    return json({ sfu: !!config && usage.allowed, turn: !!env.TURN_KEY_ID && usage.allowed, used: usage.bytes, limit: MEDIA_BUDGET })
  }
  if (pathname === '/api/media/usage' && method === 'POST') {
    const body = await readJson(request)
    const usage = await dir.addMediaUsage(me, Number(body.bytes))
    return json({ allowed: usage.allowed })
  }
  if (!config) return error(503, 'O servidor não tem o SFU configurado.')
  // Fechar (parar de puxar ou publicar) sempre vale, até com a cota no fim: é o que economiza.
  if (!/\/close$/.test(pathname) && !(await dir.mediaUsage()).allowed) return error(503, 'A cota de mídia do mês acabou: a tela vai direto (P2P).')
  const sfu = new Sfu(config)
  try {
    if (pathname === '/api/media/sessions' && method === 'POST') {
      if (await limited(env.USER_LIMITER, `sfu:${me}`)) return error(429, 'Muitos pedidos. Espere um pouco.')
      const sessionId = await sfu.newSession()
      return json({ sessionId, token: await sessionToken(env.FILE_SECRET, me, sessionId) })
    }
    const m = pathname.match(/^\/api\/media\/sessions\/([\w-]{1,128})\/(push|pull|renegotiate|close)$/)
    if (!m || method !== 'POST') return error(404, 'Rota não existe.')
    const [, sessionId, action] = m
    const body = await readJson(request)
    if (!(await validToken(env.FILE_SECRET, me, sessionId, body.token))) return error(403, 'Sessão de outra pessoa.')
    if (action === 'push') {
      const sdp = cleanSdp(body.sdp)
      const tracks = cleanLocalTracks(body.tracks)
      if (!sdp || !tracks) return error(400, 'Pedido inválido.')
      return json(await sfu.push(sessionId, sdp, tracks))
    }
    if (action === 'pull') {
      const tracks = cleanRemoteTracks(body.tracks)
      if (!tracks) return error(400, 'Pedido inválido.')
      return json(await sfu.pull(sessionId, tracks))
    }
    if (action === 'renegotiate') {
      const sdp = cleanSdp(body.sdp)
      if (!sdp) return error(400, 'Pedido inválido.')
      await sfu.renegotiate(sessionId, sdp)
      return json({ ok: true })
    }
    const mids = Array.isArray(body.mids) ? body.mids.filter((x: unknown): x is string => typeof x === 'string' && x.length <= 16).slice(0, 4) : []
    if (mids.length) await sfu.close(sessionId, mids)
    return json({ ok: true })
  } catch (err) {
    if (err instanceof SfuError) return error(err.status, err.message)
    throw err
  }
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method
  const dir = directory(env)
  const ip = request.headers.get('CF-Connecting-IP')
  // IPv6 conta pelo /64: trocar o fim do endereço não zera o limite.
  const ipKey = ip ? ipPrefix(ip) : null
  let m: RegExpMatchArray | null

  if (await limited(env.IP_LIMITER, ipKey)) return error(429, 'Muitos pedidos. Espere um pouco.')
  // Entrar, criar conta, trocar a senha e ver convite: limite bem mais apertado por IP.
  const sensitive = /^\/(api\/(register|login|invites\/|me\/password|me\/delete)|verify|i\/)/.test(pathname) && method !== 'OPTIONS'
  if (sensitive && (await limited(env.AUTH_LIMITER, ipKey))) return error(429, 'Muitas tentativas. Espere um minuto.')

  // ---------- Sem login ----------

  if (pathname === '/api/status' && method === 'GET') {
    const status = await dir.status()
    const open = signupOpen(env) && status.signup === 'open'
    return json({
      needsInvite: status.users > 0 && !open,
      signup: open ? 'open' : 'invite',
      turnstileSiteKey: open ? env.TURNSTILE_SITE_KEY : null,
    } satisfies StatusResponse)
  }

  if (pathname === '/api/register' && method === 'POST') {
    const body = await readJson(request)
    const human = signupOpen(env) && !body.invite ? await turnstileOk(env, body.turnstileToken, request.headers.get('CF-Connecting-IP'), url.hostname) : false
    return fromResult(
      await dir.register(
        { username: body.username, name: body.name, password: body.password, invite: body.invite, turnstile: human },
        await clientInfo(request, env),
      ),
    )
  }

  if (pathname === '/api/login' && method === 'POST') {
    const body = await readJson(request)
    return fromResult(await dir.login({ username: body.username, name: body.name, password: body.password }, await clientInfo(request, env)))
  }

  if (pathname === '/verify' && method === 'GET') {
    return signupOpen(env) ? turnstilePage(env.TURNSTILE_SITE_KEY) : error(404, 'Cadastro aberto desligado.')
  }

  if ((m = pathname.match(/^\/api\/invites\/([\w-]{4,32})$/)) && method === 'GET') {
    const preview = await dir.previewInvite(m[1])
    return preview ? json(preview) : error(404, 'Convite inválido, vencido ou já usado.')
  }
  if ((m = pathname.match(/^\/i\/([\w-]{4,32})\/?$/)) && method === 'GET') return invitePage(await dir.previewInvite(m[1]), m[1])

  if ((m = pathname.match(/^\/media\/([\w-]{8,64})$/)) && method === 'GET') {
    const media = await dir.getMedia(m[1])
    if (!media) return error(404, 'Imagem não existe.')
    return new Response(media.bytes, {
      headers: {
        'Content-Type': media.type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Security-Policy': 'sandbox',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  if (pathname === '/api/proxy' && method === 'GET') return proxyImage(request, url, env, ctx)

  // Arquivos: a assinatura na URL substitui o login, porque <img src> não manda cabeçalho.
  if ((m = pathname.match(/^\/api\/(g|c)\/([^/]+)\/files\/([\w-]+)\/[^/]+$/)) && method === 'GET') {
    const kind = m[1] as 'g' | 'c'
    const scopeId = decoded(m[2])
    if (scopeId === null) return error(400, 'Link inválido.')
    const valid = await verifyFileSignature(env.FILE_SECRET, { kind, id: scopeId }, m[3], url.searchParams.get('exp'), url.searchParams.get('sig'))
    if (!valid) return error(403, 'Link vencido ou inválido.')
    return kind === 'g' ? guild(env, scopeId).fetch(clean(request)) : conversation(env, scopeId).fetch(clean(request))
  }
  if ((m = pathname.match(/^\/api\/files\/([\w-]+)\/[^/]+$/)) && method === 'GET') {
    if (!(await verifyLegacyFileSignature(env.FILE_SECRET, m[1], url.searchParams.get('exp'), url.searchParams.get('sig')))) {
      return error(403, 'Link vencido ou inválido.')
    }
    return guild(env, 'main').fetch(clean(request))
  }

  // WebSockets: o token vai na primeira mensagem (nunca na URL). O DO recebe o IP embaralhado
  // (vaga das conexões sem login por IP); pedido sem upgrade nem chega a acordar o Directory.
  const socket = pathname === '/ws' || /^\/api\/(g|home)\/[\w-]{1,64}\/ws$/.test(pathname)
  if (socket && request.headers.get('Upgrade') !== 'websocket') return error(426, 'Esperava WebSocket.')
  const ipHeader: Record<string, string> = socket && ip ? { [IP_HEADER]: await hashIp(env.FILE_SECRET, ip) } : {}
  if (pathname === '/ws') return guild(env, 'main').fetch(clean(request, { [LEGACY_HEADER]: '1', ...ipHeader }))
  // Reconectando sem parar (app com bug, script): fica aqui, sem acordar nenhum Durable Object.
  // Por IP e destino: dá pra todo aparelho da casa voltar junto depois de uma queda.
  if (socket && (await limited(env.WS_LIMITER, `${pathname}:${ipKey}`))) return error(429, 'Conexões demais. Espere um pouco.')
  if ((m = pathname.match(/^\/api\/g\/([\w-]{1,64})\/ws$/))) {
    const id = m[1]
    if (!(await exists(`g:${id}`, () => dir.guildInfo(id)))) return error(404, 'Servidor não existe.')
    return guild(env, id).fetch(clean(request, ipHeader))
  }
  if ((m = pathname.match(/^\/api\/home\/([\w-]{1,64})\/ws$/))) {
    const id = m[1]
    if (!(await exists(`u:${id}`, () => dir.getUser(id)))) return error(404, 'Conta não existe.')
    return home(env, id).fetch(clean(request, { [HOME_HEADER]: id, ...ipHeader }))
  }

  // ---------- Daqui pra baixo, só logado ----------

  const token = bearer(request)
  const auth: AuthContext | null = token ? await dir.authenticate(token) : null
  if (!auth) return error(401, 'Sessão inválida. Entre de novo.')
  const me = auth.me.id

  if (pathname === '/api/logout' && method === 'POST') {
    await dir.logout(token)
    return json({ ok: true })
  }
  if (pathname === '/api/ice' && method === 'GET') {
    // Sala direta e chamada privada (app 1.15+): só o STUN, sem nem pedir credencial.
    if (url.searchParams.get('scope') === 'direct') return json({ iceServers: STUN_ONLY })
    // Cada pedido gera credencial do TURN (que custa banda): poucos por pessoa.
    if (await limited(env.USER_LIMITER, `ice:${me}`)) return error(429, 'Muitos pedidos. Espere um pouco.')
    // Passou da cota de mídia do mês: só STUN (tudo P2P).
    if (!env.TURN_KEY_ID || !(await dir.mediaUsage()).allowed) return json({ iceServers: STUN_ONLY })
    // App 1.15+ diz a sala: o TURN só vai pra quem vai entrar numa sala pelo Cloudflare (e pode
    // entrar nela). Sem a sala é o app antigo, que continua recebendo como antes.
    const guildId = url.searchParams.get('guild')
    const channelId = url.searchParams.get('channel')
    if (guildId !== null || channelId !== null) {
      const allowed =
        !!validId(guildId) &&
        !!validId(channelId) &&
        (await dir.isMember(guildId!, me)) &&
        (await guild(env, guildId!).relayAccess(me, channelId!))
      if (!allowed) return json({ iceServers: STUN_ONLY })
    }
    const { servers, turnUser } = await getIceServers(env)
    // Anotada pra ser revogada se a cota do mês acabar antes de ela vencer.
    if (turnUser) ctx.waitUntil(dir.recordTurn(turnUser, Date.now() + TURN_TTL * 1000))
    return json({ iceServers: servers })
  }

  // Mídia pelo Cloudflare (media.ts): SFU pra tela com várias pessoas assistindo.
  if (pathname.startsWith('/api/media')) return mediaRoute(request, env, pathname, method, me, dir)

  // Conta
  if (pathname === '/api/me' && method === 'GET') return json(auth.me)
  if (pathname === '/api/me' && method === 'PATCH') {
    const body = await readJson(request)
    return fromResult(
      await dir.updateProfile(me, { name: body.name, bio: body.bio, accent: body.accent, dmPolicy: body.dmPolicy, style: body.style }),
    )
  }
  if (pathname === '/api/me/avatar' && method === 'PUT') {
    const avatar = await readAvatar(request)
    return avatar ? fromResult(await dir.setAvatar(me, avatar.image, avatar.still)) : error(413, 'A foto pode ter até 512 KB (animada, até 1,5 MB).')
  }
  if (pathname === '/api/me/avatar' && method === 'DELETE') return fromResult(await dir.clearAvatar(me))
  if (pathname === '/api/me/banner' && method === 'PUT') {
    const image = await readImage(request, MAX_BANNER_BYTES)
    return image ? fromResult(await dir.setBanner(me, image)) : error(413, 'O banner pode ter até 1,5 MB.')
  }
  if (pathname === '/api/me/banner' && method === 'DELETE') return fromResult(await dir.clearBanner(me))
  if (pathname === '/api/me/password' && method === 'POST') {
    const body = await readJson(request)
    return fromResult(await dir.changePassword(me, auth.sessionId, body.current, body.next))
  }
  if (pathname === '/api/me/delete' && method === 'POST') {
    const body = await readJson(request)
    return fromResult(await dir.deleteAccount(me, body.password))
  }
  if (pathname === '/api/me/sessions' && method === 'GET') return json(await dir.sessions(me, auth.sessionId))
  if (pathname === '/api/me/sessions/others' && method === 'DELETE') return json({ revoked: await dir.revokeOtherSessions(me, auth.sessionId) })
  if ((m = pathname.match(/^\/api\/me\/sessions\/([\w-]{1,64})$/)) && method === 'DELETE') return fromResult(await dir.revokeSession(me, m[1]))
  if (pathname === '/api/me/export' && method === 'GET') {
    const data = await dir.exportData(me)
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="resenha-meus-dados.json"',
        'Cache-Control': 'no-store',
      },
    })
  }

  // Pessoas, amigos e bloqueios
  if ((m = pathname.match(/^\/api\/users\/([\w-]{1,64})$/)) && method === 'GET') {
    const user = await dir.getUser(m[1])
    return user ? json(user) : error(404, 'Pessoa não encontrada.')
  }
  if (pathname === '/api/friends' && method === 'POST') {
    const body = await readJson(request)
    return fromResult(await dir.friendRequest(me, body.username))
  }
  if ((m = pathname.match(/^\/api\/friends\/([\w-]{1,64})\/accept$/)) && method === 'POST') return fromResult(await dir.friendAccept(me, m[1]))
  if ((m = pathname.match(/^\/api\/friends\/([\w-]{1,64})$/)) && method === 'DELETE') return fromResult(await dir.friendRemove(me, m[1]))
  if ((m = pathname.match(/^\/api\/blocks\/([\w-]{1,64})$/)) && method === 'PUT') return fromResult(await dir.block(me, m[1]))
  if ((m = pathname.match(/^\/api\/blocks\/([\w-]{1,64})$/)) && method === 'DELETE') return fromResult(await dir.unblock(me, m[1]))

  // Servidores e convites
  if (pathname === '/api/guilds' && method === 'POST') {
    const body = await readJson(request)
    return fromResult(await dir.createGuild(me, body.name))
  }
  if (pathname === '/api/guilds/icon' && method === 'POST') {
    const image = await readImage(request)
    if (!image) return error(413, 'A imagem pode ter até 512 KB.')
    const result = await dir.uploadGuildIcon(me, image)
    return result.ok ? json({ id: result.value }) : error(result.status, result.error)
  }
  if ((m = pathname.match(/^\/api\/guilds\/([\w-]{1,64})\/leave$/)) && method === 'POST') return fromResult(await dir.leaveGuild(me, m[1]))
  if ((m = pathname.match(/^\/api\/guilds\/([\w-]{1,64})\/delete$/)) && method === 'POST') {
    const body = await readJson(request)
    return fromResult(await dir.deleteGuild(m[1], me, body.name))
  }
  if ((m = pathname.match(/^\/api\/invites\/([\w-]{4,32})$/)) && method === 'POST') return fromResult(await dir.joinByInvite(me, m[1]))

  // Importar do Discord: lê o print da lista de canais. Só lê; quem cria os canais
  // é o app, depois de a pessoa conferir (channel.import no servidor).
  if (pathname === '/api/import/discord' && method === 'POST') {
    if (!env.AI) return error(503, 'Ler print não está disponível neste servidor.')
    if (await limited(env.IMPORT_LIMITER, `import:${me}`)) return error(429, 'Muitos prints seguidos. Espere um minuto.')
    const image = await readImage(request, MAX_IMPORT_IMAGE)
    if (!image) return error(413, 'O print pode ter até 1,5 MB.')
    // GIF e afins: o modelo não lê, e antes isso virava "não achei canais".
    if (!mimeOf(new Uint8Array(image.slice(0, 16)))) return error(415, 'Use um print em PNG, JPEG ou WebP.')
    try {
      const structure = await readDiscordPrint(env.AI, image)
      if (!structure || structure.categories.length + structure.channels.length === 0) {
        return error(422, 'Não achei canais nesse print. Tire o print só da lista de canais do Discord.')
      }
      return json(structure)
    } catch (err) {
      console.error('importar do Discord: o modelo falhou', err)
      return error(502, 'Não deu pra ler o print agora. Tente de novo daqui a pouco.')
    }
  }

  // Anexos (o DO de destino confere se a pessoa pode mandar ali)
  if (pathname === '/api/files' && method === 'POST') {
    if (!(await dir.isMember('main', me))) return error(404, 'Servidor não encontrado.')
    return guild(env, 'main').fetch(clean(request, { [USER_HEADER]: me }))
  }
  if ((m = pathname.match(/^\/api\/g\/([\w-]{1,64})\/files$/)) && method === 'POST') {
    // Confere antes de acordar o DO (servidor que não existe nem chega a ser criado).
    if (!(await dir.isMember(m[1], me))) return error(404, 'Servidor não encontrado.')
    return guild(env, m[1]).fetch(clean(request, { [USER_HEADER]: me }))
  }
  if ((m = pathname.match(/^\/api\/c\/([^/]+)\/files$/)) && method === 'POST') {
    const channelId = decoded(m[1])
    // O Home da pessoa confere antes que a conversa existe: um id inventado não cria DO à toa.
    if (!channelId || !dmMembers(channelId)?.includes(me) || !(await home(env, me).knowsDm(channelId))) {
      return error(404, 'Conversa não encontrada.')
    }
    return conversation(env, channelId).fetch(clean(request, { [USER_HEADER]: me }))
  }

  // Dono da plataforma
  if (pathname === '/api/admin' && method === 'GET') return fromResult(await dir.adminSettings(me))
  if (pathname === '/api/admin/signup' && method === 'PUT') {
    const body = await readJson(request)
    if (body.mode === 'open' && !signupOpen(env)) return error(409, 'Configure o Turnstile antes de abrir o cadastro.')
    return fromResult(await dir.adminSetSignup(me, body.mode))
  }
  if (pathname === '/api/admin/users' && method === 'GET') return fromResult(await dir.adminUsers(me, url.searchParams.get('q') ?? ''))
  if ((m = pathname.match(/^\/api\/admin\/users\/([\w-]{1,64})\/pioneer$/)) && method === 'POST') return fromResult(await dir.adminSetPioneer(me, m[1]))
  if ((m = pathname.match(/^\/api\/admin\/users\/([\w-]{1,64})\/relay$/)) && method === 'POST') {
    const body = await readJson(request)
    return fromResult(await dir.adminSetRelay(me, m[1], body.allowed === true))
  }
  if ((m = pathname.match(/^\/api\/admin\/users\/([\w-]{1,64})\/ban$/)) && method === 'POST') {
    const body = await readJson(request)
    return fromResult(await dir.adminSetBanned(me, m[1], !!body.banned))
  }

  return error(404, 'Rota não existe.')
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    let response: Response
    try {
      response = await route(request, env, ctx)
    } catch (err) {
      console.error(err)
      response = error(500, 'Erro no servidor.')
    }
    if (response.status === 101) return response

    const out = new Response(response.body, response)
    for (const [key, value] of Object.entries(CORS)) out.headers.set(key, value)
    out.headers.set('X-Content-Type-Options', 'nosniff')
    out.headers.set('Referrer-Policy', 'no-referrer')
    return out
  },
} satisfies ExportedHandler<Env>
