<script lang="ts">
  import type { ShortcutAction } from '../../preload/api'
  import { client } from '../lib/client.svelte'
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
  import ProfileCard from './profile/ProfileCard.svelte'
  import QuickSwitcher from './QuickSwitcher.svelte'
  import ServerRail from './rail/ServerRail.svelte'
  import AddServer from './server/AddServer.svelte'
  import ChannelSettings from './server/ChannelSettings.svelte'
  import CreateChannel from './server/CreateChannel.svelte'
  import InviteModal from './server/InviteModal.svelte'
  import ServerSettings from './server/ServerSettings.svelte'
  import Settings from './settings/Settings.svelte'
  import ShareDialog from './ShareDialog.svelte'
  import StreamView from './StreamView.svelte'

  const guild = $derived(client.guild)
  const streamFull = $derived(client.view === 'stream' && !!client.call.watching)
  const callOpen = $derived(client.view === 'call' && !!client.call.channelId)

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

<div class="shell" data-status={client.connection}>
  <ServerRail />
  <aside class="sidebar">
    {#if guild}
      {#key guild.id}
        <GuildSidebar {guild} />
      {/key}
    {:else}
      <HomeSidebar />
    {/if}
    <Dock />
  </aside>
  <main class="panel">
    <div class="content" class:hidden={streamFull || callOpen}>
      {#if client.route.kind === 'home'}
        <FriendsView />
      {:else}
        <ChatView />
      {/if}
    </div>
    {#if callOpen}
      <CallView />
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

{#if client.incomingCall}<IncomingCall />{/if}
{#if ui.profile}<ProfileCard />{/if}
{#if ui.switcher}<QuickSwitcher />{/if}
{#if ui.addServer}<AddServer />{/if}
{#if ui.invite}<InviteModal />{/if}
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
    grid-template-columns: 72px 248px minmax(0, 1fr);
    /* Sem isso a linha cresce com o conteúdo e o chat nunca ganha barra de rolagem. */
    grid-template-rows: minmax(0, 1fr);
    background:
      radial-gradient(520px 360px at 0% 0%, rgb(111 125 255 / 0.07), transparent 70%),
      var(--bg-canvas);
  }

  /* Barra lateral direto no fundo da janela: a lista em cima, o dock embaixo. */
  .sidebar {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* O conteúdo é um painel solto sobre a janela. */
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
