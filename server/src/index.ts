import {
  MAX_ANIMATED_BYTES,
  MAX_AVATAR_BYTES,
  MAX_BANNER_BYTES,
  dmMembers,
  type ApiError,
  type InvitePreview,
  type StatusResponse,
} from '../../shared/protocol'
import { hashIp, verifyFileSignature, verifyLegacyFileSignature, verifyProxyUrl } from './auth'
import type { AuthContext, ClientInfo, Result } from './directory'
import { LEGACY_HEADER, USER_HEADER } from './guild'
import { HOME_HEADER } from './home'
import { conversation, directory, guild, home } from './stubs'
import { getIceServers } from './turn'
import { safeUrl } from './unfurl'

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
const INTERNAL_HEADERS = [USER_HEADER, LEGACY_HEADER, HOME_HEADER]
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
<p class="small">Ainda não tem o app? <a href="https://github.com/LucasLomiento/resenha/releases/latest">Baixe aqui</a> e use o código <code>${escapeHtml(code)}</code>.</p>`
    : `<h1>Convite inválido</h1><p class="small">Esse convite venceu ou já foi usado. Peça um novo pra quem te convidou.</p>`
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Resenha</title><meta name="robots" content="noindex">
<style>html,body{height:100%;margin:0}body{background:#0f0d16;color:#ecebf3;font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;padding:16px;box-sizing:border-box}
main{max-width:380px;width:100%;text-align:center;background:#17151f;border:1px solid #2a2636;border-radius:20px;padding:32px 24px}
img,.icon{width:72px;height:72px;border-radius:22px;object-fit:cover;margin:0 auto 12px;display:grid;place-items:center;background:#6a5cf6;font-size:28px;font-weight:600}
h1{font-size:22px;margin:4px 0}.small{color:#a7a3b8;font-size:13px;margin:6px 0}a{color:#a99ffb}
.button{display:block;margin:20px 0 12px;padding:12px;border-radius:12px;background:#6a5cf6;color:#fff;text-decoration:none;font-weight:600}
code{background:#221f2c;padding:2px 6px;border-radius:6px}</style></head><body><main>${body}</main></body></html>`
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

async function turnstileOk(env: Env, token: unknown, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET || typeof token !== 'string' || !token || token.length > 4096) return false
  const form = new FormData()
  form.append('secret', env.TURNSTILE_SECRET)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    return !!((await res.json()) as { success?: boolean }).success
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
    res = await fetch(safe.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResenhaBot/1.0; link preview)', Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return error(502, 'Não deu pra buscar a imagem.')
  }
  const type = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  if (!res.ok || !/^image\/(png|jpeg|gif|webp|avif)$/.test(type) || !safeUrl(res.url || safe.href)) {
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

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method
  const dir = directory(env)
  const ip = request.headers.get('CF-Connecting-IP')
  let m: RegExpMatchArray | null

  if (await limited(env.IP_LIMITER, ip)) return error(429, 'Muitos pedidos. Espere um pouco.')
  // Entrar, criar conta e ver convite: limite bem mais apertado por IP.
  const sensitive = /^\/(api\/(register|login|invites\/)|verify|i\/)/.test(pathname) && method !== 'OPTIONS'
  if (sensitive && (await limited(env.AUTH_LIMITER, ip))) return error(429, 'Muitas tentativas. Espere um minuto.')

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
    const human = signupOpen(env) && !body.invite ? await turnstileOk(env, body.turnstileToken, request.headers.get('CF-Connecting-IP')) : false
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
    const scopeId = decodeURIComponent(m[2])
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

  // WebSockets: o token vai na primeira mensagem (nunca na URL).
  if (pathname === '/ws') return guild(env, 'main').fetch(clean(request, { [LEGACY_HEADER]: '1' }))
  if ((m = pathname.match(/^\/api\/g\/([\w-]{1,64})\/ws$/))) {
    if (!(await dir.guildInfo(m[1]))) return error(404, 'Servidor não existe.')
    return guild(env, m[1]).fetch(clean(request))
  }
  if ((m = pathname.match(/^\/api\/home\/([\w-]{1,64})\/ws$/))) {
    if (!(await dir.getUser(m[1]))) return error(404, 'Conta não existe.')
    return home(env, m[1]).fetch(clean(request, { [HOME_HEADER]: m[1] }))
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
    // Cada pedido gera credencial do TURN (que custa banda): poucos por pessoa.
    if (await limited(env.USER_LIMITER, `ice:${me}`)) return error(429, 'Muitos pedidos. Espere um pouco.')
    return json({ iceServers: await getIceServers(env) })
  }

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
    const channelId = decodeURIComponent(m[1])
    if (!dmMembers(channelId)?.includes(me)) return error(404, 'Conversa não encontrada.')
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
