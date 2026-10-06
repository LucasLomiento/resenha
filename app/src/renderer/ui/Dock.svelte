<script lang="ts">
  import { client } from '../lib/client.svelte'
  import { ui } from '../lib/ui.svelte'
  import { Avatar, Icon, IconButton, SignalBars, Spinner, tooltip } from './kit'
  import SharePanel from './SharePanel.svelte'

  const call = client.call
  const place = $derived(client.callPlace)
  const inCall = $derived(!!call.channelId || call.joining)

  /** Pior ping entre as conexões da call, pro resumo. */
  const worstLink = $derived.by(() => {
    const links = Object.values(call.links).filter((l) => l.rtt != null)
    if (links.length === 0) return null
    return links.reduce((a, b) => ((a.rtt ?? 0) > (b.rtt ?? 0) ? a : b))
  })

  let dock = $state<HTMLDivElement>()

  async function toggleCamera() {
    const turningOn = !call.camera
    await call.toggleCamera()
    if (turningOn && call.camera) client.view = 'call'
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
          aria-label="Abrir a call"
          use:tooltip={{ text: 'Abrir a call', placement: 'top' }}
          onclick={() => (client.view = 'call')}
        >
          <span class="status">
            {#if call.joining}
              <Spinner size={12} /> Entrando…
            {:else}
              <Icon name="audio-lines" size={14} /> Na call
            {/if}
          </span>
          <span class="where">{place ? `${place.name} · ${place.where}` : ''}</span>
        </button>
        {#if call.channelId && worstLink}
          <SignalBars rtt={worstLink.rtt} route={worstLink.route} />
        {/if}
        <IconButton icon="phone-off" label="Sair da call" tone="danger" disabled={!call.channelId} onclick={() => client.leaveCall()} />
      </div>

      <div class="call-actions">
        <button
          class="action"
          class:on={!!call.camera}
          disabled={!call.channelId}
          aria-label={call.camera ? 'Desligar câmera' : 'Ligar câmera'}
          aria-pressed={!!call.camera}
          use:tooltip={call.camera ? 'Desligar câmera' : 'Ligar câmera'}
          onclick={toggleCamera}
        >
          <Icon name="camera" size={16} />
          Câmera
        </button>
        <button
          class="action"
          class:sharing={call.sharing}
          disabled={!call.channelId}
          aria-label={call.sharing ? 'Ao vivo: opções da transmissão' : 'Compartilhar tela'}
          aria-expanded={call.sharing ? ui.sharePanel : undefined}
          use:tooltip={call.sharing ? 'Opções da transmissão' : 'Compartilhar tela'}
          onclick={screenClick}
        >
          {#if call.sharing}
            <span class="dot"></span>
            Ao vivo
          {:else}
            <Icon name="screen" size={16} />
            Tela
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <div class="me">
    {#if client.me}
      <Avatar
        id={client.me.id}
        name={client.me.name}
        size={32}
        cutout="var(--bg-raised)"
        status={client.presenceOf(client.me.id).status}
        speaking={!!client.callConnId && call.speaking[client.callConnId]}
      />
      <span class="me-name">{client.me.name}</span>
    {/if}
    <IconButton
      icon={call.muted ? 'mic-off' : 'mic'}
      label={call.muted ? 'Desmutar' : 'Mutar'}
      tone="danger"
      active={call.muted}
      aria-pressed={call.muted}
      onclick={() => call.toggleMute()}
    />
    <IconButton
      icon={call.deafened ? 'headphones-off' : 'headphones'}
      label={call.deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
      tone="danger"
      active={call.deafened}
      aria-pressed={call.deafened}
      onclick={() => call.toggleDeafen()}
    />
    <IconButton icon="settings" label="Configurações" onclick={() => (ui.settings = 'voice')} />
  </div>
</div>

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

  .me-name {
    flex: 1;
    min-width: 0;
    margin-left: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: 600;
  }
</style>
