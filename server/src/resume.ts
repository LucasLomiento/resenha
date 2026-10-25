// Reconexão sem derrubar a call.
//
// O app manda no `auth` uma chave aleatória, a mesma em toda reconexão daquela
// instância. O connId sai da chave + a conta: quem reconecta volta com o mesmo
// connId (as conexões P2P continuam valendo) e ninguém de outra conta chega nele.
//
// Quando uma conexão cai sem avisar, ela vira "fantasma" por um tempo: continua
// na call e online pros outros, e o que chega pra ela fica guardado. Se o app
// voltar a tempo, retoma tudo; senão, sai de vez.

const encoder = new TextEncoder()

/** Chave da instância do app (o servidor só aceita nesse formato). */
export const CONN_KEY = /^[\w-]{16,64}$/

/** Quanto tempo uma conexão que caiu continua na call esperando o app voltar. */
export const RESUME_GRACE = 30_000

/** Teto de mensagens guardadas pra um fantasma (sinalização da call, avisos). */
export const GHOST_QUEUE = 300
/** E de bytes (300 mensagens de até 64 KB davam ~19 MB na memória por fantasma). */
export const GHOST_QUEUE_BYTES = 2 * 1024 * 1024

/**
 * Fechamento "tente de novo" pra conexão que não chegou a se autenticar (passou do tempo,
 * ou mandou outra coisa antes do `auth`). O 4001 fica só pra sessão inválida de verdade:
 * o app desloga com ele, e até a 1.14 era com ele que essas fechavam.
 */
export const CLOSE_RETRY = 4006

/** Cabeçalho que o Worker põe com o IP embaralhado de quem abre o WebSocket. */
export const IP_HEADER = 'X-Resenha-Ip'

/** Conexões sem login vindas do mesmo IP (o app abre uma por servidor, mais a pessoal). */
const MAX_PENDING_PER_IP = 8

/**
 * Uma conexão nova entra? As que ainda não se autenticaram têm vaga limitada, no total e por
 * IP. Lotado no total, a pendente mais antiga sai: o app de verdade autentica em milissegundos,
 * e quem abre sockets sem mandar nada não segura a porta pros outros.
 */
export function admitPending(pending: { ws: WebSocket; connectedAt: number; ip?: string }[], ip: string | null, max: number): boolean {
  if (ip && pending.filter((p) => p.ip === ip).length >= MAX_PENDING_PER_IP) return false
  if (pending.length >= max) {
    const oldest = pending.reduce((a, b) => (a.connectedAt <= b.connectedAt ? a : b))
    try {
      oldest.ws.close(CLOSE_RETRY, 'Faltou autenticar')
    } catch {
      // já estava fechando
    }
  }
  return true
}

/**
 * Fechamentos de propósito: o app saiu (1000, 1001), a sessão acabou (4001),
 * saiu do servidor (4003), o servidor foi excluído (4004), outra conexão
 * tomou o lugar (4005) ou o servidor pausou o app (4008, ver budget.ts).
 * Esses não esperam ninguém voltar.
 */
const DELIBERATE = new Set([1000, 1001, 4001, 4003, 4004, 4005, 4008])

export function unexpectedClose(code: number): boolean {
  return !DELIBERATE.has(code)
}

export async function connIdFor(userId: string, key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`conn:${userId}:${key}`)))
  let text = ''
  for (const byte of digest.subarray(0, 12)) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_')
}

/** Tempo de espera (o teste encurta pela variável `RESUME_GRACE_MS`). */
export function graceFor(env: { RESUME_GRACE_MS?: string }): number {
  const custom = Number(env.RESUME_GRACE_MS)
  return Number.isFinite(custom) && custom > 0 ? custom : RESUME_GRACE
}
