// Ids das RTCPeerConnection na sinalização (`pc` = a de quem manda, `ack` = a minha, até onde quem
// manda sabe). Cada lado pode refazer a conexão dele (rota, queda, sala pelo Cloudflare) e o outro
// precisa perceber e acompanhar sem os dois ficarem presos em conexões que já morreram.

import type { SignalData } from '../../../../shared/protocol'

let lastIdAt = 0

/**
 * Id de uma conexão: a hora em que foi criada (base 36), um ponto e um sorteio. Pela hora, quem
 * recebe sabe qual de duas conexões do mesmo app é a mais nova, mesmo com mensagens fora de ordem.
 * O app até a 1.16 manda só o sorteio (sem o ponto): aí não dá pra saber.
 */
export function peerId(): string {
  lastIdAt = Math.max(lastIdAt + 1, Date.now())
  return `${lastIdAt.toString(36)}.${crypto.randomUUID().slice(0, 4)}`
}

/** A conexão `a` foi criada depois da `b` (as duas do mesmo app)? null: id de app antigo. */
export function newerPeer(a: string, b: string): boolean | null {
  const at = a.includes('.') ? parseInt(a.split('.')[0], 36) : NaN
  const bt = b.includes('.') ? parseInt(b.split('.')[0], 36) : NaN
  return Number.isFinite(at) && Number.isFinite(bt) ? at > bt : null
}

/**
 * O que fazer com a sinalização que chegou (pela id das conexões nela):
 * - `drop`: é pra uma conexão minha que já não existe, ou vem de uma do outro lado que já foi trocada;
 * - `follow`: o outro lado está noutra conexão, e eu ainda não negociei com a anterior: passo a falar com a nova;
 * - `recreate`: está noutra, e eu já negociei com a anterior (não dá pra trocar o par por baixo): refaço a minha;
 * - `handle`: é dessa conexão mesmo (ou da primeira que aparece).
 *
 * Recriar só depois de negociar é o que faz isso terminar: a conexão refeita ainda não negociou com
 * ninguém, então, se o outro lado também refizer a dele, ela segue a nova em vez de refazer de novo.
 * Até a 1.16, quem refazia junto podia ficar preso numa conexão do outro lado que já tinha morrido
 * (as duas pontas em `have-local-offer`, ignorando tudo uma da outra).
 */
export function signalRoute(
  peer: { id: string; remoteId: string | null; described: boolean } | undefined,
  data: Pick<SignalData, 'pc' | 'ack'>,
  replaced: readonly string[] = [],
): 'drop' | 'follow' | 'recreate' | 'handle' {
  // App antigo (sem as ids): vai direto.
  if (!data.pc) return 'handle'
  // De uma conexão que o outro lado já trocou (ou mais velha que ela): chegou atrasada.
  const pc = data.pc
  if (replaced.some((old) => old === pc || newerPeer(old, pc) === true)) return 'drop'
  if (!peer) return 'handle'
  if (data.ack && data.ack !== peer.id) return 'drop'
  if (!peer.remoteId || peer.remoteId === pc) return 'handle'
  if (newerPeer(pc, peer.remoteId) === false) return 'drop'
  return peer.described ? 'recreate' : 'follow'
}
