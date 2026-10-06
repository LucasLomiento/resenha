<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    label,
    description,
    for: forId,
    stack = false,
    indent = false,
    disabled = false,
    class: className,
    leading,
    children,
  }: {
    label?: string
    /** Uma linha. Se não ajuda a decidir, não escreva. */
    description?: string
    /** Id do controle: clicar no rótulo liga/desliga o interruptor. */
    for?: string
    /** Controle embaixo do rótulo, na largura toda. */
    stack?: boolean
    /** Opção que depende da de cima. */
    indent?: boolean
    disabled?: boolean
    class?: string
    /** Avatar ou ícone antes do texto. */
    leading?: Snippet
    children?: Snippet
  } = $props()
</script>

<div class={['row', className, { stack, indent, disabled }]}>
  {#if leading}<div class="leading">{@render leading()}</div>{/if}
  {#if label || description}
    <div class="text">
      {#if label}
        {#if forId}<label for={forId}>{label}</label>{:else}<span class="label">{label}</span>{/if}
      {/if}
      {#if description}<p>{description}</p>{/if}
    </div>
  {/if}
  {#if children}<div class="control">{@render children()}</div>{/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    min-height: 56px;
    padding: 10px 16px;
  }

  /* Fio entre linhas do mesmo cartão. */
  :global(.row) + .row {
    border-top: 1px solid var(--line);
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  label,
  .label {
    display: block;
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 500;
  }

  label {
    cursor: pointer;
  }

  .text p {
    margin-top: 2px;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-2);
    flex: none;
    min-width: 0;
  }

  /* Sem rótulo: o controle ocupa a linha toda. */
  .row:not(:has(.text)) .control {
    flex: 1;
    justify-content: flex-start;
  }

  .leading {
    display: flex;
    flex: none;
  }

  .stack {
    flex-direction: column;
    align-items: stretch;
    gap: var(--s-3);
    padding-top: 14px;
    padding-bottom: 14px;
  }

  /* Empilhado: o controle (campo, medidor, lista) ocupa a largura do cartão. */
  .stack .control {
    display: block;
  }

  .indent {
    padding-left: 40px;
  }

  .disabled .text,
  .disabled .control {
    opacity: 0.4;
    pointer-events: none;
  }
</style>
