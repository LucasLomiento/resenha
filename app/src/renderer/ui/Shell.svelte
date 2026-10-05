<script lang="ts">
  import type { ShortcutAction } from '../../preload/api'
  import { acceleratorFrom } from '../lib/shortcuts'
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

  // Bandeja e barra de tarefas acompanham o estado da call.
  $effect(() => {
    window.resenha.callState({
      inCall: !!store.call.channelId,
      muted: store.call.muted,
      deafened: store.call.deafened,
      sharing: store.call.sharing,
    })
  })

  function onKeydown(event: KeyboardEvent) {
    if (ui.recordingShortcut) return
    // Zoom da interface: Ctrl + / Ctrl - / Ctrl 0.
    if (event.ctrlKey && !event.altKey && store.desktop) {
      const zoom = store.desktop.zoom
      const next =
        event.key === '=' || event.key === '+' ? zoom + 0.1 : event.key === '-' ? zoom - 0.1 : event.key === '0' ? 1 : null
      if (next !== null) {
        event.preventDefault()
        store.setDesktop({ zoom: Math.round(next * 10) / 10 })
        return
      }
    }
    const accelerator = acceleratorFrom(event)
    if (!accelerator || !store.desktop) return
    const action = (Object.entries(store.desktop.shortcuts) as [ShortcutAction, string | null][]).find(
      ([, value]) => value === accelerator,
    )?.[0]
    if (!action) return
    event.preventDefault()
    store.runAction(action)
  }
</script>

<svelte:window onkeydown={onKeydown} />

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
    grid-template-columns: 260px minmax(0, 1fr);
    /* Sem isso a linha cresce com o conteúdo e o chat nunca ganha barra de rolagem. */
    grid-template-rows: minmax(0, 1fr);
  }

  main {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
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
