<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    description,
    actions,
  }: {
    title: string
    description?: string
    actions?: Snippet
  } = $props()
</script>

<header class="page-header">
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
    font-size: var(--text-2xl);
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  p {
    margin-top: 6px;
    color: var(--fg-2);
    font-size: var(--text-md);
  }
</style>
