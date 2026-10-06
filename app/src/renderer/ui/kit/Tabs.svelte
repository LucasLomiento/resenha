<script lang="ts" generics="T extends string">
  let {
    tabs,
    value = $bindable(),
    onchange,
    label,
    class: className,
  }: {
    tabs: { value: T; label: string; count?: number; alert?: boolean }[]
    value: T
    onchange?: (value: T) => void
    label?: string
    class?: string
  } = $props()
</script>

<div class={['tabs', className]} role="tablist" aria-label={label}>
  {#each tabs as tab (tab.value)}
    <button
      type="button"
      role="tab"
      aria-selected={tab.value === value}
      class:on={tab.value === value}
      onclick={() => {
        if (tab.value === value) return
        value = tab.value
        onchange?.(tab.value)
      }}
    >
      {tab.label}
      {#if tab.count}<span class="count" class:alert={tab.alert}>{tab.count}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: var(--r-md);
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  button:hover:not(.on) {
    background: var(--hover);
    color: var(--fg);
  }

  button.on {
    background: var(--selected);
    color: var(--fg);
  }

  .count {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--r-full);
    background: rgb(255 255 255 / 0.08);
    color: var(--fg-2);
    font-size: var(--text-2xs);
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .count.alert {
    background: var(--red);
    color: #fff;
  }
</style>
