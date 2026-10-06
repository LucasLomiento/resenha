<script lang="ts" generics="T extends string">
  let {
    options,
    value = $bindable(),
    onchange,
    label,
  }: {
    /** Use quando cada opção precisa de uma frase de explicação; senão, Segmented. */
    options: { value: T; label: string; description?: string }[]
    value: T
    onchange?: (value: T) => void
    label?: string
  } = $props()
</script>

<div class="radio-group" role="radiogroup" aria-label={label}>
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={option.value === value}
      class:on={option.value === value}
      onclick={() => {
        if (option.value === value) return
        value = option.value
        onchange?.(option.value)
      }}
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="text">
        <span class="label">{option.label}</span>
        {#if option.description}<span class="description">{option.description}</span>{/if}
      </span>
    </button>
  {/each}
</div>

<style>
  .radio-group {
    display: flex;
    flex-direction: column;
  }

  button {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px;
    text-align: left;
    transition: background-color var(--t-fast) var(--ease);
  }

  button + button {
    border-top: 1px solid var(--line);
  }

  button:hover {
    background: rgb(255 255 255 / 0.02);
  }

  .dot {
    flex: none;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--fg-3);
    transition: box-shadow var(--t) var(--ease);
  }

  .on .dot {
    box-shadow:
      inset 0 0 0 5px var(--accent),
      inset 0 0 0 9px #fff;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label {
    font-weight: 500;
  }

  .description {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }
</style>
