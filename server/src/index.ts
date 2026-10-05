import { MAX_UPLOAD_BYTES, type ApiError } from '../../shared/protocol'
import { randomToken, verifyFileSignature } from './auth'
import type { Result, Space } from './space'
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

function bearer(request: Request): string {
  return request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
}

async function route(request: Request, env: Env, space: DurableObjectStub<Space>): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method

  if (pathname === '/ws') return space.fetch(request)

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
    const object = await env.FILES.get(`files/${id}`, { range: request.headers, onlyIf: request.headers })
    if (!object) return error(404, 'Arquivo não existe mais.')
    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('ETag', object.httpEtag)
    headers.set('Cache-Control', 'private, max-age=604800, immutable')
    headers.set('Accept-Ranges', 'bytes')
    // Arquivo enviado por usuário nunca roda como página do nosso domínio.
    headers.set('Content-Security-Policy', 'sandbox')
    headers.set('X-Content-Type-Options', 'nosniff')
    if (!('body' in object)) return new Response(null, { status: 304, headers })
    if (request.headers.has('Range') && object.range && 'offset' in object.range) {
      const offset = object.range.offset ?? 0
      const length = object.range.length ?? object.size - offset
      headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
      return new Response(object.body, { status: 206, headers })
    }
    return new Response(object.body, { headers })
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
    const size = Number(request.headers.get('Content-Length'))
    if (!size || !request.body) return error(411, 'Faltou o tamanho do arquivo.')
    if (size > MAX_UPLOAD_BYTES) return error(413, 'Arquivo maior que 100 MB.')
    let name = 'arquivo'
    try {
      name = decodeURIComponent(request.headers.get('X-File-Name') ?? '') || name
    } catch {
      // nome mal codificado, fica o padrão
    }
    name = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 200)
    const type = (request.headers.get('Content-Type') || 'application/octet-stream').slice(0, 100)
    const id = randomToken(12)

    await env.FILES.put(`files/${id}`, request.body, {
      httpMetadata: {
        contentType: type,
        contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    })
    return json(await space.addAttachment(user.id, { id, name, size, type }))
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
