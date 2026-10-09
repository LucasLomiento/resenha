<script lang="ts">
  import { client } from '../lib/client.svelte'
  import { m } from '../lib/i18n.svelte'
  import { ui } from '../lib/ui.svelte'
  import { Avatar, Icon, IconButton, SignalBars, Spinner, tooltip } from './kit'
  import SharePanel from './SharePanel.svelte'
  import StatusMenu from './StatusMenu.svelte'

  const call = client.call
  const t = $derived(m.app.dock)
  const place = $derived(client.callPlace)
  const inCall = $derived(!!call.channelId || call.joining)

  /** Pior ping entre as conexões da call, pro resumo. */
  const worstLink = $derived.by(() => {
    const links = Object.values(call.links).filter((l) => l.rtt != null)
    if (links.length === 0) return null
    return links.reduce((a, b) => ((a.rtt ?? 0) > (b.rtt ?? 0) ? a : b))
  })

  let dock = $state<HTMLDivElement>()
  let meButton = $state<HTMLButtonElement>()
  let statusOpen = $state(false)
  /** Mouse em cima de você: a foto animada e a moldura se mexem. */
  let meHover = $state(false)

  async function toggleCamera() {
    const turningOn = !call.camera
    await call.toggleCamera()
    if (turningOn && call.camera) client.view = 'call'
  }

  /** Mapa compartilhado do servidor da call (chamada privada não tem). */
  const mapGuild = $derived(call.guildId ? (client.guilds[call.guildId] ?? null) : null)
  const mapOpen = $derived(!!mapGuild && client.mapGuild?.id === mapGuild.id)
  const onMap = $derived(mapGuild?.map.people.length ?? 0)

  function mapClick() {
    if (!mapGuild) return
    if (mapOpen) client.view = 'chat'
    else client.openMap(mapGuild.id)
  }

  function screenClick() {
    if (call.sharing) ui.sharePanel = !ui.sharePanel
    else ui.share = true
  }
</script>

<!-- Um lugar só pros controles: a call (quando tem) em cima, você embaixo. Os botões nunca mudam de lugar. -->
<div class="dock" bind:this={dock}>
  {#if inCall}
    <div class="call">
      <div class="call-head">
        <button
          class="call-info"
          disabled={!call.channelId}
          aria-label={t.openCall}
          use:tooltip={{ text: t.openCall, placement: 'top' }}
          onclick={() => (client.view = 'call')}
        >
          <span class="status">
            {#if call.joining}
              <Spinner size={12} /> {t.joining}
            {:else}
              <Icon name="audio-lines" size={14} /> {t.inCall}
            {/if}
          </span>
          <span class="where">{place ? `${place.name} · ${place.where}` : ''}</span>
        </button>
        {#if call.channelId && worstLink}
          <SignalBars rtt={worstLink.rtt} route={worstLink.route} />
        {/if}
        <IconButton icon="phone-off" label={t.leave} tone="danger" disabled={!call.channelId} onclick={() => client.leaveCall()} />
      </div>

      <div class="call-actions" class:three={!!mapGuild}>
        <button
          class="action"
          class:on={!!call.camera}
          disabled={!call.channelId}
          aria-label={call.camera ? t.cameraOff : t.cameraOn}
          aria-pressed={!!call.camera}
          use:tooltip={call.camera ? t.cameraOff : t.cameraOn}
          onclick={toggleCamera}
        >
          <Icon name="camera" size={16} />
          {t.camera}
        </button>
        <button
          class="action"
          class:sharing={call.sharing}
          disabled={!call.channelId}
          aria-label={call.sharing ? t.liveOptions : t.shareScreen}
          aria-expanded={call.sharing ? ui.sharePanel : undefined}
          use:tooltip={call.sharing ? t.streamOptions : t.shareScreen}
          onclick={screenClick}
        >
          {#if call.sharing}
            <span class="dot"></span>
            {t.live}
          {:else}
            <Icon name="screen" size={16} />
            {t.screen}
          {/if}
        </button>
        {#if mapGuild}
          <button
            class="action"
            class:on={mapOpen}
            aria-label={mapOpen ? t.closeMap : t.openMap}
            aria-pressed={mapOpen}
            use:tooltip={onMap ? t.onMap(onMap) : t.mapHint}
            onclick={mapClick}
          >
            <Icon name="map" size={16} />
            {t.map}
            {#if onMap && !mapOpen}<span class="count tabular">{onMap}</span>{/if}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <div class="me">
    {#if client.me}
      <button
        bind:this={meButton}
        class="me-button"
        aria-label={t.status(m.common.presence[client.presenceOf(client.me.id).status])}
        aria-expanded={statusOpen}
        onclick={() => (statusOpen = !statusOpen)}
        onmouseenter={() => (meHover = true)}
        onmouseleave={() => (meHover = false)}
      >
        <Avatar
          id={client.me.id}
          name={client.me.name}
          size={32}
          src={client.avatarOf(client.me.id)}
          animated={client.animatedAvatarOf(client.me.id)}
          decoration={client.me.style?.decoration ?? null}
          play={meHover}
          cutout="var(--bg-raised)"
          status={client.presenceOf(client.me.id).status}
          speaking={!!client.callConnId && call.speaking[client.callConnId]}
        />
        <span class="me-text">
          <span class="me-name">{client.me.name}</span>
          <span class="me-status">{client.statusText ?? (client.status === 'invisible' ? m.common.presence.invisible : `@${client.me.username}`)}</span>
        </span>
      </button>
    {/if}
    <IconButton
      icon={call.muted ? 'mic-off' : 'mic'}
      label={call.muted ? t.unmute : t.mute}
      tone="danger"
      active={call.muted}
      aria-pressed={call.muted}
      onclick={() => call.toggleMute()}
    />
    <IconButton
      icon={call.deafened ? 'headphones-off' : 'headphones'}
      label={call.deafened ? t.undeafen : t.deafen}
      tone="danger"
      active={call.deafened}
      aria-pressed={call.deafened}
      onclick={() => call.toggleDeafen()}
    />
    <IconButton icon="settings" label={t.settings} onclick={() => (ui.settings = 'profile')} />
  </div>
</div>

{#if statusOpen && meButton}
  <StatusMenu anchor={meButton} onclose={() => (statusOpen = false)} />
{/if}

{#if ui.sharePanel && call.sharing}
  <SharePanel anchor={dock} />
{/if}

<style>
  .dock {
    flex: none;
    margin: 0 8px 8px;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight),
      var(--shadow-sm);
    overflow: hidden;
  }

  /* ---------- Call ---------- */

  .call {
    padding: 8px 8px 10px;
    border-bottom: 1px solid var(--line);
    animation: rs-fade-in var(--t) var(--ease);
  }

  .call-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .call-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 6px;
    border-radius: var(--r-md);
    text-align: left;
    transition: background-color var(--t-fast) var(--ease);
  }

  .call-info:hover:not(:disabled) {
    background: var(--hover);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--green);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .where {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    animation: rs-pulse 1.6s ease-in-out infinite;
  }

  .call-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 6px;
  }

  .call-actions.three {
    grid-template-columns: repeat(3, 1fr);
  }

  .count {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: var(--r-full);
    background: var(--accent);
    color: var(--fg-on-accent);
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
  }

  .action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 32px;
    border-radius: var(--r-md);
    background: rgb(255 255 255 / 0.055);
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 500;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  .action:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.09);
    color: var(--fg);
  }

  .action:disabled {
    opacity: 0.45;
  }

  .action.on {
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  .action.on:hover:not(:disabled) {
    background: rgb(122 108 255 / 0.22);
  }

  .action.sharing {
    background: var(--red-soft);
    color: var(--red);
    font-weight: 600;
  }

  .action.sharing:hover:not(:disabled) {
    background: rgb(255 92 114 / 0.22);
  }

  /* ---------- Você ---------- */

  .me {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 52px;
    padding: 0 8px;
  }

  .me-button {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    height: 42px;
    margin-left: -4px;
    padding: 0 6px 0 4px;
    border-radius: var(--r-lg);
    text-align: left;
    transition: background-color var(--t-fast) var(--ease);
  }

  .me-button:hover,
  .me-button[aria-expanded='true'] {
    background: var(--hover);
  }

  .me-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }

  .me-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .me-status {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }
</style>
