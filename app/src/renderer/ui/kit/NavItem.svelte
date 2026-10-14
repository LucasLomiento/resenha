<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import Badge from './Badge.svelte'
  import Icon, { type IconName } from './Icon.svelte'

  interface Props extends HTMLButtonAttributes {
    label: string
    icon?: IconName
    /** Aberto agora. */
    active?: boolean
    /** Tem coisa nova: texto forte e a marquinha na borda. */
    unread?: boolean
    /** Silenciado: fica mais apagado. */
    muted?: boolean
    /** Menções não lidas. */
    count?: number
    /** No lugar do ícone (avatar, por exemplo). */
    leading?: Snippet
    /** Depois do nome (ações, selos). */
    trailing?: Snippet
    tone?: 'default' | 'danger'
  }

  let {
    label,
    icon,
    active = false,
    unread = false,
    muted = false,
    count = 0,
    leading,
    trailing,
    tone = 'default',
    type = 'button',
    class: className,
    ...rest
  }: Props = $props()
</script>

<button
  {type}
  class={['nav-item', `tone-${tone}`, className, { active, unread: unread && !active, muted }]}
  aria-current={active ? 'page' : undefined}
  {...rest}
>
  {#if unread && !active}<span class="pip" aria-hidden="true"></span>{/if}
  {#if leading}
    {@render leading()}
  {:else if icon}
    <Icon name={icon} size={18} class="nav-icon" />
  {/if}
  <span class="nav-label">{label}</span>
  {#if count > 0}<Badge tone="count">{count}</Badge>{/if}
  {@render trailing?.()}
</button>

<style>
  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 34px;
    padding: 0 8px 0 10px;
    border-radius: var(--r-md);
    color: var(--fg-3);
    font-size: var(--text-md);
    font-weight: 450;
    text-align: left;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  .nav-item:hover:not(:disabled) {
    background: var(--hover);
    color: var(--fg-2);
  }

  .nav-item :global(.nav-icon) {
    color: var(--fg-3);
    transition: color var(--t-fast) var(--ease);
  }

  .active,
  .active:hover:not(:disabled) {
    background: var(--selected);
    box-shadow: var(--highlight);
    color: var(--fg);
    font-weight: 550;
  }

  .active :global(.nav-icon) {
    color: var(--accent-fg);
  }

  .unread {
    color: var(--fg);
    font-weight: 600;
  }

  .unread :global(.nav-icon) {
    color: var(--fg-2);
  }

  .muted {
    opacity: 0.55;
  }

  .tone-danger,
  .tone-danger :global(.nav-icon) {
    color: var(--red);
  }

  .tone-danger:hover:not(:disabled) {
    background: var(--red-soft);
    color: var(--red);
  }

  .nav-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Novidade: um ponto azul no vão à esquerda do item. */
  .pip {
    position: absolute;
    left: -7px;
    top: 50%;
    width: 6px;
    height: 6px;
    margin-top: -3px;
    border-radius: var(--r-full);
    background: var(--accent);
    box-shadow: 0 0 8px rgb(var(--accent-rgb) / 0.6);
  }
</style>
