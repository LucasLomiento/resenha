<script lang="ts">
  import { Avatar, Icon, IconButton, SignalBars } from '../kit'
  import { me, presences } from './data'

  let {
    call = null,
    muted = false,
    deafened = false,
    camera = false,
    sharing = false,
    statusText = null,
  }: {
    /** Nome do canal de voz (e do servidor) quando está numa call. */
    call?: { channel: string; server: string } | null
    muted?: boolean
    deafened?: boolean
    camera?: boolean
    sharing?: boolean
    /** Status personalizado embaixo do nome. */
    statusText?: string | null
  } = $props()
</script>

<!-- Igual ao dock do app (ui/Dock.svelte), com dados fixos. Na arquitetura nova, o nome
     embaixo da call mostra também o servidor ("Resenha / Mesa de RPG"). -->
<div class="dock">
  {#if call}
    <div class="call">
      <div class="call-head">
        <button class="call-info">
          <span class="status"><Icon name="audio-lines" size={14} /> Na call</span>
          <span class="where">{call.channel} · {call.server}</span>
        </button>
        <SignalBars rtt={24} route="direto" />
        <IconButton icon="phone-off" label="Sair da call" tone="danger" />
      </div>
      <div class="call-actions">
        <button class="action" class:on={camera}><Icon name="camera" size={16} /> Câmera</button>
        <button class="action" class:sharing>
          {#if sharing}<span class="dot"></span> Ao vivo{:else}<Icon name="screen" size={16} /> Tela{/if}
        </button>
      </div>
    </div>
  {/if}
  <div class="me">
    <button class="me-button" aria-label="Status">
      <Avatar id={me.id} name={me.name} size={32} status={presences[me.id].status} cutout="var(--bg-raised)" />
      <span class="me-text">
        <span class="me-name">{me.name}</span>
        {#if statusText}<span class="me-status">{statusText}</span>{/if}
      </span>
    </button>
    <IconButton icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Desmutar' : 'Mutar'} tone="danger" active={muted} />
    <IconButton icon={deafened ? 'headphones-off' : 'headphones'} label="Ensurdecer" tone="danger" active={deafened} />
    <IconButton icon="settings" label="Configurações" />
  </div>
</div>

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

  .call {
    padding: 8px 8px 10px;
    border-bottom: 1px solid var(--line);
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
  }

  .call-info:hover {
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
  }

  .action.on {
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  .action.sharing {
    background: var(--red-soft);
    color: var(--red);
    font-weight: 600;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }

  .me {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 52px;
    padding: 0 8px 0 4px;
  }

  .me-button {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 42px;
    padding: 0 4px;
    border-radius: var(--r-lg);
    text-align: left;
  }

  .me-button:hover {
    background: var(--hover);
  }

  .me-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
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
