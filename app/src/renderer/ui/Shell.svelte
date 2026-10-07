<script lang="ts">
  import type { ShortcutAction } from '../../preload/api'
  import { client } from '../lib/client.svelte'
  import { settings } from '../lib/settings.svelte'
  import { acceleratorFrom } from '../lib/shortcuts'
  import { ui } from '../lib/ui.svelte'
  import CallView from './CallView.svelte'
  import ChatView from './chat/ChatView.svelte'
  import Confirm from './Confirm.svelte'
  import Dock from './Dock.svelte'
  import GuildSidebar from './guild/GuildSidebar.svelte'
  import FriendsView from './home/FriendsView.svelte'
  import HomeSidebar from './home/HomeSidebar.svelte'
  import IncomingCall from './IncomingCall.svelte'
  import { Spinner } from './kit'
  import Lightbox from './Lightbox.svelte'
  import MapView from './map/MapView.svelte'
  import ProfileCard from './profile/ProfileCard.svelte'
  import QuickSwitcher from './QuickSwitcher.svelte'
  import ServerRail from './rail/ServerRail.svelte'
  import AddServer from './server/AddServer.svelte'
  import ChannelSettings from './server/ChannelSettings.svelte'
  import CreateChannel from './server/CreateChannel.svelte'
  import DiscordImport from './server/DiscordImport.svelte'
  import InviteModal from './server/InviteModal.svelte'
  import ServerSettings from './server/ServerSettings.svelte'
  import Settings from './settings/Settings.svelte'
  import ShareDialog from './ShareDialog.svelte'
  import ShortcutsHelp from './ShortcutsHelp.svelte'
  import StreamView from './StreamView.svelte'
  import UpdateNotice from './UpdateNotice.svelte'

  const guild = $derived(client.guild)

  // ---------- Largura da lista de canais (arrastar a borda) ----------

  const SIDEBAR = { min: 216, max: 420, default: 248 }
  let sidebarEl = $state<HTMLElement>()
  let resizing = $state(false)
  const clampWidth = (w: number) => Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, w)))

  function startResize(event: PointerEvent) {
    if (event.button !== 0 || !sidebarEl) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    // Parte da largura de verdade (numa janela estreita ela é menor que a guardada).
    const startWidth = sidebarEl.getBoundingClientRect().width
    resizing = true
    const move = (e: PointerEvent) => (settings.sidebarWidth = clampWidth(startWidth + e.clientX - startX))
    const up = () => {
      resizing = false
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  function resizeKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 48 : 16
    const next =
      event.key === 'ArrowLeft' ? settings.sidebarWidth - step
      : event.key === 'ArrowRight' ? settings.sidebarWidth + step
      : event.key === 'Home' ? SIDEBAR.min
      : event.key === 'End' ? SIDEBAR.max
      : null
    if (next === null) return
    event.preventDefault()
    settings.sidebarWidth = clampWidth(next)
  }
  const streamFull = $derived(client.view === 'stream' && !!client.call.watching)
  const callOpen = $derived(client.view === 'call' && !!client.call.channelId)
  const mapOpen = $derived(client.view === 'map' && !!guild)

  // Parou de assistir, ou saiu da call: volta pro chat.
  $effect(() => {
    if (!client.call.watching && client.view === 'stream') client.view = 'chat'
    if (!client.call.channelId && client.view === 'call') client.view = 'chat'
  })

  // Bandeja e barra de tarefas acompanham o estado da call.
  $effect(() => {
    window.resenha.callState({
      inCall: !!client.call.channelId,
      muted: client.call.muted,
      deafened: client.call.deafened,
      sharing: client.call.sharing,
      speaking: client.call.selfSpeaking,
    })
  })

  // Menções e mensagens privadas não lidas no ícone do app.
  $effect(() => {
    window.resenha.unread(client.badge)
  })

  // Convite aberto por link: com o app aberto, já mostra o servidor pra confirmar.
  $effect(() => {
    const code = client.pendingInvite
    if (code && !ui.addServer) ui.addServer = { step: 'join', code }
  })

  function onKeydown(event: KeyboardEvent) {
    if (ui.recordingShortcut) return
    // Ctrl+K: pular pra canal, conversa ou servidor.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      ui.switcher = !ui.switcher
      return
    }
    // Ctrl+/: lista de atalhos.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === '/') {
      event.preventDefault()
      ui.shortcutsHelp = !ui.shortcutsHelp
      return
    }
    // Alt + ↑/↓: canal anterior/seguinte no servidor aberto.
    if (event.altKey && !event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && guild) {
      const list = guild.orderedChannels.filter((c) => c.kind === 'text')
      const current = client.route.kind === 'guild' ? client.route.channelId : null
      const i = list.findIndex((c) => c.id === current)
      const next = list[(i + (event.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length]
      if (next) {
        event.preventDefault()
        client.openChannel(guild.id, next.id)
      }
      return
    }
    // Zoom da interface: Ctrl + / Ctrl - / Ctrl 0.
    if (event.ctrlKey && !event.altKey && client.desktop) {
      const zoom = client.desktop.zoom
      const next =
        event.key === '=' || event.key === '+' ? zoom + 0.1 : event.key === '-' ? zoom - 0.1 : event.key === '0' ? 1 : null
      if (next !== null) {
        event.preventDefault()
        client.setDesktop({ zoom: Math.round(next * 10) / 10 })
        return
      }
    }
    const accelerator = acceleratorFrom(event)
    if (!accelerator || !client.desktop) return
    const action = (Object.entries(client.desktop.shortcuts) as [ShortcutAction, string | null][]).find(
      ([, value]) => value === accelerator,
    )?.[0]
    if (!action) return
    event.preventDefault()
    client.runAction(action)
  }
</script>

<svelte:window onkeydown={onKeydown} onfocus={() => client.focused()} />

<div class="shell" class:resizing data-status={client.connection} style:--sidebar-w="{clampWidth(settings.sidebarWidth)}px">
  <ServerRail />
  <aside class="sidebar" bind:this={sidebarEl}>
    <!-- Borda arrastável: alarga ou estreita a lista de canais (duplo clique volta ao normal). -->
    <!-- Um separador focável é o "divisor de janela" do ARIA (interativo), que o lint do Svelte não conhece. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Largura da lista de canais"
      aria-valuemin={SIDEBAR.min}
      aria-valuemax={SIDEBAR.max}
      aria-valuenow={clampWidth(settings.sidebarWidth)}
      tabindex="0"
      onpointerdown={startResize}
      ondblclick={() => (settings.sidebarWidth = SIDEBAR.default)}
      onkeydown={resizeKey}
    ></div>
    {#if guild}
      {#key guild.id}
        <GuildSidebar {guild} />
      {/key}
    {:else}
      <HomeSidebar />
    {/if}
  </aside>
  <!-- O painel de baixo vai de ponta a ponta: embaixo do trilho de servidores e da lista. -->
  <div class="dock-area"><Dock /></div>
  <main class="panel">
    <div class="content" class:hidden={streamFull || callOpen || mapOpen}>
      {#if client.route.kind === 'home'}
        <FriendsView />
      {:else}
        <ChatView />
      {/if}
    </div>
    {#if callOpen}
      <CallView />
    {/if}
    {#if mapOpen && guild}
      {#key guild.id}
        <MapView {guild} />
      {/key}
    {/if}
    {#if client.call.watching}
      <StreamView full={streamFull} />
    {/if}
    {#if client.connection !== 'open'}
      <div class="offline" role="status">
        <Spinner size={14} />
        {client.connection === 'connecting' ? 'Conectando…' : 'Sem conexão. Tentando de novo…'}
      </div>
    {/if}
  </main>
</div>

{#if client.incomingCall}<IncomingCall />{:else}<UpdateNotice />{/if}
{#if ui.profile}<ProfileCard />{/if}
{#if ui.switcher}<QuickSwitcher />{/if}
{#if ui.shortcutsHelp}<ShortcutsHelp />{/if}
{#if ui.addServer}<AddServer />{/if}
{#if ui.invite}<InviteModal />{/if}
{#if ui.discordImport}<DiscordImport />{/if}
{#if ui.createChannel}<CreateChannel />{/if}
{#if ui.channelSettings}<ChannelSettings />{/if}
{#if ui.guildSettings}<ServerSettings />{/if}
{#if ui.settings}<Settings />{/if}
{#if ui.share}<ShareDialog />{/if}
{#if ui.lightbox}<Lightbox />{/if}
{#if ui.confirm}<Confirm />{/if}

<style>
  .shell {
    height: 100%;
    display: grid;
    /* A lista de canais tem a largura escolhida, mas cede numa janela estreita pro chat caber. */
    grid-template-columns: 72px clamp(216px, var(--sidebar-w, 248px), max(216px, 100vw - 600px)) minmax(0, 1fr);
    /* Sem o minmax a linha cresce com o conteúdo e o chat nunca ganha barra de rolagem. */
    grid-template-rows: minmax(0, 1fr) auto;
    grid-template-areas:
      'rail sidebar panel'
      'dock dock panel';
    background:
      radial-gradient(520px 360px at 0% 0%, rgb(111 125 255 / 0.07), transparent 70%),
      var(--bg-canvas);
  }

  .shell > :global(.rail) {
    grid-area: rail;
  }

  /* Barra lateral direto no fundo da janela. */
  .sidebar {
    grid-area: sidebar;
    position: relative;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* A alça fica no vão entre a lista e o painel; a linha aparece ao passar o mouse. */
  .sidebar-resize {
    position: absolute;
    top: 8px;
    right: -6px;
    bottom: 8px;
    z-index: 5;
    width: 10px;
    cursor: col-resize;
    touch-action: none;
  }

  .sidebar-resize::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 2px;
    border-radius: 2px;
    background: var(--accent-line);
    opacity: 0;
    transition: opacity var(--t) var(--ease);
  }

  .sidebar-resize:hover::after,
  .sidebar-resize:focus-visible::after,
  .resizing .sidebar-resize::after {
    opacity: 1;
    transition-delay: 80ms;
  }

  .sidebar-resize:focus-visible {
    outline: none;
  }

  /* Arrastando: o cursor fica de redimensionar em qualquer lugar e nada é selecionado. */
  .resizing {
    cursor: col-resize;
    user-select: none;
  }

  .dock-area {
    grid-area: dock;
    min-width: 0;
  }

  /* O conteúdo é um painel solto sobre a janela. */
  .panel {
    grid-area: panel;
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
    container-type: inline-size;
    container-name: panel;
  }

  .content {
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
