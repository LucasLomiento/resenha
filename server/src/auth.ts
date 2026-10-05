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

// ---------- URLs assinadas dos anexos ----------

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

const WEEK = 7 * 24 * 60 * 60

/**
 * A validade é arredondada pra semana seguinte inteira, então a mesma URL se
 * repete por dias e o cache do Chromium aproveita as imagens já baixadas.
 */
export async function signFileUrl(secret: string, id: string, name: string, now = Date.now()): Promise<string> {
  const exp = (Math.floor(now / 1000 / WEEK) + 2) * WEEK
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${id}:${exp}`))
  return `/api/files/${id}/${encodeURIComponent(name)}?exp=${exp}&sig=${toBase64Url(new Uint8Array(sig))}`
}

export async function verifyFileSignature(
  secret: string,
  id: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) * 1000 < now) return false
  let raw: Uint8Array
  try {
    raw = fromBase64Url(sig)
  } catch {
    return false
  }
  return crypto.subtle.verify('HMAC', await hmacKey(secret), raw, encoder.encode(`${id}:${exp}`))
}
