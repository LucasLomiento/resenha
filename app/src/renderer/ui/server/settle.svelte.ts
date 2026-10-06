import { client } from '../../lib/client.svelte'

/**
 * As ações de administração vão pelo WebSocket sem resposta própria: o servidor
 * só manda o estado novo (ou um erro, que vira aviso). Isto espera um dos dois:
 * `done()` ficar verdadeiro (true) ou aparecer um aviso de erro novo (false).
 * Sem nenhum dos dois até o `timeout`, desiste (false).
 */
export function settled(done: () => boolean, timeout = 8000): Promise<boolean> {
  const since = client.toasts.reduce((max, t) => Math.max(max, t.id), 0)
  return new Promise((resolve) => {
    let finished = false
    let stop: (() => void) | null = null
    const finish = (ok: boolean) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      // Fora do efeito que está rodando agora.
      queueMicrotask(() => stop?.())
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeout)
    stop = $effect.root(() => {
      $effect(() => {
        if (done()) finish(true)
        else if (client.toasts.some((t) => t.kind === 'error' && t.id > since)) finish(false)
      })
    })
  })
}
