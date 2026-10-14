<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon, { type IconName } from './Icon.svelte'

  let {
    icon,
    title,
    description,
    align = 'center',
    class: className,
    media,
    actions,
  }: {
    icon?: IconName
    title: string
    description?: string
    align?: 'center' | 'start'
    class?: string
    /** No lugar do ícone (avatar grande, por exemplo). */
    media?: Snippet
    actions?: Snippet
  } = $props()
</script>

<div class={['empty', align, className]}>
  {#if media}
    {@render media()}
  {:else if icon}
    <div class="tile"><Icon name={icon} size={24} /></div>
  {/if}
  <h2>{title}</h2>
  {#if description}<p>{description}</p>{/if}
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .center {
    align-items: center;
    text-align: center;
  }

  .start {
    align-items: flex-start;
  }

  .tile {
    position: relative;
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    margin-bottom: var(--s-2);
    border-radius: 18px;
    background:
      linear-gradient(var(--bg-raised), var(--bg-raised)) padding-box,
      linear-gradient(135deg, rgb(var(--brand-1-rgb) / 0.7), rgb(var(--accent-rgb) / 0.25), rgb(var(--brand-3-rgb) / 0.55)) border-box;
    border: 1px solid transparent;
    color: var(--accent-fg);
    box-shadow: 0 12px 32px -12px rgb(var(--accent-rgb) / 0.3);
  }

  h2 {
    color: var(--fg);
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  p {
    max-width: 420px;
    color: var(--fg-2);
    font-size: var(--text-md);
  }

  .actions {
    display: flex;
    gap: var(--s-2);
    margin-top: var(--s-2);
  }
</style>
