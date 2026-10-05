<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  let {
    title,
    width = 520,
    onclose,
    children,
    footer,
  }: { title: string; width?: number; onclose: () => void; children: Snippet; footer?: Snippet } = $props()
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title} style:width="{width}px">
    <header>
      <h2>{title}</h2>
      <button class="icon-btn" title="Fechar" onclick={onclose}><Icon name="x" /></button>
    </header>
    <div class="content">
      {@render children()}
    </div>
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.6);
  }

  .modal {
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 40px);
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 24px 70px rgb(0 0 0 / 0.5);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 18px 8px 22px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  .content {
    padding: 8px 22px 20px;
    overflow-y: auto;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 18px;
    border-top: 1px solid var(--border);
    background: #141519;
    border-radius: 0 0 14px 14px;
  }
</style>
