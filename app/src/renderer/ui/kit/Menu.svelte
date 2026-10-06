<script lang="ts" module>
  import type { IconName } from './Icon.svelte'

  export type MenuItem =
    | {
        kind?: 'item'
        label: string
        icon?: IconName
        /** Texto à direita: atalho ou valor atual. */
        hint?: string
        danger?: boolean
        disabled?: boolean
        /** Item marcável (mostra o check à direita). */
        checked?: boolean
        onselect?: () => void
      }
    | { kind: 'separator' }
    | { kind: 'label'; label: string }
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import Icon from './Icon.svelte'
  import Popover from './Popover.svelte'
  import type { Placement } from './position'

  let {
    items,
    anchor,
    placement = 'bottom-start',
    onclose,
    inline = false,
    width = 220,
    label,
  }: {
    items: MenuItem[]
    anchor?: HTMLElement | { x: number; y: number } | null
    placement?: Placement
    onclose?: () => void
    inline?: boolean
    width?: number
    label?: string
  } = $props()

  let list = $state<HTMLDivElement>()

  function buttons() {
    return [...(list?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  }

  onMount(() => {
    if (!inline) buttons()[0]?.focus({ preventScroll: true })
  })

  function onkeydown(event: KeyboardEvent) {
    const all = buttons()
    const index = all.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      all[(index + step + all.length) % all.length]?.focus()
    } else if (event.key === 'Tab') {
      onclose?.()
    }
  }

  function select(item: Extract<MenuItem, { label: string; kind?: 'item' }>) {
    if (item.disabled) return
    onclose?.()
    item.onselect?.()
  }
</script>

<Popover {anchor} {placement} {onclose} {inline} {width} {label} role="menu" class="menu">
  <div class="list" bind:this={list} role="none" onkeydown={onkeydown}>
    {#each items as item, i (i)}
      {#if item.kind === 'separator'}
        <div class="separator" role="separator"></div>
      {:else if item.kind === 'label'}
        <div class="group-label">{item.label}</div>
      {:else}
        <button
          type="button"
          role="menuitem"
          class:danger={item.danger}
          disabled={item.disabled}
          onclick={() => select(item)}
        >
          {#if item.icon}<Icon name={item.icon} size={16} />{/if}
          <span class="label">{item.label}</span>
          {#if item.checked}<Icon name="check" size={16} class="check" />{:else if item.hint}<span class="hint">{item.hint}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
</Popover>

<style>
  .list {
    display: flex;
    flex-direction: column;
    padding: 6px;
  }

  button {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--r-md);
    color: var(--fg);
    font-size: var(--text-sm);
    text-align: left;
    transition: background-color var(--t-fast) var(--ease);
  }

  button :global(svg) {
    color: var(--fg-2);
  }

  button:hover:not(:disabled),
  button:focus-visible {
    outline: none;
    background: var(--selected);
  }

  button:disabled {
    opacity: 0.4;
  }

  .danger,
  .danger :global(svg) {
    color: var(--red);
  }

  .danger:hover:not(:disabled),
  .danger:focus-visible {
    background: var(--red-soft);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  button :global(.check) {
    color: var(--accent-fg);
  }

  .separator {
    height: 1px;
    margin: 5px 6px;
    background: var(--line);
  }

  .group-label {
    padding: 8px 10px 4px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }
</style>
