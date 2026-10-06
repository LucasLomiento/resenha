<script lang="ts">
  import { P, type Channel, type NotifyLevel, type VoiceMember } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import type { GuildState } from '../../lib/guild.svelte'
  import { settings } from '../../lib/settings.svelte'
  import { confirmAction, ui, type Anchor } from '../../lib/ui.svelte'
  import { Avatar, Icon, IconButton, Menu, NavItem, SignalBars, Slider, Spinner, tooltip, type MenuItem } from '../kit'
  import { memberMenu } from './memberMenu'

  let { guild }: { guild: GuildState } = $props()

  const call = client.call
  const route = $derived(client.route)
  const currentChannel = $derived(route.kind === 'guild' ? route.channelId : null)
  const manageChannels = $derived(guild.canGuild(P.MANAGE_CHANNELS))

  // ---------- Categorias recolhidas (lembra por servidor) ----------

  const collapsedKey = $derived(`resenha.collapsed.${guild.id}`)
  let collapsed = $state<Record<string, boolean>>(loadCollapsed())

  function loadCollapsed(): Record<string, boolean> {
    try {
      return JSON.parse(localStorage.getItem(`resenha.collapsed.${guild.id}`) ?? '{}')
    } catch {
      return {}
    }
  }

  function toggleCategory(id: string) {
    collapsed[id] = !collapsed[id]
    try {
      localStorage.setItem(collapsedKey, JSON.stringify(collapsed))
    } catch {
      // sem armazenamento
    }
  }

  function isPrivate(channel: Channel): boolean {
    return channel.overwrites.some((o) => o.type === 'role' && o.id === guild.id && (o.deny & P.VIEW_CHANNEL) !== 0)
  }

  // ---------- Menus ----------

  let headerButton = $state<HTMLButtonElement>()
  let menu = $state<{ items: MenuItem[]; anchor: Anchor; width?: number } | null>(null)

  const LEVELS: { level: NotifyLevel; label: string }[] = [
    { level: 'all', label: 'Todas as mensagens' },
    { level: 'mentions', label: 'Só menções' },
    { level: 'none', label: 'Nada' },
  ]

  function guildMenu(): MenuItem[] {
    const items: MenuItem[] = []
    if (guild.canGuild(P.CREATE_INVITE)) items.push({ label: 'Convidar pessoas', icon: 'user-plus', onselect: () => (ui.invite = { guildId: guild.id }) })
    if (guild.canManage) {
      items.push({ label: 'Configurações do servidor', icon: 'settings', onselect: () => (ui.guildSettings = { guildId: guild.id, page: 'overview' }) })
    }
    if (manageChannels) {
      items.push({ label: 'Criar canal', icon: 'plus', onselect: () => (ui.createChannel = { guildId: guild.id, kind: 'text', parentId: null }) })
      items.push({ label: 'Criar categoria', icon: 'plus', onselect: () => (ui.createChannel = { guildId: guild.id, kind: 'category', parentId: null }) })
    }
    if (items.length) items.push({ kind: 'separator' })
    items.push({ kind: 'label', label: 'Notificações' })
    for (const { level, label } of LEVELS) {
      items.push({ label, checked: guild.notify.level === level, onselect: () => guild.setNotify({ ...guild.notify, level }) })
    }
    items.push({
      label: guild.muted ? 'Voltar a notificar' : 'Silenciar servidor',
      icon: guild.muted ? 'bell' : 'bell-off',
      onselect: () => guild.setNotify({ ...guild.notify, mutedUntil: guild.muted ? null : 8.64e15 }),
    })
    items.push({ label: 'Marcar tudo como lido', icon: 'check', onselect: () => guild.ackAll() })
    if (!guild.isOwner) {
      items.push({ kind: 'separator' })
      items.push({
        label: 'Sair do servidor',
        icon: 'log-out',
        danger: true,
        onselect: () =>
          confirmAction({
            title: `Sair de ${guild.info.name}?`,
            description: 'Pra voltar, você vai precisar de um convite.',
            confirm: 'Sair',
            onconfirm: () => client.leaveGuild(guild.id).catch((err) => client.toast((err as Error).message)),
          }),
      })
    }
    return items
  }

  function channelMenu(channel: Channel): MenuItem[] {
    const items: MenuItem[] = []
    if (channel.kind === 'text') {
      items.push({ label: 'Marcar como lido', icon: 'check', onselect: () => guild.ack(channel.id) })
      const own = guild.notify.channels[channel.id]
      const muted = guild.channelMuted(channel.id)
      const setChannel = (patch: { level?: NotifyLevel | null; mutedUntil?: number | null }) => {
        const next = { level: own?.level ?? null, mutedUntil: own?.mutedUntil ?? null, ...patch }
        const channels = { ...guild.notify.channels }
        if (next.level === null && next.mutedUntil === null) delete channels[channel.id]
        else channels[channel.id] = next
        guild.setNotify({ ...guild.notify, channels })
      }
      items.push({
        label: muted ? 'Voltar a notificar' : 'Silenciar canal',
        icon: muted ? 'bell' : 'bell-off',
        onselect: () => setChannel({ mutedUntil: muted ? null : 8.64e15 }),
      })
      items.push({ kind: 'label', label: 'Notificações' })
      items.push({ label: 'Igual ao servidor', checked: !own?.level, onselect: () => setChannel({ level: null }) })
      for (const { level, label } of LEVELS) items.push({ label, checked: own?.level === level, onselect: () => setChannel({ level }) })
    }
    if (guild.can(channel.id, P.MANAGE_CHANNELS) || (channel.kind === 'category' && manageChannels)) {
      if (items.length) items.push({ kind: 'separator' })
      if (channel.kind === 'category') {
        items.push({ label: 'Criar canal aqui', icon: 'plus', onselect: () => (ui.createChannel = { guildId: guild.id, kind: 'text', parentId: channel.id }) })
      }
      items.push({
        label: channel.kind === 'category' ? 'Editar categoria' : 'Editar canal',
        icon: 'settings',
        onselect: () => (ui.channelSettings = { guildId: guild.id, channelId: channel.id }),
      })
      items.push({
        label: channel.kind === 'category' ? 'Apagar categoria' : 'Apagar canal',
        icon: 'trash',
        danger: true,
        onselect: () =>
          confirmAction({
            title: channel.kind === 'category' ? `Apagar a categoria ${channel.name}?` : `Apagar #${channel.name}?`,
            description:
              channel.kind === 'category' ? 'Os canais dela continuam, fora da categoria.' : 'As mensagens e os arquivos desse canal somem pra sempre.',
            confirm: 'Apagar',
            onconfirm: () => guild.deleteChannel(channel.id),
          }),
      })
    }
    return items
  }

  function openMenu(event: MouseEvent, items: MenuItem[], width = 232) {
    event.preventDefault()
    if (items.length) menu = { items, anchor: { x: event.clientX, y: event.clientY }, width }
  }

  // ---------- Call ----------

  let volumeFor = $state<string | null>(null)

  function watch(member: VoiceMember) {
    call.watch(member.connId)
    client.view = 'stream'
  }

  function setVolume(userId: string, value: number) {
    settings.userVolumes[userId] = value
    call.applyVolumes()
  }
</script>

<header>
  <button
    bind:this={headerButton}
    class="server"
    class:open={!!menu && menu.anchor === headerButton}
    aria-haspopup="menu"
    onclick={() => headerButton && (menu = { items: guildMenu(), anchor: headerButton, width: 248 })}
  >
    <span class="server-name">{guild.info.name}</span>
    <Icon name="chevron-down" size={16} />
  </button>
</header>

<nav aria-label="Canais">
  {#if !guild.loaded}
    <div class="loading"><Spinner size={16} /></div>
  {/if}
  {#each guild.groups as group (group.category?.id ?? 'loose')}
    {#if group.category}
      {@const category = group.category}
      <div class="category" oncontextmenu={(e) => openMenu(e, channelMenu(category))} role="presentation">
        <button class="category-toggle" aria-expanded={!collapsed[category.id]} onclick={() => toggleCategory(category.id)}>
          <Icon name={collapsed[category.id] ? 'chevron-right' : 'chevron-down'} size={12} />
          {category.name}
        </button>
        {#if manageChannels}
          <span class="category-add">
            <IconButton
              icon="plus"
              label="Criar canal"
              size="sm"
              onclick={() => (ui.createChannel = { guildId: guild.id, kind: 'text', parentId: category.id })}
            />
          </span>
        {/if}
      </div>
    {/if}

    {#each group.channels as channel (channel.id)}
      {@const hidden = !!group.category && collapsed[group.category.id]}
      {#if channel.kind === 'text'}
        {@const active = currentChannel === channel.id && client.view === 'chat'}
        {@const unread = guild.unread(channel.id)}
        {#if !hidden || active || guild.mentions(channel.id)}
          <div class="channel-row" oncontextmenu={(e) => openMenu(e, channelMenu(channel))} role="presentation">
            <NavItem
              class="channel"
              icon={isPrivate(channel) ? 'lock' : 'hash'}
              label={channel.name}
              {active}
              unread={unread && !guild.channelMuted(channel.id)}
              muted={guild.channelMuted(channel.id)}
              count={guild.mentions(channel.id)}
              onclick={() => client.openChannel(guild.id, channel.id)}
            />
            {#if guild.can(channel.id, P.MANAGE_CHANNELS)}
              <span class="channel-gear">
                <IconButton
                  icon="settings"
                  label="Editar canal"
                  size="sm"
                  onclick={() => (ui.channelSettings = { guildId: guild.id, channelId: channel.id })}
                />
              </span>
            {/if}
          </div>
        {/if}
      {:else if channel.kind === 'voice'}
        {@const here = call.guildId === guild.id && call.channelId === channel.id}
        {@const members = guild.voiceIn(channel.id)}
        {#if !hidden || here || members.length}
          <div class="channel-row" oncontextmenu={(e) => openMenu(e, channelMenu(channel))} role="presentation">
            <NavItem
              class="channel"
              icon={isPrivate(channel) ? 'lock' : 'volume'}
              label={channel.name}
              active={here && client.view === 'call'}
              aria-label={here ? `${channel.name}: abrir a call` : `${channel.name}: entrar na call`}
              onclick={() => client.openChannel(guild.id, channel.id)}
            >
              {#snippet trailing()}
                {#if call.joining && !here}<Spinner size={14} />{/if}
                {#if channel.userLimit}
                  <span class="limit">{members.length}/{channel.userLimit}</span>
                {/if}
              {/snippet}
            </NavItem>
          </div>

          {#if members.length}
            <ul class="members">
              {#each members as member (member.connId)}
                {@const name = guild.displayName(member.userId)}
                {@const self = member.connId === guild.connId}
                {@const link = call.links[member.connId]}
                <li class="member">
                  <button
                    class="member-main"
                    class:dim={!here}
                    aria-expanded={volumeFor === member.connId}
                    use:tooltip={here && !self ? { text: 'Volume', placement: 'right' } : null}
                    onclick={() => (here && !self ? (volumeFor = volumeFor === member.connId ? null : member.connId) : null)}
                    oncontextmenu={(e) => openMenu(e, memberMenu(guild, member.userId, { x: e.clientX, y: e.clientY }))}
                  >
                    <Avatar
                      id={member.userId}
                      {name}
                      size={22}
                      src={client.avatarOf(member.userId, guild.id)}
                      speaking={here && call.speaking[member.connId]}
                    />
                    <span class="member-name">{name}</span>
                    {#if member.camera}<Icon name="camera" size={14} class="soft" />{/if}
                    {#if member.serverDeafened || member.deafened}
                      <span class="state" use:tooltip={member.serverDeafened ? 'Ensurdecido por um moderador' : 'Ensurdecido'}>
                        <Icon name="headphones-off" size={14} />
                      </span>
                    {:else if member.serverMuted || member.muted}
                      <span class="state" use:tooltip={member.serverMuted ? 'Mutado por um moderador' : 'Mutado'}>
                        <Icon name="mic-off" size={14} />
                      </span>
                    {/if}
                    {#if here && !self}<SignalBars class="ping" rtt={link?.rtt} route={link?.route} />{/if}
                  </button>
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
                      label="Volume de {name}"
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
        {/if}
      {/if}
    {/each}
  {/each}
</nav>

{#if menu}
  <Menu items={menu.items} anchor={menu.anchor} placement="bottom-start" width={menu.width} onclose={() => (menu = null)} />
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    height: var(--header-h);
    margin-top: 8px;
    padding: 0 8px;
    flex: none;
  }

  .server {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    height: 40px;
    padding: 0 10px;
    border-radius: var(--r-lg);
    color: var(--fg-3);
    transition: background-color var(--t-fast) var(--ease);
  }

  .server:hover,
  .server.open {
    background: var(--hover);
    color: var(--fg-2);
  }

  .server-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: 650;
    letter-spacing: -0.015em;
  }

  nav {
    --row-bg: var(--bg-canvas);
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px 16px;
    scrollbar-width: thin;
  }

  nav :global(.nav-item:hover) {
    --row-bg: color-mix(in srgb, var(--bg-canvas) 95.5%, white);
  }

  nav :global(.nav-item.active) {
    --row-bg: color-mix(in srgb, var(--bg-canvas) 92.5%, white);
  }

  .loading {
    display: grid;
    place-items: center;
    padding: 24px 0;
    color: var(--fg-3);
  }

  .category {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 0 4px 2px;
  }

  .category:first-child {
    padding-top: 4px;
  }

  .category-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color var(--t-fast) var(--ease);
  }

  .category-toggle:hover {
    color: var(--fg-2);
  }

  .category-add,
  .channel-gear {
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  .category:hover .category-add,
  .category-add:focus-within,
  .channel-row:hover .channel-gear,
  .channel-gear:focus-within {
    opacity: 1;
  }

  .channel-row {
    position: relative;
  }

  .channel-gear {
    position: absolute;
    top: 50%;
    right: 4px;
    translate: 0 -50%;
  }

  /* Com a engrenagem à mostra, o contador de menções sai do caminho. */
  .channel-row:hover :global(.badge) {
    visibility: hidden;
  }

  .limit {
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
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

  .member-main:hover {
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

  .member :global(.soft) {
    color: var(--fg-3);
  }

  .state {
    display: inline-flex;
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
