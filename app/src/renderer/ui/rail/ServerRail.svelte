<script lang="ts">
  import { client } from '../../lib/client.svelte'
  import type { GuildState } from '../../lib/guild.svelte'
  import { m } from '../../lib/i18n.svelte'
  import { confirmAction, ui } from '../../lib/ui.svelte'
  import { Avatar, Icon, Mascot, Menu, Spinner, tooltip, type MenuItem } from '../kit'

  const route = $derived(client.route)
  const atHome = $derived(route.kind !== 'guild')
  /** Conversas com mensagem nova aparecem no trilho, embaixo do início (como no Discord). */
  const unreadDms = $derived((client.home?.sortedDms ?? []).filter((d) => d.unread > 0).slice(0, 5))
  const homeBadge = $derived((client.home?.pendingRequests ?? 0) + (client.home?.unreadDms ?? 0))
  const update = $derived(client.update)
  const t = $derived(m.home.rail)

  let menu = $state<{ guild: GuildState; anchor: { x: number; y: number } } | null>(null)

  function guildMenu(guild: GuildState): MenuItem[] {
    const items: MenuItem[] = [
      { label: t.markRead, icon: 'check', onselect: () => guild.ackAll() },
      {
        label: guild.muted ? t.unmute : t.mute,
        icon: guild.muted ? 'bell' : 'bell-off',
        onselect: () => guild.setNotify({ ...guild.notify, mutedUntil: guild.muted ? null : 8.64e15 }),
      },
      { kind: 'separator' },
      { label: t.invite, icon: 'user-plus', onselect: () => (ui.invite = { guildId: guild.id }) },
    ]
    if (guild.canManage) {
      items.push({ label: t.settings, icon: 'settings', onselect: () => (ui.guildSettings = { guildId: guild.id, page: 'overview' }) })
    }
    if (!guild.isOwner) {
      items.push({ kind: 'separator' })
      items.push({
        label: t.leave,
        icon: 'log-out',
        danger: true,
        onselect: () =>
          confirmAction({
            title: t.leaveTitle(guild.info.name),
            description: t.leaveDescription,
            confirm: t.leaveConfirm,
            onconfirm: () => client.leaveGuild(guild.id).catch((err) => client.toast((err as Error).message)),
          }),
      })
    }
    return items
  }

  function updateClick() {
    if (update.status === 'available') window.resenha.update.download()
    else if (update.status === 'ready') client.installUpdate()
  }

  const updateTip = $derived(
    update.status === 'available'
      ? t.updateTo(update.version)
      : update.status === 'downloading'
        ? t.downloading(update.percent)
        : update.status === 'ready'
          ? t.restart
          : update.status === 'installing'
            ? t.installing
            : null,
  )
</script>

<!-- Trilho de servidores: início no topo, servidores, e no fim criar/entrar. -->
<nav class="rail" aria-label={t.label}>
  <div class="slot" class:active={atHome}>
    <span class="indicator"></span>
    <button class="home" aria-label={t.home} use:tooltip={{ text: t.home, placement: 'right' }} onclick={() => client.openHome()}>
      <Mascot size={42} float={false} />
    </button>
    {#if homeBadge && !atHome}<span class="mentions">{homeBadge > 99 ? '99+' : homeBadge}</span>{/if}
  </div>

  {#each unreadDms as dm (dm.id)}
    <div class="slot">
      <span class="indicator"></span>
      <button
        class="guild"
        aria-label={t.dmFrom(dm.user.name)}
        use:tooltip={{ text: dm.user.name, placement: 'right' }}
        onclick={() => client.navigate({ kind: 'dm', channelId: dm.id })}
      >
        <Avatar id={dm.user.id} name={dm.user.name} size={44} src={client.api?.avatar(dm.user) ?? null} />
      </button>
      <span class="mentions">{dm.unread > 99 ? '99+' : dm.unread}</span>
    </div>
  {/each}

  <span class="sep"></span>

  {#each client.guildList as guild (guild.id)}
    {@const active = route.kind === 'guild' && route.guildId === guild.id}
    {@const mentions = guild.muted ? 0 : guild.mentionTotal}
    <div class="slot" class:active class:unread={guild.hasUnread}>
      <span class="indicator"></span>
      <button
        class="guild"
        class:loading={!guild.loaded}
        aria-label={guild.info.name}
        use:tooltip={{ text: guild.info.name, placement: 'right' }}
        onclick={() => client.openGuild(guild.id)}
        oncontextmenu={(e) => {
          e.preventDefault()
          menu = { guild, anchor: { x: e.clientX, y: e.clientY } }
        }}
      >
        <Avatar id={guild.id} name={guild.info.name} size={44} square src={client.api?.media(guild.info.icon) ?? null} />
      </button>
      {#if mentions}<span class="mentions">{mentions > 99 ? '99+' : mentions}</span>{/if}
    </div>
  {/each}

  <div class="slot">
    <span class="indicator"></span>
    <button
      class="add"
      aria-label={t.addServer}
      use:tooltip={{ text: t.addServer, placement: 'right' }}
      onclick={() => (ui.addServer = { step: 'choose' })}
    >
      <Icon name="plus" size={22} />
    </button>
  </div>

  {#if updateTip}
    <div class="slot bottom">
      <button
        class="update"
        aria-label={updateTip}
        disabled={update.status === 'downloading' || update.status === 'installing'}
        use:tooltip={{ text: updateTip, placement: 'right' }}
        onclick={updateClick}
      >
        {#if update.status === 'downloading' || update.status === 'installing'}
          <Spinner size={16} />
        {:else}
          <Icon name={update.status === 'ready' ? 'restart' : 'download'} size={20} />
        {/if}
      </button>
    </div>
  {/if}
</nav>

{#if menu}
  <Menu items={guildMenu(menu.guild)} anchor={menu.anchor} placement="right-start" width={232} onclose={() => (menu = null)} />
{/if}

<style>
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    min-height: 0;
    padding: 14px 0 12px;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .slot {
    position: relative;
    display: grid;
    place-items: center;
    width: 72px;
    flex: none;
  }

  .slot.bottom {
    margin-top: auto;
  }

  /*
   * Novidade: um ponto azul no canto de cima do azulejo (recortado do fundo). O aberto
   * ganha um anel azul em volta; o resto fica um pouco apagado até o mouse passar.
   */
  .indicator {
    position: absolute;
    top: -2px;
    right: 11px;
    z-index: 1;
    width: 10px;
    height: 10px;
    border-radius: var(--r-full);
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--bg-canvas);
    scale: 0;
    transition: scale var(--t) var(--ease);
    pointer-events: none;
  }

  .slot.unread:not(.active) .indicator {
    scale: 1;
  }

  button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    /* O anel é um contorno afastado 2 px: o vão fica transparente de verdade (o fundo tem luz). */
    outline: 2px solid transparent;
    outline-offset: 2px;
    transition:
      outline-color var(--t) var(--ease),
      transform var(--t-fast) var(--ease),
      background-color var(--t) var(--ease),
      color var(--t) var(--ease);
  }

  .slot:hover button {
    outline-color: var(--line-strong);
  }

  .slot.active button {
    outline-color: var(--accent);
  }

  button:focus-visible {
    outline-color: var(--accent-fg);
  }

  button:active {
    transform: scale(0.96);
  }

  /* O início é o mascote solto (sem o quadrado do ícone); ri com o mouse em cima. */
  .home :global(.mascot) {
    filter: drop-shadow(0 6px 14px rgb(var(--accent-rgb) / 0.28));
  }

  .guild :global(.avatar),
  .guild :global(.face),
  .guild :global(img) {
    border-radius: 14px !important;
  }

  .slot:not(.active) :is(.guild, .home) {
    filter: saturate(0.85) brightness(0.88);
    transition: filter var(--t) var(--ease);
  }

  .slot:hover :is(.guild, .home) {
    filter: none;
  }

  .guild.loading {
    opacity: 0.6;
  }

  .sep {
    flex: none;
    width: 24px;
    height: 1px;
    margin: 2px 0;
    background: var(--line-strong);
  }

  .add {
    color: var(--fg-2);
    background: transparent;
    border: 1.5px dashed var(--line-strong);
  }

  .slot:hover .add {
    background: var(--accent);
    border-color: transparent;
    color: var(--fg-on-accent);
  }

  .update {
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  .slot:hover .update:not(:disabled) {
    background: var(--accent);
    color: var(--fg-on-accent);
  }

  .mentions {
    position: absolute;
    right: 8px;
    bottom: -4px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--r-full);
    background: var(--red-fill);
    box-shadow: 0 0 0 3px var(--bg-canvas);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
</style>
