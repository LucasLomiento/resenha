<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import Icon, { type IconName } from './Icon.svelte'

  interface Props extends Omit<HTMLInputAttributes, 'size'> {
    label?: string
    /** Uma linha, só se ajudar a preencher. */
    hint?: string
    error?: string | null
    value?: string
    size?: 'md' | 'lg'
    icon?: IconName
    /** Botão ou texto dentro do campo, à direita. */
    trailing?: Snippet
    /** Mono: códigos de convite, atalhos. */
    mono?: boolean
    input?: HTMLInputElement
  }

  let {
    label,
    hint,
    error = null,
    value = $bindable(''),
    size = 'md',
    icon,
    trailing,
    mono = false,
    input = $bindable(),
    class: className,
    id,
    ...rest
  }: Props = $props()

  const uid = $props.id()
  const inputId = $derived(id ?? `field-${uid}`)
</script>

<div class={['field', className, { invalid: !!error }]}>
  {#if label}<label class="field-label" for={inputId}>{label}</label>{/if}
  <div class={['control', size]}>
    {#if icon}<Icon name={icon} size={16} class="lead" />{/if}
    <input
      bind:this={input}
      bind:value
      id={inputId}
      class:mono
      aria-invalid={error ? true : undefined}
      aria-describedby={error || hint ? `${inputId}-note` : undefined}
      {...rest}
    />
    {@render trailing?.()}
  </div>
  {#if error}
    <p class="note error" id="{inputId}-note"><Icon name="circle-alert" size={14} />{error}</p>
  {:else if hint}
    <p class="note" id="{inputId}-note">{hint}</p>
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--fg-2);
  }

  .control {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    height: var(--h-lg);
    padding: 0 12px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--fg-3);
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .control.lg {
    height: var(--h-xl);
    padding: 0 14px;
    font-size: var(--text-lg);
  }

  .control:hover {
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16);
  }

  .control:focus-within {
    box-shadow:
      inset 0 0 0 1px var(--accent-line),
      0 0 0 3px rgb(122 108 255 / 0.18);
  }

  .invalid .control {
    box-shadow: inset 0 0 0 1px rgb(255 92 114 / 0.55);
  }

  /* Só leitura (nome de usuário fixo): sem cara de campo pra digitar. */
  .control:has(input:read-only):not(:focus-within) {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--line);
  }

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--fg);
    user-select: text;
  }

  input::placeholder {
    color: var(--fg-3);
  }

  input.mono {
    font-family: var(--mono);
    letter-spacing: 0.02em;
  }

  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--fg-3);
  }

  .note.error {
    color: var(--red);
  }
</style>
