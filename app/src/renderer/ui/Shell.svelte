<script lang="ts">
  import type { ShortcutAction } from '../../preload/api'
  import { acceleratorFrom } from '../lib/shortcuts'
  import { store } from '../lib/store.svelte'
  import { ui } from '../lib/ui.svelte'
  import CallView from './CallView.svelte'
  import ChatView from './ChatView.svelte'
  import Confirm from './Confirm.svelte'
  import { Spinner } from './kit'
  import Lightbox from './Lightbox.svelte'
  import Settings from './settings/Settings.svelte'
  import ShareDialog from './ShareDialog.svelte'
  import Sidebar from './Sidebar.svelte'
  import StreamView from './StreamView.svelte'

  const streamFull = $derived(store.view === 'stream' && !!store.call.watching)
  const callOpen = $derived(store.view === 'call' && !!store.call.channelId)

  // Parou de assistir, ou saiu da call: volta pro chat.
  $effect(() => {
    if (!store.call.watching && store.view === 'stream') store.view = 'chat'
    if (!store.call.channelId && store.view === 'call') store.view = 'chat'
  })

  // Bandeja e barra de tarefas acompanham o estado da call.
  $effect(() => {
    window.resenha.callState({
      inCall: !!store.call.channelId,
      muted: store.call.muted,
      deafened: store.call.deafened,
      sharing: store.call.sharing,
      speaking: store.call.selfSpeaking,
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

<div class="shell" data-status={store.status}>
  <Sidebar />
  <main class="panel">
    <div class="chat" class:hidden={streamFull || callOpen}>
      <ChatView />
    </div>
    {#if callOpen}
      <CallView />
    {/if}
    {#if store.call.watching}
      <StreamView full={streamFull} />
    {/if}
    {#if store.status !== 'open'}
      <div class="offline" role="status">
        <Spinner size={14} />
        {store.status === 'connecting' ? 'Conectando…' : 'Sem conexão. Tentando de novo…'}
      </div>
    {/if}
  </main>
</div>

{#if ui.settings}<Settings />{/if}
{#if ui.share}<ShareDialog />{/if}
{#if ui.lightbox}<Lightbox />{/if}
{#if ui.confirm}<Confirm />{/if}

<style>
  .shell {
    height: 100%;
    display: grid;
    grid-template-columns: 248px minmax(0, 1fr);
    /* Sem isso a linha cresce com o conteúdo e o chat nunca ganha barra de rolagem. */
    grid-template-rows: minmax(0, 1fr);
    background:
      radial-gradient(520px 360px at 0% 0%, rgb(111 125 255 / 0.07), transparent 70%),
      var(--bg-canvas);
  }

  /* O conteúdo é um painel solto sobre a janela; a barra lateral fica direto no fundo. */
  .panel {
    position: relative;
    min-width: 0;
    min-height: 0;
    margin: 8px 8px 8px 0;
    border-radius: var(--r-xl);
    background: var(--bg-panel);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-sm);
    overflow: hidden;
  }

  .chat {
    height: 100%;
  }

  .hidden {
    visibility: hidden;
  }

  .offline {
    position: absolute;
    top: 64px;
    left: 50%;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: 7px 14px 7px 12px;
    border-radius: var(--r-full);
    background: rgb(36 30 14 / 0.95);
    box-shadow:
      0 0 0 1px rgb(251 191 36 / 0.3),
      var(--shadow-md);
    color: #fde3a1;
    font-size: var(--text-sm);
    font-weight: 500;
    translate: -50% 0;
    animation: rs-pop-in var(--t) var(--ease);
  }
</style>
