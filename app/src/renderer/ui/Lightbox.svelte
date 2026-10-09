<script lang="ts">
  import { m } from '../lib/i18n.svelte'
  import { ui } from '../lib/ui.svelte'
  import { IconButton, layer, portal } from './kit'

  const item = $derived(ui.lightbox!)

  function close() {
    ui.lightbox = null
  }
</script>

<div
  class="lightbox"
  role="dialog"
  aria-modal="true"
  aria-label={item.name}
  tabindex="-1"
  use:portal
  use:layer={close}
  onmousedown={(e) => e.target === e.currentTarget && close()}
>
  <img src={item.url} alt={item.name} draggable="false" />
  <div class="bar">
    <span class="name">{item.name}</span>
    <IconButton variant="glass" icon="download" label={m.app.lightbox.download} tip="bottom" onclick={() => window.resenha.download(item.url)} />
    <IconButton variant="glass" icon="x" label={m.common.close} tip="bottom" onclick={close} />
  </div>
</div>

<style>
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: var(--z-lightbox);
    display: grid;
    place-items: center;
    background: rgb(4 4 7 / 0.9);
    backdrop-filter: blur(6px);
    animation: rs-fade-in var(--t) var(--ease);
  }

  img {
    max-width: calc(100vw - 96px);
    max-height: calc(100vh - 128px);
    object-fit: contain;
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-lg);
    pointer-events: none;
    animation: rs-pop-in var(--t-slow) var(--ease);
  }

  .bar {
    position: fixed;
    top: 12px;
    right: 12px;
    left: 12px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
  }

  .name {
    flex: 1;
    min-width: 0;
    margin-left: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }
</style>
