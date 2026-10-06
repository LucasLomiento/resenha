<script lang="ts">
  import { Icon, tooltip, type IconName } from '../kit'
  import type { TriValue } from './permissions'

  let {
    value,
    label,
    disabled = false,
    onchange,
  }: {
    value: TriValue
    /** Nome da permissão, pra leitor de tela. */
    label: string
    disabled?: boolean
    onchange: (value: TriValue) => void
  } = $props()

  const OPTIONS: { value: TriValue; label: string; icon: IconName }[] = [
    { value: 'deny', label: 'Negar', icon: 'x' },
    { value: 'neutral', label: 'Neutro', icon: 'slash' },
    { value: 'allow', label: 'Permitir', icon: 'check' },
  ]

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const i = OPTIONS.findIndex((o) => o.value === value)
    const next = OPTIONS[Math.min(OPTIONS.length - 1, Math.max(0, i + (event.key === 'ArrowRight' ? 1 : -1)))]
    if (next.value !== value) onchange(next.value)
    const group = event.currentTarget as HTMLElement
    queueMicrotask(() => group.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus())
  }
</script>

<!-- Exceção de um canal: negar, neutro (vale o cargo) ou permitir. -->
<div class="tri" role="radiogroup" aria-label={label} tabindex="-1" {onkeydown}>
  {#each OPTIONS as option (option.value)}
    <button
      type="button"
      role="radio"
      class={option.value}
      aria-checked={option.value === value}
      aria-label={option.label}
      tabindex={option.value === value ? 0 : -1}
      {disabled}
      use:tooltip={{ text: option.label, placement: 'top' }}
      onclick={() => option.value !== value && onchange(option.value)}
    >
      <Icon name={option.icon} size={14} stroke={2} />
    </button>
  {/each}
</div>

<style>
  .tri {
    display: inline-flex;
    padding: 2px;
    border-radius: var(--r-md);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 24px;
    border-radius: var(--r-sm);
    color: var(--fg-4);
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  button:hover:not(:disabled):not([aria-checked='true']) {
    background: var(--hover);
    color: var(--fg-2);
  }

  button:disabled {
    opacity: 0.4;
  }

  .deny[aria-checked='true'] {
    background: var(--red-soft);
    color: var(--red);
  }

  .neutral[aria-checked='true'] {
    background: var(--selected);
    color: var(--fg-2);
  }

  .allow[aria-checked='true'] {
    background: var(--green-soft);
    color: var(--green);
  }
</style>
