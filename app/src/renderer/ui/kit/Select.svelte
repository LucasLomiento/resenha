<script lang="ts" generics="T extends string">
  import type { HTMLSelectAttributes } from 'svelte/elements'
  import Icon from './Icon.svelte'

  interface Props extends Omit<HTMLSelectAttributes, 'value' | 'size'> {
    value: T
    options: { value: T; label: string }[]
    /** Nome pra leitor de tela quando não há rótulo visível ligado. */
    label?: string
    size?: 'sm' | 'md'
  }

  let { value = $bindable(), options, label, size = 'md', class: className, ...rest }: Props = $props()
</script>

<span class={['select', size, className]}>
  <select bind:value aria-label={label} {...rest}>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <Icon name="chevron-down" size={16} />
</span>

<style>
  .select {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-width: 0;
    width: 100%;
    color: var(--fg-3);
  }

  select {
    appearance: none;
    width: 100%;
    height: var(--h-md);
    padding: 0 34px 0 12px;
    border: 0;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--fg);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    cursor: pointer;
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .sm select {
    height: var(--h-sm);
    border-radius: var(--r-md);
    font-size: var(--text-xs);
  }

  select:hover:not(:disabled) {
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16);
  }

  select:focus-visible {
    outline: none;
    box-shadow:
      inset 0 0 0 1px var(--accent-line),
      0 0 0 3px rgb(122 108 255 / 0.18);
  }

  select:disabled {
    opacity: 0.45;
    cursor: default;
  }

  option {
    background: var(--bg-raised);
    color: var(--fg);
  }

  .select :global(svg) {
    position: absolute;
    right: 10px;
    pointer-events: none;
  }
</style>
