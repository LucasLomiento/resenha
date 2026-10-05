import type { ApiError } from '../../shared/protocol'
import { verifyFileSignature } from './auth'
import { USER_HEADER, type Result, type Space } from './space'
import { getIceServers } from './turn'

export { Space } from './space'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
  'Access-Control-Max-Age': '86400',
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function error(status: number, message: string): Response {
  return json({ error: message } satisfies ApiError, status)
}

function fromResult<T>(result: Result<T>): Response {
  return result.ok ? json(result.value) : error(result.status, result.error)
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Só o Worker diz quem é o usuário pro Durable Object; nunca repassa o que veio de fora. */
function withoutUser(request: Request): Request {
  if (!request.headers.has(USER_HEADER)) return request
  const headers = new Headers(request.headers)
  headers.delete(USER_HEADER)
  return new Request(request, { headers })
}

function bearer(request: Request): string {
  return request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
}

async function route(request: Request, env: Env, space: DurableObjectStub<Space>): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method

  if (pathname === '/ws') return space.fetch(withoutUser(request))

  if (pathname === '/api/status' && method === 'GET') return json(await space.status())
  if (pathname === '/api/register' && method === 'POST') return fromResult(await space.register(await readJson(request)))
  if (pathname === '/api/login' && method === 'POST') return fromResult(await space.login(await readJson(request)))

  // Arquivo: a assinatura na URL substitui o login, porque <img src> não manda cabeçalho.
  const file = pathname.match(/^\/api\/files\/([\w-]+)\/[^/]+$/)
  if (file && method === 'GET') {
    const [, id] = file
    if (!(await verifyFileSignature(env.FILE_SECRET, id, url.searchParams.get('exp'), url.searchParams.get('sig')))) {
      return error(403, 'Link vencido ou inválido.')
    }
    return space.fetch(withoutUser(request))
  }

  // Daqui pra baixo, só logado.
  const token = bearer(request)
  const user = await space.authenticate(token)
  if (!user) return error(401, 'Sessão inválida. Entre de novo.')

  if (pathname === '/api/logout' && method === 'POST') {
    await space.logout(token)
    return json({ ok: true })
  }

  if (pathname === '/api/ice' && method === 'GET') return json({ iceServers: await getIceServers(env) })

  if (pathname === '/api/files' && method === 'POST') {
    // O Durable Object guarda o arquivo; ele confia no usuário que vai neste cabeçalho.
    const headers = new Headers(request.headers)
    headers.set(USER_HEADER, user.id)
    return space.fetch(new Request(request, { headers }))
  }

  return error(404, 'Rota não existe.')
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    // Um grupo só, um Durable Object só, criado na América do Sul.
    const space = env.SPACE.get(env.SPACE.idFromName('main'), { locationHint: 'sam' })
    let response: Response
    try {
      response = await route(request, env, space)
    } catch (err) {
      console.error(err)
      response = error(500, 'Erro no servidor.')
    }
    if (response.status === 101) return response

    const withCors = new Response(response.body, response)
    for (const [key, value] of Object.entries(CORS)) withCors.headers.set(key, value)
    return withCors
  },
} satisfies ExportedHandler<Env>
