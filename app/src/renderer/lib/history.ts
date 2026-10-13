import type { Message } from '../../../../shared/protocol'

/** Junta mensagens sem repetir, em ordem (o id cresce com o tempo). */
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
}

/**
 * Depois de uma queda, o canal na tela recebe o trecho mais recente de novo, sem esvaziar a
 * lista. O trecho manda no intervalo dele (o que foi apagado ou editado enquanto a conexão
 * estava fora se acerta), as antigas continuam se a tela já chegava no trecho (sem buraco no
 * meio) e o que chegou depois do pedido fica. `mark`: a mensagem mais nova da tela na hora do
 * pedido. `kept`: as antigas ficaram (o "tem mais pra trás" de antes continua valendo).
 */
export function freshTail(current: Message[], page: Message[], mark: string): { messages: Message[]; kept: boolean } {
  const arrived = current.filter((m) => m.id > mark)
  if (page.length === 0) return { messages: arrived, kept: false }
  const first = page[0].id
  const last = page[page.length - 1].id
  const known = current.filter((m) => m.id <= mark)
  const older = known.filter((m) => m.id < first)
  const kept = older.length > 0 && known.some((m) => m.id >= first)
  return { messages: [...(kept ? older : []), ...page, ...arrived.filter((m) => m.id > last)], kept }
}
