<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import { layer } from './layers'
  import { boxOf, place, portal, type Placement } from './position'

  let {
    anchor,
    placement = 'bottom-start',
    gap = 8,
    onclose,
    inline = false,
    width,
    label,
    role = 'dialog',
    class: className,
    children,
  }: {
    /** Elemento ou ponto (clique com o botão direito) onde o popover encosta. */
    anchor?: HTMLElement | { x: number; y: number } | null
    placement?: Placement
    gap?: number
    onclose?: () => void
    /** Renderiza no lugar, sem flutuar (protótipos e documentação). */
    inline?: boolean
    width?: number
    label?: string
    role?: 'dialog' | 'menu'
    class?: string
    children: Snippet
  } = $props()

  let el = $state<HTMLDivElement>()
  let pos = $state<{ x: number; y: number } | null>(null)

  function update() {
    if (inline || !el || !anchor) return
    const target = anchor instanceof HTMLElement ? boxOf(anchor) : { left: anchor.x, top: anchor.y, width: 0, height: 0 }
    const { x, y } = place(target, { width: el.offsetWidth, height: el.offsetHeight }, placement, gap)
    pos = { x, y }
  }

  $effect(() => {
    void anchor
    void placement
    update()
  })

  onMount(() => {
    if (inline) return
    // Clique fora fecha (no próprio alvo não: ele mesmo alterna aberto/fechado).
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (el?.contains(target)) return
      if (anchor instanceof HTMLElement && anchor.contains(target)) return
      onclose?.()
    }
    const resize = () => update()
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', resize)
    const observer = new ResizeObserver(resize)
    if (el) observer.observe(el)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', resize)
      observer.disconnect()
    }
  })
</script>

{#if inline}
  <div class={['popover', 'inline', className]} {role} aria-label={label} style:width={width ? `${width}px` : null}>
    {@render children()}
  </div>
{:else}
  <div
    bind:this={el}
    class={['popover', className]}
    {role}
    aria-label={label}
    use:portal
    use:layer={() => onclose?.()}
    style:width={width ? `${width}px` : null}
    style:left="{pos?.x ?? 0}px"
    style:top="{pos?.y ?? 0}px"
    style:visibility={pos ? 'visible' : 'hidden'}
  >
    {@render children()}
  </div>
{/if}

<style>
  .popover {
    position: fixed;
    z-index: var(--z-popover);
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    animation: rs-pop-in var(--t) var(--ease);
  }

  .inline {
    position: relative;
    z-index: auto;
    animation: none;
  }
</style>
