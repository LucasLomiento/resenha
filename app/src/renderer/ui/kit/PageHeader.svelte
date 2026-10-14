<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    description,
    setting,
    actions,
  }: {
    title: string
    description?: string
    /** Âncora da busca nas configurações (id do índice). */
    setting?: string
    actions?: Snippet
  } = $props()
</script>

<header class="page-header" data-setting={setting}>
  <div class="titles">
    <h1>{title}</h1>
    {#if description}<p>{description}</p>{/if}
  </div>
  {@render actions?.()}
</header>

<style>
  .page-header {
    display: flex;
    align-items: flex-end;
    gap: var(--s-4);
    margin-bottom: var(--s-6);
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  h1 {
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }

  p {
    margin-top: 6px;
    color: var(--fg-2);
    font-size: var(--text-md);
  }
</style>
