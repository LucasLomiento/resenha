<script lang="ts">
  import { P, type Channel, type NotifyLevel, type VoiceMember } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import type { GuildState } from '../../lib/guild.svelte'
  import { m } from '../../lib/i18n.svelte'
  import { settings } from '../../lib/settings.svelte'
  import { badgeOf } from '../../lib/profile'
  import { confirmAction, ui, type Anchor } from '../../lib/ui.svelte'
  import { Avatar, Icon, IconButton, Menu, NavItem, SignalBars, Slider, Spinner, UserBadge, tooltip, type MenuItem } from '../kit'
  import { memberMenu } from './memberMenu'

  let { guild }: { guild: GuildState } = $props()

  const call = client.call
  const t = $derived(m.guild.sidebar)
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

  /** Os níveis de notificação, no idioma de quando o menu abre. */
  function levels(): { level: NotifyLevel; label: string }[] {
    const names = m.guild.menu.levels
    return [
      { level: 'all', label: names.all },
      { level: 'mentions', label: names.mentions },
      { level: 'none', label: names.none },
    ]
  }

  function guildMenu(): MenuItem[] {
    const t = m.guild.menu
    const items: MenuItem[] = []
    if (guild.canGuild(P.CREATE_INVITE)) items.push({ label: t.invite, icon: 'user-plus', onselect: () => (ui.invite = { guildId: guild.id }) })
    if (guild.canManage) {
      items.push({ label: t.settings, icon: 'settings', onselect: () => (ui.guildSettings = { guildId: guild.id, page: 'overview' }) })
    }
    if (manageChannels) {
      items.push({ label: t.createChannel, icon: 'plus', onselect: () => (ui.createChannel = { guildId: guild.id, kind: 'text', parentId: null }) })
      items.push({ label: t.createCategory, icon: 'plus', onselect: () => (ui.createChannel = { guildId: guild.id, kind: 'category', parentId: null }) })
      items.push({ label: t.importDiscord, icon: 'image-plus', onselect: () => (ui.discordImport = { guildId: guild.id }) })
    }
    if (items.length) items.push({ kind: 'separator' })
    items.push({ kind: 'label', label: t.notifications })
    for (const { level, label } of levels()) {
      items.push({ label, checked: guild.notify.level === level, onselect: () => guild.setNotify({ ...guild.notify, level }) })
    }
    items.push({
      label: guild.muted ? t.notifyAgain : t.muteServer,
      icon: guild.muted ? 'bell' : 'bell-off',
      onselect: () => guild.setNotify({ ...guild.notify, mutedUntil: guild.muted ? null : 8.64e15 }),
    })
    items.push({ label: t.markAllRead, icon: 'check', onselect: () => guild.ackAll() })
    if (!guild.isOwner) {
      items.push({ kind: 'separator' })
      items.push({
        label: t.leave,
        icon: 'log-out',
        danger: true,
        onselect: () =>
          confirmAction({
            title: m.guild.menu.leaveTitle(guild.info.name),
            description: m.guild.menu.leaveDescription,
            confirm: m.guild.menu.leaveConfirm,
            onconfirm: () => client.leaveGuild(guild.id).catch((err) => client.toast((err as Error).message)),
          }),
      })
    }
    return items
  }

  function channelMenu(channel: Channel): MenuItem[] {
    const t = m.guild.channelMenu
    const items: MenuItem[] = []
    if (channel.kind === 'text') {
      items.push({ label: t.markRead, icon: 'check', onselect: () => guild.ack(channel.id) })
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
        label: muted ? t.notifyAgain : t.muteChannel,
        icon: muted ? 'bell' : 'bell-off',
        onselect: () => setChannel({ mutedUntil: muted ? null : 8.64e15 }),
      })
      items.push({ kind: 'label', label: m.guild.menu.notifications })
      items.push({ label: t.sameAsServer, checked: !own?.level, onselect: () => setChannel({ level: null }) })
      for (const { level, label } of levels()) items.push({ label, checked: own?.level === level, onselect: () => setChannel({ level }) })
    }
    // Só o dono do Resenha: a sala de voz passa pelo Cloudflare (gasta a cota do mês dele).
    if (channel.kind === 'voice' && client.me?.staff) {
      items.push({
        label: t.relay,
        icon: 'cloud',
        checked: !!channel.relay,
        onselect: () => guild.updateChannel(channel.id, { relay: !channel.relay }),
      })
    }
    if (guild.can(channel.id, P.MANAGE_CHANNELS) || (channel.kind === 'category' && manageChannels)) {
      if (items.length) items.push({ kind: 'separator' })
      if (channel.kind === 'category') {
        items.push({ label: t.createHere, icon: 'plus', onselect: () => (ui.createChannel = { guildId: guild.id, kind: 'text', parentId: channel.id }) })
      }
      items.push({
        label: channel.kind === 'category' ? t.editCategory : t.editChannel,
        icon: 'settings',
        onselect: () => (ui.channelSettings = { guildId: guild.id, channelId: channel.id }),
      })
      items.push({
        label: channel.kind === 'category' ? t.deleteCategory : t.deleteChannel,
        icon: 'trash',
        danger: true,
        onselect: () => {
          const ask = m.guild.channelMenu
          confirmAction({
            title: channel.kind === 'category' ? ask.deleteCategoryTitle(channel.name) : ask.deleteChannelTitle(channel.name),
            description: channel.kind === 'category' ? ask.deleteCategoryDescription : ask.deleteChannelDescription,
            confirm: ask.deleteConfirm,
            onconfirm: () => guild.deleteChannel(channel.id),
          })
        },
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

  /**
   * Chegada de quem tem selo (Fundador, Pioneiro) na call: o nome entra com um brilho
   * nas cores do selo. Só pra quem chega depois que a lista apareceu (abrir o servidor
   * não anima quem já estava).
   */
  const shownAt = performance.now()
  function arrival(node: HTMLElement, badge: string | null) {
    if (!badge || performance.now() - shownAt < 1500) return
    node.classList.add('arrive', `arrive-${badge}`)
    node.addEventListener('animationend', () => node.classList.remove('arrive', `arrive-${badge}`), { once: true })
  }

  function watch(member: VoiceMember) {
    call.watch(member.connId)
    client.view = 'stream'
  }

  function setVolume(userId: string, value: number) {
    settings.userVolumes[userId] = value
    call.applyVolumes()
  }

  // ---------- Arrastar pra organizar ----------

  /**
   * Onde o arrastado cai: antes ou depois de um canal do mesmo tipo, dentro de uma
   * categoria (no topo dela) ou, pra categoria, antes de outra (`id` nulo: no fim).
   */
  type Drop = { id: string | null; place: 'before' | 'after' | 'into' }

  let dragging = $state<Channel | null>(null)
  let drop = $state<Drop | null>(null)
  const categories = $derived(guild.groups.flatMap((g) => (g.category ? [g.category] : [])))

  function canDrag(channel: Channel): boolean {
    return manageChannels && guild.can(channel.id, P.MANAGE_CHANNELS)
  }

  function dragStart(event: DragEvent, channel: Channel) {
    if (!canDrag(channel)) return event.preventDefault()
    dragging = channel
    menu = null
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', channel.name)
    }
  }

  function dropFor(event: DragEvent, over: Channel): Drop | null {
    const moving = dragging
    if (!moving) return null
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const upper = event.clientY < box.top + box.height / 2
    if (moving.kind === 'category') {
      if (over.kind !== 'category') return null
      if (upper) return { id: over.id, place: 'before' }
      const next = categories[categories.findIndex((c) => c.id === over.id) + 1]
      return { id: next?.id ?? null, place: 'before' }
    }
    if (over.id === moving.id) return null
    if (over.kind === 'category') return guild.can(over.id, P.MANAGE_CHANNELS) ? { id: over.id, place: 'into' } : null
    if (over.kind !== moving.kind) return null
    return { id: over.id, place: upper ? 'before' : 'after' }
  }

  function dragOver(event: DragEvent, over: Channel | null) {
    const next = over ? dropFor(event, over) : dragging?.kind === 'category' ? { id: null, place: 'before' as const } : null
    if (!next) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    if (drop?.id !== next.id || drop.place !== next.place) drop = next
  }

  /** Fora de qualquer alvo: some a marca (soltar ali não faz nada). */
  function dragOverNav(event: DragEvent) {
    if (!event.defaultPrevented) drop = null
  }

  function dragEnd() {
    dragging = null
    drop = null
  }

  function dropHere(event: DragEvent) {
    event.preventDefault()
    const moving = dragging
    const where = drop
    dragEnd()
    if (moving && where) move(moving, where)
  }

  /** Renumera o grupo de destino e manda só o que mudou (cada linha é uma escrita no servidor). */
  function move(moving: Channel, where: Drop) {
    let list: Channel[]
    let parentId: string | null = null
    if (moving.kind === 'category') {
      list = categories.filter((c) => c.id !== moving.id)
      const at = where.id === null ? list.length : list.findIndex((c) => c.id === where.id)
      if (at < 0) return
      list.splice(at, 0, moving)
    } else {
      const group = guild.groups.find((g) =>
        where.place === 'into' ? g.category?.id === where.id : g.channels.some((c) => c.id === where.id),
      )
      if (!group) return
      parentId = group.category?.id ?? null
      list = group.channels.filter((c) => c.kind === moving.kind && c.id !== moving.id)
      const at = where.place === 'into' ? 0 : list.findIndex((c) => c.id === where.id) + (where.place === 'after' ? 1 : 0)
      list.splice(at, 0, moving)
    }
    const order = list
      .map((c, position) => ({ id: c.id, position, parentId }))
      .filter(({ id, position }) => {
        const now = guild.channel(id)
        return !!now && (now.position !== position || (now.parentId ?? null) !== parentId)
      })
    if (order.length) guild.reorderChannels(order)
  }
</script>

<header>
  <button
    bind:this={headerButton}
    class="server"
    class:open={!!menu && menu.anchor === headerButton}
    aria-haspopup="menu"
    onclick={() => headerButton && (menu = { items: guildMenu(), anchor: headerButton, width: Math.max(248, headerButton.offsetWidth) })}
  >
    <span class="server-name">{guild.info.name}</span>
    <Icon name="chevron-down" size={16} />
  </button>
</header>

<nav aria-label={t.channels} ondragover={dragOverNav} ondrop={dropHere}>
  {#if !guild.loaded}
    <div class="loading"><Spinner size={16} /></div>
  {:else}
    {@const people = guild.map.people}
    <NavItem
      class="map-entry"
      icon="map"
      label={t.map}
      active={client.view === 'map'}
      aria-label={people.length ? t.mapPeople(people.length) : t.map}
      onclick={() => client.openMap(guild.id)}
    >
      {#snippet trailing()}
        {#if people.length}
          <span class="map-people" use:tooltip={{ text: people.map((id) => guild.displayName(id)).join(', '), placement: 'right' }}>
            {#each people.slice(0, 3) as id (id)}
              <Avatar {id} name={guild.displayName(id)} size={18} src={client.avatarOf(id, guild.id)} />
            {/each}
            {#if people.length > 3}<span class="map-more">+{people.length - 3}</span>{/if}
          </span>
        {/if}
      {/snippet}
    </NavItem>
  {/if}
  {#each guild.groups as group (group.category?.id ?? 'loose')}
    {#if group.category}
      {@const category = group.category}
      <div
        class="category"
        class:dragging={dragging?.id === category.id}
        class:drop-before={drop?.id === category.id && drop.place === 'before'}
        class:drop-into={drop?.id === category.id && drop.place === 'into'}
        draggable={canDrag(category)}
        ondragstart={(e) => dragStart(e, category)}
        ondragover={(e) => dragOver(e, category)}
        ondragend={dragEnd}
        oncontextmenu={(e) => openMenu(e, channelMenu(category))}
        role="presentation"
      >
        <button class="category-toggle" aria-expanded={!collapsed[category.id]} onclick={() => toggleCategory(category.id)}>
          <Icon name={collapsed[category.id] ? 'chevron-right' : 'chevron-down'} size={12} />
          {category.name}
        </button>
        {#if manageChannels}
          <span class="category-add">
            <IconButton
              icon="plus"
              label={t.createChannel}
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
          <div
            class="channel-row"
            class:dragging={dragging?.id === channel.id}
            class:drop-before={drop?.id === channel.id && drop.place === 'before'}
            class:drop-after={drop?.id === channel.id && drop.place === 'after'}
            draggable={canDrag(channel)}
            ondragstart={(e) => dragStart(e, channel)}
            ondragover={(e) => dragOver(e, channel)}
            ondragend={dragEnd}
            oncontextmenu={(e) => openMenu(e, channelMenu(channel))}
            role="presentation"
          >
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
                  label={t.editChannel}
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
          <div
            class="channel-row"
            class:dragging={dragging?.id === channel.id}
            class:drop-before={drop?.id === channel.id && drop.place === 'before'}
            class:drop-after={drop?.id === channel.id && drop.place === 'after'}
            draggable={canDrag(channel)}
            ondragstart={(e) => dragStart(e, channel)}
            ondragover={(e) => dragOver(e, channel)}
            ondragend={dragEnd}
            oncontextmenu={(e) => openMenu(e, channelMenu(channel))}
            role="presentation"
          >
            <NavItem
              class="channel"
              icon={isPrivate(channel) ? 'lock' : 'volume'}
              label={channel.name}
              active={here && client.view === 'call'}
              aria-label={here ? t.openCall(channel.name) : t.joinCall(channel.name)}
              onclick={() => client.openChannel(guild.id, channel.id)}
            >
              {#snippet trailing()}
                {#if call.joining && !here}<Spinner size={14} />{/if}
                {#if channel.relay}
                  <span class="relay" use:tooltip={{ text: t.relay, placement: 'right' }}>
                    <Icon name="cloud" size={14} />
                  </span>
                {/if}
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
                {@const badge = badgeOf(client.user(member.userId, guild.id))}
                <li class="member" use:arrival={badge}>
                  <button
                    class="member-main"
                    class:dim={!here}
                    aria-expanded={volumeFor === member.connId}
                    use:tooltip={here && !self ? { text: t.volume, placement: 'right' } : null}
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
                    <UserBadge {badge} size={13} />
                    <!-- Ping só passando o mouse (antes dos outros ícones: eles não saem do lugar). -->
                    {#if here && !self}<SignalBars class="ping" rtt={link?.rtt} route={link?.route} />{/if}
                    {#if member.camera}<Icon name="camera" size={14} class="soft" />{/if}
                    {#if member.serverDeafened || member.deafened}
                      <span class="state" use:tooltip={member.serverDeafened ? t.deafenedByMod : t.deafened}>
                        <Icon name="headphones-off" size={14} />
                      </span>
                    {:else if member.serverMuted || member.muted}
                      <span class="state" use:tooltip={member.serverMuted ? t.mutedByMod : t.muted}>
                        <Icon name="mic-off" size={14} />
                      </span>
                    {/if}
                  </button>
                  {#if member.sharing}
                    <button
                      class="live"
                      disabled={!here}
                      use:tooltip={here ? (self ? t.watchMine : t.watch) : t.joinToWatch}
                      onclick={() => watch(member)}
                    >
                      {t.live}
                    </button>
                  {/if}
                </li>
                {#if volumeFor === member.connId && !self}
                  <li class="volume">
                    <Icon name="volume" size={14} />
                    <Slider
                      label={t.volumeOf(name)}
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
  {#if dragging?.kind === 'category'}
    <div class="drop-end" class:drop-before={!!drop && drop.id === null} ondragover={(e) => dragOver(e, null)} role="presentation"></div>
  {/if}
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

  /* Mapa no topo da lista: quem está nele aparece em rostinhos à direita. */
  .map-people {
    display: flex;
    align-items: center;
  }

  .map-people :global(.avatar) {
    margin-left: -5px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--row-bg);
  }

  .map-people :global(.avatar:first-child) {
    margin-left: 0;
  }

  .map-more {
    margin-left: 4px;
    color: var(--fg-3);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
  }

  .loading {
    display: grid;
    place-items: center;
    padding: 24px 0;
    color: var(--fg-3);
  }

  .category {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
    padding: 4px 0 4px 2px;
    border-radius: var(--r-md);
  }

  .category:first-child {
    margin-top: 0;
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

  /* ---------- Arrastar ---------- */

  .dragging {
    opacity: 0.45;
  }

  /* A marca de onde vai cair: uma linha fina na cor de destaque. */
  .drop-before::before,
  .drop-after::after {
    content: '';
    position: absolute;
    left: 6px;
    right: 6px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent-fg);
    pointer-events: none;
  }

  .channel-row.drop-before::before {
    top: -1px;
  }

  .channel-row.drop-after::after {
    bottom: -1px;
  }

  .category.drop-before::before {
    top: -6px;
  }

  .category:first-child.drop-before::before {
    top: -1px;
  }

  .category.drop-into .category-toggle {
    color: var(--accent-fg);
  }

  .category.drop-into {
    background: var(--accent-soft);
  }

  .drop-end {
    position: relative;
    height: 32px;
  }

  .drop-end.drop-before::before {
    top: 4px;
  }

  .relay {
    display: inline-flex;
    color: var(--accent-fg);
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

  /* Quem tem selo chegou: o nome surge com um brilho que passa (dourado e violeta pro
     Fundador, prata e azul pro Pioneiro). */
  .member:global(.arrive-founder) {
    --arrive-a: rgb(255 211 107 / 0.35);
    --arrive-b: rgb(143 132 255 / 0.4);
  }

  .member:global(.arrive-pioneer) {
    --arrive-a: rgb(217 226 236 / 0.3);
    --arrive-b: rgb(46 139 255 / 0.4);
  }

  .member:global(.arrive) {
    position: relative;
    animation: badge-arrive 1.6s var(--ease) both;
  }

  .member:global(.arrive)::after {
    content: '';
    position: absolute;
    inset: 0 0 0 26px;
    border-radius: var(--r-md);
    background: linear-gradient(100deg, transparent 20%, var(--arrive-a) 45%, var(--arrive-b) 55%, transparent 80%);
    background-size: 250% 100%;
    pointer-events: none;
    animation: badge-sweep 1.6s var(--ease) both;
  }

  @keyframes badge-arrive {
    0% {
      opacity: 0;
      translate: -10px 0;
    }
    35% {
      opacity: 1;
      translate: 0 0;
    }
  }

  @keyframes badge-sweep {
    from {
      background-position: 120% 0;
      opacity: 1;
    }
    to {
      background-position: -60% 0;
      opacity: 0;
    }
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

  .member-main :global(.ping) {
    display: none;
  }

  .member-main:hover :global(.ping),
  .member-main:focus-visible :global(.ping) {
    display: inline-flex;
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
