<script lang="ts">
  import type { VoiceMember } from '../../../../shared/protocol'
  import { settings } from '../lib/settings.svelte'
  import { store } from '../lib/store.svelte'
  import { ui } from '../lib/ui.svelte'
  import Avatar from './Avatar.svelte'
  import Icon from './Icon.svelte'

  const call = store.call
  const textChannels = $derived(store.channels.filter((c) => c.kind === 'text'))
  const voiceChannels = $derived(store.channels.filter((c) => c.kind === 'voice'))
  const callChannel = $derived(store.channels.find((c) => c.id === call.channelId))

  /** Pior ping entre as conexões da call, pro resumo no painel. */
  const worstLink = $derived.by(() => {
    const links = Object.values(call.links).filter((l) => l.rtt != null)
    if (links.length === 0) return null
    return links.reduce((a, b) => ((a.rtt ?? 0) > (b.rtt ?? 0) ? a : b))
  })

  let volumeFor = $state<string | null>(null)

  function memberClick(member: VoiceMember) {
    if (member.connId === store.connId) return
    volumeFor = volumeFor === member.connId ? null : member.connId
  }

  function watch(member: VoiceMember) {
    call.watch(member.connId)
    store.view = 'stream'
  }

  function setVolume(userId: string, value: number) {
    settings.userVolumes[userId] = value
    call.applyVolumes()
  }

  function pingClass(rtt: number | null | undefined) {
    if (rtt == null) return ''
    return rtt < 80 ? 'good' : rtt < 160 ? 'ok' : 'bad'
  }
</script>

<aside>
  <header>
    <span class="title">Resenha</span>
    <span class="dot" class:on={store.status === 'open'} title={store.status === 'open' ? 'Conectado' : 'Sem conexão'}></span>
  </header>

  <nav>
    <div class="section">
      <span class="label">Canais de texto</span>
      {#if store.me?.admin}
        <button class="add" title="Gerenciar canais" onclick={() => (ui.settings = 'group')}><Icon name="plus" size={15} /></button>
      {/if}
    </div>
    {#each textChannels as channel (channel.id)}
      <button
        class="channel"
        class:active={store.currentChannel === channel.id && store.view === 'chat'}
        class:unread={store.unread[channel.id]}
        onclick={() => store.openChannel(channel.id)}
      >
        <Icon name="hash" size={17} />
        <span class="name">{channel.name}</span>
      </button>
    {/each}

    <div class="section">
      <span class="label">Canais de voz</span>
      {#if store.me?.admin}
        <button class="add" title="Gerenciar canais" onclick={() => (ui.settings = 'group')}><Icon name="plus" size={15} /></button>
      {/if}
    </div>
    {#each voiceChannels as channel (channel.id)}
      <button class="channel" class:active={call.channelId === channel.id} onclick={() => store.openChannel(channel.id)}>
        <Icon name="volume" size={17} />
        <span class="name">{channel.name}</span>
      </button>
      <div class="members">
        {#each store.membersOf(channel.id) as member (member.connId)}
          {@const user = store.users[member.userId]}
          {@const self = member.connId === store.connId}
          {@const link = call.links[member.connId]}
          <div class="member">
            <button class="member-main" onclick={() => memberClick(member)} title={self ? 'Você' : 'Volume'}>
              <Avatar id={member.userId} name={user?.name ?? '?'} size={24} speaking={call.channelId === channel.id && call.speaking[member.connId]} />
              <span class="member-name" class:dim={!self && call.channelId !== channel.id}>{user?.name ?? '?'}</span>
              {#if member.deafened}<span class="state"><Icon name="headphones-off" size={14} /></span>
              {:else if member.muted}<span class="state"><Icon name="mic-off" size={14} /></span>{/if}
              {#if !self && call.channelId === channel.id && link?.rtt != null}
                <span class="ping {pingClass(link.rtt)}" title={link.route === 'relay' ? 'Passando pelo TURN do Cloudflare' : 'Conexão direta'}>
                  {link.rtt}ms{link.route === 'relay' ? ' ·relay' : ''}
                </span>
              {/if}
            </button>
            {#if member.sharing}
              <button
                class="live"
                title={call.channelId === channel.id ? 'Assistir' : 'Entre na call pra assistir'}
                disabled={call.channelId !== channel.id}
                onclick={() => watch(member)}>AO VIVO</button
              >
            {/if}
          </div>
          {#if volumeFor === member.connId && !self}
            <div class="volume">
              <Icon name="volume" size={14} />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.userVolumes[member.userId] ?? 1}
                oninput={(e) => setVolume(member.userId, Number(e.currentTarget.value))}
              />
              <span>{Math.round((settings.userVolumes[member.userId] ?? 1) * 100)}%</span>
            </div>
          {/if}
        {/each}
      </div>
    {/each}
  </nav>

  {#if call.channelId}
    <div class="voice-panel">
      <div class="voice-info">
        <span class="connected">Voz conectada</span>
        <span class="where">
          {callChannel?.name}
          {#if worstLink}<span class="ping {pingClass(worstLink.rtt)}">· {worstLink.rtt}ms</span>{/if}
        </span>
      </div>
      <button
        class="icon-btn"
        class:on={call.sharing}
        title={call.sharing ? 'Parar de compartilhar' : 'Compartilhar tela'}
        onclick={() => (call.sharing ? call.stopShare() : (ui.share = true))}
      >
        <Icon name={call.sharing ? 'screen-off' : 'screen'} />
      </button>
      {#if call.sharing}
        <button
          class="icon-btn"
          title="Ver minha transmissão"
          onclick={() => {
            call.watch(store.connId!)
            store.view = 'stream'
          }}><Icon name="eye" /></button
        >
      {/if}
      <button class="icon-btn hangup" title="Sair da call" onclick={() => call.leave()}><Icon name="hangup" /></button>
    </div>
  {:else if call.joining}
    <div class="voice-panel"><span class="connected">Entrando na call…</span></div>
  {/if}

  <footer>
    {#if store.me}
      <Avatar id={store.me.id} name={store.me.name} size={32} speaking={!!store.connId && call.speaking[store.connId]} />
      <span class="me">{store.me.name}</span>
    {/if}
    <button class="icon-btn" class:on={call.muted} title={call.muted ? 'Desmutar' : 'Mutar'} onclick={() => call.toggleMute()}>
      <Icon name={call.muted ? 'mic-off' : 'mic'} />
    </button>
    <button class="icon-btn" class:on={call.deafened} title={call.deafened ? 'Voltar a ouvir' : 'Ensurdecer'} onclick={() => call.toggleDeafen()}>
      <Icon name={call.deafened ? 'headphones-off' : 'headphones'} />
    </button>
    <button class="icon-btn" title="Configurações" onclick={() => (ui.settings = 'voice')}><Icon name="settings" /></button>
  </footer>
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 52px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    font-weight: 800;
    font-size: 16px;
    letter-spacing: -0.01em;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--yellow);
  }

  .dot.on {
    background: var(--green);
  }

  nav {
    flex: 1;
    overflow-y: auto;
    padding: 8px 8px 16px;
  }

  .section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 8px 6px;
  }

  .add {
    color: var(--text-faint);
    display: grid;
  }

  .add:hover {
    color: var(--text);
  }

  .channel {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    color: var(--text-faint);
    text-align: left;
  }

  .channel:hover {
    background: var(--bg-hover);
    color: var(--text-dim);
  }

  .channel.active {
    background: var(--bg-active);
    color: var(--text);
  }

  .channel.unread {
    color: var(--text);
    font-weight: 700;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .members {
    padding-left: 26px;
  }

  .member {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .member-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 6px;
    text-align: left;
  }

  .member-main:hover {
    background: var(--bg-hover);
  }

  .member-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
  }

  .member-name.dim {
    color: var(--text-faint);
  }

  .state {
    display: grid;
    color: var(--red);
  }

  .ping {
    font-size: 11px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .ping.good {
    color: var(--green);
  }

  .ping.ok {
    color: var(--yellow);
  }

  .ping.bad {
    color: var(--red);
  }

  button.live:disabled {
    opacity: 0.6;
  }

  .volume {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 8px 38px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .volume input {
    flex: 1;
    accent-color: var(--accent);
  }

  .voice-panel {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 10px 8px 10px 14px;
    border-top: 1px solid var(--border);
    background: #141519;
  }

  .voice-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .connected {
    color: var(--green);
    font-weight: 700;
    font-size: 13px;
  }

  .where {
    color: var(--text-faint);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hangup:hover {
    color: var(--red) !important;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 8px 8px 10px;
    background: #121317;
    border-top: 1px solid var(--border);
  }

  .me {
    flex: 1;
    min-width: 0;
    margin-left: 8px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
