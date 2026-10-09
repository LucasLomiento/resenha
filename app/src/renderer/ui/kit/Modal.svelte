<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import { m } from '../../lib/i18n.svelte'
  import IconButton from './IconButton.svelte'
  import { layer } from './layers'
  import { portal } from './position'

  let {
    title,
    description,
    size = 'md',
    onclose,
    dismissible = true,
    class: className,
    children,
    footer,
  }: {
    title: string
    /** Uma frase, só quando o título não basta. */
    description?: string
    /** 400 · 480 · 640 · 760 px */
    size?: 'sm' | 'md' | 'lg' | 'xl'
    onclose: () => void
    /** false: só fecha pelos botões (ex.: algo carregando). */
    dismissible?: boolean
    class?: string
    children?: Snippet
    footer?: Snippet
  } = $props()

  const uid = $props.id()
  let dialog = $state<HTMLDivElement>()

  // Foco entra no diálogo e volta pra onde estava quando ele fecha.
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = dialog?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), select, textarea')
    ;(first ?? dialog)?.focus({ preventScroll: true })
    return () => previous?.focus?.({ preventScroll: true })
  })
</script>

<div
  class="backdrop"
  role="presentation"
  use:portal
  use:layer={() => dismissible && onclose()}
  onmousedown={(e) => dismissible && e.target === e.currentTarget && onclose()}
>
  <div
    bind:this={dialog}
    class={['modal', size, className]}
    role="dialog"
    aria-modal="true"
    aria-labelledby="{uid}-title"
    tabindex="-1"
  >
    <header>
      <div class="titles">
        <h2 id="{uid}-title">{title}</h2>
        {#if description}<p>{description}</p>{/if}
      </div>
      {#if dismissible}<IconButton icon="x" label={m.common.close} size="sm" tip="bottom" onclick={onclose} />{/if}
    </header>
    {#if children}
      <div class="body">
        {@render children()}
      </div>
    {:else}
      <div class="spacer"></div>
    {/if}
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    padding: var(--s-6);
    background: rgb(4 4 8 / 0.66);
    backdrop-filter: blur(3px);
    animation: rs-fade-in var(--t) var(--ease);
  }

  .modal {
    display: flex;
    flex-direction: column;
    width: 480px;
    max-width: 100%;
    max-height: 100%;
    border-radius: var(--r-2xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    animation: rs-pop-in var(--t-slow) var(--ease);
  }

  .modal:focus {
    outline: none;
  }

  .sm {
    width: 400px;
  }

  .lg {
    width: 640px;
  }

  .xl {
    width: 760px;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: 20px 16px 4px 24px;
  }

  .titles {
    flex: 1;
    min-width: 0;
    padding-top: 2px;
  }

  h2 {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .titles p {
    margin-top: 4px;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .body {
    flex: 1;
    min-height: 0;
    padding: 12px 24px 20px;
    overflow-y: auto;
  }

  .spacer {
    height: 20px;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--s-2);
    padding: 4px 24px 20px;
  }
</style>
