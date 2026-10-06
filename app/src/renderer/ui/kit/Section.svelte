<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    description,
    note,
    plain = false,
    class: className,
    actions,
    children,
  }: {
    title?: string
    description?: string
    /** Legenda curta embaixo do cartão. */
    note?: string
    /** Sem o cartão em volta (conteúdo solto). */
    plain?: boolean
    class?: string
    /** Botões à direita do título. */
    actions?: Snippet
    children: Snippet
  } = $props()
</script>

<!-- Grupo de configurações: título curto + cartão com linhas (Row) separadas por fio. -->
<section class={['section', className]}>
  {#if title || actions}
    <header>
      <div class="titles">
        {#if title}<h3>{title}</h3>{/if}
        {#if description}<p>{description}</p>{/if}
      </div>
      {@render actions?.()}
    </header>
  {/if}
  <div class:card={!plain}>
    {@render children()}
  </div>
  {#if note}<p class="note">{note}</p>{/if}
</section>

<style>
  .section + :global(.section) {
    margin-top: var(--s-8);
  }

  header {
    display: flex;
    align-items: flex-end;
    gap: var(--s-3);
    margin-bottom: 10px;
    padding: 0 2px;
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  h3 {
    font-size: var(--text-md);
    font-weight: 600;
  }

  .titles p {
    margin-top: 2px;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .card {
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight);
  }

  .note {
    margin-top: 8px;
    padding: 0 2px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }
</style>
