<script lang="ts" generics="T extends string">
  import Icon, { type IconName } from './Icon.svelte'

  interface Option {
    value: T
    label: string
    /** Segunda linha, curta (ex.: "Jogos e vídeos"). */
    hint?: string
    icon?: IconName
    disabled?: boolean
  }

  let {
    options,
    value = $bindable(),
    onchange,
    label,
    size = 'md',
    class: className,
  }: {
    options: Option[]
    value: T
    onchange?: (value: T) => void
    /** Nome do grupo pra leitor de tela. */
    label?: string
    size?: 'sm' | 'md'
    class?: string
  } = $props()

  const index = $derived(options.findIndex((o) => o.value === value))
  const twoLine = $derived(options.some((o) => o.hint))

  function pick(option: Option) {
    if (option.disabled || option.value === value) return
    value = option.value
    onchange?.(option.value)
  }
</script>

<div
  class={['segmented', size, className, { 'two-line': twoLine }]}
  role="radiogroup"
  aria-label={label}
  style:--n={options.length}
  style:--i={Math.max(index, 0)}
>
  {#if index >= 0}<span class="thumb" aria-hidden="true"></span>{/if}
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={option.value === value}
      class:on={option.value === value}
      disabled={option.disabled}
      onclick={() => pick(option)}
    >
      <span class="main">
        {#if option.icon}<Icon name={option.icon} size={15} />{/if}
        {option.label}
      </span>
      {#if option.hint}<span class="hint">{option.hint}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .segmented {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    padding: 3px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc((100% - 6px) / var(--n));
    transform: translateX(calc(var(--i) * 100%));
    border-radius: 7px;
    background: rgb(255 255 255 / 0.1);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.07),
      0 1px 3px rgb(0 0 0 / 0.45);
    transition: transform var(--t) var(--ease);
  }

  button {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    min-width: 0;
    height: 28px;
    padding: 0 10px;
    border-radius: 7px;
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 500;
    transition: color var(--t-fast) var(--ease);
  }

  button:hover:not(:disabled):not(.on) {
    color: var(--fg);
  }

  button.on {
    color: var(--fg);
  }

  button:disabled {
    opacity: 0.4;
  }

  .main {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .two-line button {
    height: 46px;
  }

  .two-line .main {
    font-weight: 550;
  }

  .hint {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--fg-3);
  }

  .sm button {
    height: 24px;
    font-size: var(--text-xs);
  }
</style>
