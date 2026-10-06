<script lang="ts">
  import { dmChannelId, type VoiceMember } from '../../../../shared/protocol'
  import logo from '../../../build/icon.svg?url'
  import { settings } from '../lib/settings.svelte'
  import { store } from '../lib/store.svelte'
  import { ui } from '../lib/ui.svelte'
  import Dock from './Dock.svelte'
  import { Avatar, Icon, Menu, NavItem, SignalBars, Slider, Spinner, tooltip, type MenuItem } from './kit'

  const call = store.call
  const textChannels = $derived(store.channels.filter((c) => c.kind === 'text'))
  const voiceChannels = $derived(store.channels.filter((c) => c.kind === 'voice'))
  /** Todo mundo menos você, quem está online primeiro, pra conversa privada. */
  const people = $derived(
    Object.values(store.users)
      .filter((u) => u.id !== store.me?.id)
      .sort((a, b) => Number(!!store.online[b.id]) - Number(!!store.online[a.id]) || a.name.localeCompare(b.name)),
  )
  const dmUser = $derived(store.currentChannel ? store.dmPeer(store.currentChannel) : null)
  const update = $derived(store.update)

  // ---------- Menu do grupo (admin) ----------

  let groupButton = $state<HTMLButtonElement>()
  let groupMenu = $state(false)
  const groupItems: MenuItem[] = [
    {
      label: 'Convidar pessoas',
      icon: 'user-plus',
      onselect: () => {
        if (!store.invite) store.send({ t: 'invite.create' })
        ui.settings = 'group'
      },
    },
    { label: 'Configurações do grupo', icon: 'settings', onselect: () => (ui.settings = 'group') },
  ]

  // ---------- Atualização ----------

  const updateLabel = $derived(
    update.status === 'available'
      ? 'Atualizar'
      : update.status === 'downloading'
        ? `Baixando ${update.percent}%`
        : update.status === 'installing'
          ? 'Instalando…'
          : update.status === 'ready'
            ? 'Reiniciar'
            : null,
  )

  function updateClick() {
    if (update.status === 'available') window.resenha.update.download()
    else if (update.status === 'ready') window.resenha.update.install()
  }

  // ---------- Call ----------

  let volumeFor = $state<string | null>(null)

  function memberClick(member: VoiceMember) {
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
</script>

<aside class="sidebar">
  <header>
    {#if store.me?.admin}
      <button
        bind:this={groupButton}
        class="group"
        class:open={groupMenu}
        aria-haspopup="menu"
        aria-expanded={groupMenu}
        onclick={() => (groupMenu = !groupMenu)}
      >
        <img src={logo} alt="" width="26" height="26" draggable="false" />
        <span class="group-name">Resenha</span>
        <Icon name="chevron-down" size={16} />
      </button>
    {:else}
      <div class="group static">
        <img src={logo} alt="" width="26" height="26" draggable="false" />
        <span class="group-name">Resenha</span>
      </div>
    {/if}

    {#if updateLabel}
      <button
        class="update"
        disabled={update.status === 'downloading' || update.status === 'installing'}
        use:tooltip={'version' in update ? `Versão ${update.version}` : null}
        onclick={updateClick}
      >
        {#if update.status === 'downloading' || update.status === 'installing'}
          <Spinner size={12} />
        {:else}
          <Icon name={update.status === 'ready' ? 'restart' : 'download'} size={14} />
        {/if}
        {updateLabel}
      </button>
    {/if}
  </header>

  {#if groupMenu}
    <Menu items={groupItems} anchor={groupButton} placement="bottom-start" width={232} onclose={() => (groupMenu = false)} />
  {/if}

  <nav aria-label="Canais e conversas">
    <div class="section-label">Canais</div>
    {#each textChannels as channel (channel.id)}
      <NavItem
        class="channel"
        icon="hash"
        label={channel.name}
        active={store.currentChannel === channel.id && store.view === 'chat'}
        unread={store.unread[channel.id]}
        onclick={() => store.openChannel(channel.id)}
      />
    {/each}

    <div class="section-label">Voz</div>
    {#each voiceChannels as channel (channel.id)}
      {@const here = call.channelId === channel.id}
      {@const members = store.membersOf(channel.id)}
      <NavItem
        class="channel"
        icon="volume"
        label={channel.name}
        active={here && store.view === 'call'}
        aria-label={here ? `${channel.name}: abrir a call` : `${channel.name}: entrar na call`}
        onclick={() => store.openChannel(channel.id)}
      >
        {#snippet trailing()}
          {#if call.joining && !here}<Spinner size={14} />{/if}
        {/snippet}
      </NavItem>

      {#if members.length}
        <ul class="members">
          {#each members as member (member.connId)}
            {@const user = store.users[member.userId]}
            {@const self = member.connId === store.connId}
            {@const link = call.links[member.connId]}
            <li class="member">
              {#if self}
                <div class="member-main self">
                  <Avatar id={member.userId} name={user?.name ?? '?'} size={22} speaking={here && call.speaking[member.connId]} />
                  <span class="member-name">{user?.name ?? '?'}</span>
                  {#if member.camera}<Icon name="camera" size={14} class="cam" />{/if}
                  {#if member.deafened}<Icon name="headphones-off" size={14} class="state" />
                  {:else if member.muted}<Icon name="mic-off" size={14} class="state" />{/if}
                </div>
              {:else}
                <button
                  class="member-main"
                  class:dim={!here}
                  aria-expanded={volumeFor === member.connId}
                  use:tooltip={{ text: 'Volume', placement: 'right' }}
                  onclick={() => memberClick(member)}
                >
                  <Avatar id={member.userId} name={user?.name ?? '?'} size={22} speaking={here && call.speaking[member.connId]} />
                  <span class="member-name">{user?.name ?? '?'}</span>
                  {#if member.camera}<Icon name="camera" size={14} class="cam" />{/if}
                  {#if member.deafened}<Icon name="headphones-off" size={14} class="state" />
                  {:else if member.muted}<Icon name="mic-off" size={14} class="state" />{/if}
                  {#if here}<SignalBars class="ping" rtt={link?.rtt} route={link?.route} />{/if}
                </button>
              {/if}
              {#if member.sharing}
                <button
                  class="live"
                  disabled={!here}
                  use:tooltip={here ? (self ? 'Ver minha tela' : 'Assistir') : 'Entre na call pra assistir'}
                  onclick={() => watch(member)}
                >
                  AO VIVO
                </button>
              {/if}
            </li>
            {#if volumeFor === member.connId && !self}
              <li class="volume">
                <Icon name="volume" size={14} />
                <Slider
                  label="Volume de {user?.name ?? '?'}"
                  max={1}
                  value={settings.userVolumes[member.userId] ?? 1}
                  oninput={(e) => setVolume(member.userId, Number(e.currentTarget.value))}
                />
                <span class="tabular">{Math.round((settings.userVolumes[member.userId] ?? 1) * 100)}%</span>
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    {/each}

    {#if people.length}
      <div class="section-label">Mensagens privadas</div>
      {#each people as person (person.id)}
        {@const dm = store.me ? dmChannelId(store.me.id, person.id) : ''}
        <NavItem
          class="person"
          label={person.name}
          active={dmUser === person.id && store.view === 'chat'}
          unread={store.unread[dm]}
          onclick={() => store.openDm(person.id)}
        >
          {#snippet leading()}
            <Avatar
              id={person.id}
              name={person.name}
              size={24}
              status={store.online[person.id] ? 'online' : 'offline'}
              cutout="var(--row-bg)"
            />
          {/snippet}
        </NavItem>
      {/each}
    {/if}
  </nav>

  <Dock />
</aside>

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding-top: 8px;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    height: var(--header-h);
    padding: 0 10px 0 8px;
    flex: none;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    height: 40px;
    padding: 0 10px;
    border-radius: var(--r-lg);
    color: var(--fg-3);
    transition: background-color var(--t-fast) var(--ease);
  }

  button.group:hover,
  button.group.open {
    background: var(--hover);
    color: var(--fg-2);
  }

  .group img {
    flex: none;
    border-radius: 8px;
  }

  .group-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: 650;
    letter-spacing: -0.015em;
  }

  .update {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 26px;
    margin-left: auto;
    padding: 0 10px 0 8px;
    border-radius: var(--r-full);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent-line);
    color: var(--accent-fg);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
    transition: background-color var(--t-fast) var(--ease);
  }

  .update:hover:not(:disabled) {
    background: rgb(122 108 255 / 0.24);
  }

  nav {
    --row-bg: var(--bg-canvas);
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 8px 16px;
    scrollbar-width: thin;
  }

  nav :global(.nav-item:hover) {
    --row-bg: color-mix(in srgb, var(--bg-canvas) 95.5%, white);
  }

  nav :global(.nav-item.active) {
    --row-bg: color-mix(in srgb, var(--bg-canvas) 92.5%, white);
  }

  .section-label {
    padding: 18px 10px 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .section-label:first-child {
    padding-top: 6px;
  }

  /* ---------- Quem está na call ---------- */

  .members {
    margin: 2px 0 4px;
    padding: 0;
    list-style: none;
  }

  .member {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 32px;
  }

  .member-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 6px;
    border-radius: var(--r-md);
    color: var(--fg-2);
    font-size: var(--text-sm);
    text-align: left;
    transition: background-color var(--t-fast) var(--ease);
  }

  button.member-main:hover {
    background: var(--hover);
    color: var(--fg);
  }

  .member-main.dim {
    color: var(--fg-3);
  }

  .member-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member :global(.cam) {
    color: var(--fg-3);
  }

  .member :global(.state) {
    color: var(--red);
  }

  button.live {
    flex: none;
    height: 18px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--red);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    transition:
      filter var(--t-fast) var(--ease),
      opacity var(--t-fast) var(--ease);
  }

  button.live:hover:not(:disabled) {
    filter: brightness(1.12);
  }

  button.live:disabled {
    opacity: 0.55;
  }

  .volume {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 4px 6px 68px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .volume span {
    min-width: 34px;
    text-align: right;
  }
</style>
