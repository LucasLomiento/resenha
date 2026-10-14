<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import Icon, { type IconName } from './Icon.svelte'
  import Spinner from './Spinner.svelte'

  interface Props extends HTMLButtonAttributes {
    /** primary: a ação principal da tela (uma só). danger: só na confirmação de algo destrutivo. */
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft'
    size?: 'sm' | 'md' | 'lg'
    icon?: IconName
    /** Mostra o carregando no lugar do ícone e trava o botão. */
    loading?: boolean
    /** Ocupa a largura toda. */
    full?: boolean
    children?: Snippet
  }

  let {
    variant = 'secondary',
    size = 'md',
    icon,
    loading = false,
    full = false,
    type = 'button',
    disabled,
    class: className,
    children,
    ...rest
  }: Props = $props()

  const iconSize = $derived(size === 'sm' ? 14 : 16)
</script>

<button {type} class={['btn', variant, size, className, { full }]} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
  {#if loading}
    <Spinner size={iconSize} />
  {:else if icon}
    <Icon name={icon} size={iconSize} />
  {/if}
  {#if children}<span class="text">{@render children()}</span>{/if}
</button>

<style>
  .btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    flex: none;
    height: var(--h-md);
    padding: 0 16px;
    border-radius: var(--r-full);
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: -0.005em;
    line-height: 1;
    white-space: nowrap;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease),
      box-shadow var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }

  .btn:active:not(:disabled) {
    transform: translateY(0.5px) scale(0.985);
  }

  .btn:disabled {
    opacity: 0.45;
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .full {
    display: flex;
    width: 100%;
  }

  .sm {
    height: var(--h-sm);
    padding: 0 12px;
    gap: 6px;
    font-size: var(--text-xs);
  }

  .lg {
    height: var(--h-xl);
    padding: 0 22px;
    font-size: var(--text-md);
  }

  .primary {
    background: var(--accent);
    color: var(--fg-on-accent);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.35),
      inset 0 -1px 0 rgb(0 0 0 / 0.12),
      0 1px 2px rgb(0 0 0 / 0.4);
  }

  .primary:disabled,
  .danger:disabled {
    opacity: 1;
    background: var(--selected);
    color: var(--fg-3);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .primary:active:not(:disabled) {
    background: var(--accent-press);
  }

  .secondary {
    background: var(--selected);
    color: var(--fg);
    box-shadow:
      inset 0 0 0 1px var(--line),
      var(--highlight);
  }

  .secondary:hover:not(:disabled) {
    background: var(--press);
  }

  .ghost {
    color: var(--fg-2);
  }

  .ghost:hover:not(:disabled) {
    background: var(--hover);
    color: var(--fg);
  }

  .danger {
    background: var(--red-fill);
    color: #fff;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.18),
      0 1px 2px rgb(0 0 0 / 0.4);
  }

  .danger:hover:not(:disabled) {
    background: var(--red-fill-hover);
  }

  .danger-soft {
    background: var(--red-soft);
    color: var(--red);
  }

  .danger-soft:hover:not(:disabled) {
    background: rgb(255 90 107 / 0.22);
    color: var(--red-hover);
  }
</style>
