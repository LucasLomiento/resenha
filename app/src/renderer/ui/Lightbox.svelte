<script lang="ts">
  import { ui } from '../lib/ui.svelte'
  import Icon from './Icon.svelte'

  const item = $derived(ui.lightbox!)
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (ui.lightbox = null)} />

<div class="lightbox" role="presentation" onmousedown={(e) => e.target === e.currentTarget && (ui.lightbox = null)}>
  <img src={item.url} alt={item.name} />
  <div class="bar">
    <span>{item.name}</span>
    <button class="icon-btn" title="Baixar" onclick={() => window.resenha.download(item.url)}><Icon name="download" /></button>
    <button class="icon-btn" title="Fechar" onclick={() => (ui.lightbox = null)}><Icon name="x" /></button>
  </div>
</div>

<style>
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.85);
  }

  img {
    max-width: calc(100vw - 80px);
    max-height: calc(100vh - 120px);
    object-fit: contain;
    border-radius: 6px;
    pointer-events: none;
  }

  .bar {
    position: fixed;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
  }

  .bar span {
    margin-right: 8px;
  }
</style>
