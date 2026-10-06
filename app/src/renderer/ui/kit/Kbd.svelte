<script lang="ts">
  let { keys, class: className }: { keys: string | string[]; class?: string } = $props()

  /** "Ctrl + Shift + M" vira três teclas. */
  const parts = $derived(Array.isArray(keys) ? keys : keys.split(' + '))
</script>

<span class={['kbd', className]}>
  {#each parts as key, i (i)}<kbd>{key}</kbd>{/each}
</span>

<style>
  .kbd {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: var(--r-sm);
    background: rgb(255 255 255 / 0.06);
    box-shadow:
      inset 0 0 0 1px var(--line-strong),
      inset 0 -1px 0 rgb(0 0 0 / 0.35);
    color: var(--fg);
    font: 500 11.5px/1 var(--mono);
  }
</style>
