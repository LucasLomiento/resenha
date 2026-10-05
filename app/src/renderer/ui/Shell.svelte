<script lang="ts">
  import { store } from '../lib/store.svelte'
  import { ui } from '../lib/ui.svelte'
  import ChatView from './ChatView.svelte'
  import Lightbox from './Lightbox.svelte'
  import Settings from './Settings.svelte'
  import ShareDialog from './ShareDialog.svelte'
  import Sidebar from './Sidebar.svelte'
  import StreamView from './StreamView.svelte'

  const streamFull = $derived(store.view === 'stream' && !!store.call.watching)

  // Parou de assistir: volta pro chat.
  $effect(() => {
    if (!store.call.watching && store.view === 'stream') store.view = 'chat'
  })
</script>

<div class="shell">
  <Sidebar />
  <main>
    <div class="chat" class:hidden={streamFull}>
      <ChatView />
    </div>
    {#if store.call.watching}
      <StreamView full={streamFull} />
    {/if}
    {#if store.status !== 'open'}
      <div class="offline">{store.status === 'connecting' ? 'Conectando…' : 'Sem conexão. Tentando de novo…'}</div>
    {/if}
  </main>
</div>

{#if ui.settings}<Settings />{/if}
{#if ui.share}<ShareDialog />{/if}
{#if ui.lightbox}<Lightbox />{/if}

<style>
  .shell {
    height: 100%;
    display: grid;
    grid-template-columns: 260px 1fr;
  }

  main {
    position: relative;
    min-width: 0;
    background: var(--bg-main);
  }

  .chat {
    height: 100%;
  }

  .hidden {
    visibility: hidden;
  }

  .offline {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 12px;
    border-radius: 999px;
    background: #3a321b;
    border: 1px solid #6b5a26;
    color: #ffe7a8;
    font-size: 13px;
    z-index: 20;
  }
</style>
