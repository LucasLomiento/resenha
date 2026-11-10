// A ordem dos servidores no trilho: a que a pessoa arrastou (guardada neste aparelho, em
// `settings.guildOrder`) por cima da ordem em que o servidor manda. Puro, pra dar pra testar.

/**
 * Os itens na ordem escolhida. O que não está na lista (servidor em que a pessoa entrou depois)
 * vai pro fim, na ordem de sempre; id da lista que não existe mais é ignorado.
 */
export function orderBy<T extends { id: string }>(items: T[], order: readonly string[]): T[] {
  if (order.length === 0) return items
  const rank = new Map(order.map((id, i) => [id, i]))
  return items
    .map((item, i) => ({ item, at: rank.get(item.id) ?? order.length + i }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.item)
}

/** A lista de ids depois de arrastar `moving` pra antes ou depois de `target`. */
export function moveId(ids: readonly string[], moving: string, target: string, place: 'before' | 'after'): string[] {
  if (moving === target || !ids.includes(moving) || !ids.includes(target)) return [...ids]
  const rest = ids.filter((id) => id !== moving)
  const at = rest.indexOf(target) + (place === 'after' ? 1 : 0)
  return [...rest.slice(0, at), moving, ...rest.slice(at)]
}
