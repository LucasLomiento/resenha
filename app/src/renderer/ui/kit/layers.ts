// Pilha de camadas (modal, menu, configurações, visualizador de imagem):
// o Esc fecha só a de cima, nunca duas de uma vez.

interface Layer {
  close: () => void
}

const stack: Layer[] = []
let listening = false

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || stack.length === 0) return
  // Campo que usa o Esc pra si (cancelar uma edição) marca data-own-escape.
  if ((event.target as HTMLElement | null)?.closest?.('[data-own-escape]')) return
  event.preventDefault()
  event.stopImmediatePropagation()
  stack[stack.length - 1].close()
}

/** Registra uma camada aberta; devolve a função que a tira da pilha (chame ao fechar). */
export function pushLayer(close: () => void): () => void {
  if (!listening) {
    window.addEventListener('keydown', onKeydown, true)
    listening = true
  }
  const layer = { close }
  stack.push(layer)
  return () => {
    const index = stack.indexOf(layer)
    if (index >= 0) stack.splice(index, 1)
  }
}

/** Ação Svelte: `use:layer={fechar}` no elemento raiz da camada. */
export function layer(_node: HTMLElement, close: () => void) {
  let current = close
  const pop = pushLayer(() => current())
  return {
    update(next: () => void) {
      current = next
    },
    destroy: pop,
  }
}
