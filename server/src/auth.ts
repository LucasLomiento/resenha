// Senhas com PBKDF2 e tokens de sessão aleatórios, tudo com WebCrypto.
// O runtime dos Workers limita o PBKDF2 a 100 mil iterações.

const ITERATIONS = 100_000
const encoder = new TextEncoder()

export function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { hash: toBase64Url(await pbkdf2(password, salt)), salt: toBase64Url(salt) }
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const got = await pbkdf2(password, fromBase64Url(salt))
  const want = fromBase64Url(hash)
  return got.byteLength === want.byteLength && crypto.subtle.timingSafeEqual(got, want)
}

/** Sessões ficam guardadas só pelo hash: um vazamento do banco não entrega tokens válidos. */
export async function hashToken(token: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))))
}

// ---------- URLs assinadas ----------

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

async function sign(secret: string, message: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message))))
}

async function verify(secret: string, message: string, sig: string | null): Promise<boolean> {
  if (!sig) return false
  let raw: Uint8Array
  try {
    raw = fromBase64Url(sig)
  } catch {
    return false
  }
  return crypto.subtle.verify('HMAC', await hmacKey(secret), raw, encoder.encode(message))
}

const DAY_S = 24 * 60 * 60

/**
 * Validade de 2 a 3 dias, arredondada pro dia: a URL se repete o dia todo (o
 * cache aproveita) e um link que vazou, ou de quem saiu do servidor, morre logo.
 */
function shortExpiry(now: number): number {
  return (Math.floor(now / 1000 / DAY_S) + 3) * DAY_S
}

function fresh(exp: string | null, now: number): boolean {
  return !!exp && /^\d+$/.test(exp) && Number(exp) * 1000 >= now
}

/**
 * Onde o arquivo mora: `g:<servidor>` ou `c:<conversa>`. Entra na assinatura,
 * então um link de um lugar nunca abre arquivo de outro.
 */
export type FileScope = { kind: 'g' | 'c'; id: string }

export function filePath(scope: FileScope, id: string, name: string): string {
  return `/api/${scope.kind}/${encodeURIComponent(scope.id)}/files/${id}/${encodeURIComponent(name)}`
}

export async function signFileUrl(secret: string, scope: FileScope, id: string, name: string, now = Date.now()): Promise<string> {
  const exp = shortExpiry(now)
  const sig = await sign(secret, `${scope.kind}:${scope.id}:${id}:${exp}`)
  return `${filePath(scope, id, name)}?exp=${exp}&sig=${sig}`
}

export async function verifyFileSignature(
  secret: string,
  scope: FileScope,
  id: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
): Promise<boolean> {
  return fresh(exp, now) && verify(secret, `${scope.kind}:${scope.id}:${id}:${exp}`, sig)
}

/** Links do formato antigo (0.5): /api/files/<id>/<nome>, só do servidor "main". */
export async function verifyLegacyFileSignature(
  secret: string,
  id: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
): Promise<boolean> {
  return fresh(exp, now) && verify(secret, `${id}:${exp}`, sig)
}

/** Imagem de prévia de link: o app só busca pelo nosso proxy, nunca no site (não vaza o IP de quem vê). */
export async function signProxyUrl(secret: string, url: string, now = Date.now()): Promise<string> {
  const exp = shortExpiry(now)
  const u = toBase64Url(encoder.encode(url))
  return `/api/proxy?u=${u}&exp=${exp}&sig=${await sign(secret, `proxy:${u}:${exp}`)}`
}

export async function verifyProxyUrl(secret: string, u: string | null, exp: string | null, sig: string | null, now = Date.now()) {
  if (!u || !fresh(exp, now) || !(await verify(secret, `proxy:${u}:${exp}`, sig))) return null
  try {
    return new TextDecoder().decode(fromBase64Url(u))
  } catch {
    return null
  }
}

/** Esconde o IP antes de guardar (limite de tentativas): o servidor nunca grava IP puro. */
export async function hashIp(secret: string, ip: string): Promise<string> {
  return (await sign(secret, `ip:${ip}`)).slice(0, 22)
}
