<script lang="ts">
  import logo from '../../../../build/icon.svg?url'
  import { client } from '../../lib/client.svelte'
  import type { GuildState } from '../../lib/guild.svelte'
  import { confirmAction, ui } from '../../lib/ui.svelte'
  import { Avatar, Icon, Menu, Spinner, tooltip, type MenuItem } from '../kit'

  const route = $derived(client.route)
  const atHome = $derived(route.kind !== 'guild')
  /** Conversas com mensagem nova aparecem no trilho, embaixo do início (como no Discord). */
  const unreadDms = $derived((client.home?.sortedDms ?? []).filter((d) => d.unread > 0).slice(0, 5))
  const homeBadge = $derived((client.home?.pendingRequests ?? 0) + (client.home?.unreadDms ?? 0))
  const update = $derived(client.update)

  let menu = $state<{ guild: GuildState; anchor: { x: number; y: number } } | null>(null)

  function guildMenu(guild: GuildState): MenuItem[] {
    const items: MenuItem[] = [
      { label: 'Marcar como lido', icon: 'check', onselect: () => guild.ackAll() },
      {
        label: guild.muted ? 'Voltar a notificar' : 'Silenciar servidor',
        icon: guild.muted ? 'bell' : 'bell-off',
        onselect: () => guild.setNotify({ ...guild.notify, mutedUntil: guild.muted ? null : 8.64e15 }),
      },
      { kind: 'separator' },
      { label: 'Convidar pessoas', icon: 'user-plus', onselect: () => (ui.invite = { guildId: guild.id }) },
    ]
    if (guild.canManage) {
      items.push({ label: 'Configurações do servidor', icon: 'settings', onselect: () => (ui.guildSettings = { guildId: guild.id, page: 'overview' }) })
    }
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

  function updateClick() {
    if (update.status === 'available') window.resenha.update.download()
    else if (update.status === 'ready') window.resenha.update.install()
  }

  const updateTip = $derived(
    update.status === 'available'
      ? `Atualizar pra ${update.version}`
      : update.status === 'downloading'
        ? `Baixando ${update.percent}%`
        : update.status === 'ready'
          ? 'Reiniciar pra atualizar'
          : update.status === 'installing'
            ? 'Instalando…'
            : null,
  )
</script>

<!-- Trilho de servidores: início no topo, servidores, e no fim criar/entrar. -->
<nav class="rail" aria-label="Servidores">
  <div class="slot" class:active={atHome}>
    <span class="indicator"></span>
    <button class="home" aria-label="Início" use:tooltip={{ text: 'Início', placement: 'right' }} onclick={() => client.openHome()}>
      <img src={logo} alt="" width="44" height="44" draggable="false" />
    </button>
    {#if homeBadge && !atHome}<span class="mentions">{homeBadge > 99 ? '99+' : homeBadge}</span>{/if}
  </div>

  {#each unreadDms as dm (dm.id)}
    <div class="slot">
      <span class="indicator"></span>
      <button
        class="guild"
        aria-label="Mensagem de {dm.user.name}"
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
      aria-label="Criar ou entrar num servidor"
      use:tooltip={{ text: 'Criar ou entrar num servidor', placement: 'right' }}
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
    gap: 8px;
    min-height: 0;
    padding: 12px 0;
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

  /* Marquinha na borda: 8 px = novidade, 20 px = hover, 36 px = aberto. */
  .indicator {
    position: absolute;
    left: 0;
    top: 50%;
    width: 4px;
    height: 0;
    border-radius: 0 4px 4px 0;
    background: var(--fg);
    translate: 0 -50%;
    transition: height var(--t) var(--ease);
  }

  .slot.unread .indicator {
    height: 8px;
  }

  .slot:hover .indicator {
    height: 20px;
  }

  .slot.active .indicator {
    height: 36px;
  }

  button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    transition:
      border-radius var(--t) var(--ease),
      transform var(--t-fast) var(--ease),
      background-color var(--t) var(--ease);
  }

  button:active {
    transform: translateY(1px);
  }

  .home img {
    width: 44px;
    height: 44px;
    border-radius: 14px;
  }

  .guild :global(.avatar),
  .guild :global(.face),
  .guild :global(img) {
    border-radius: 16px !important;
    transition: border-radius var(--t) var(--ease);
  }

  .slot:hover .guild :global(.face),
  .slot:hover .guild :global(img),
  .slot.active .guild :global(.face),
  .slot.active .guild :global(img) {
    border-radius: 13px !important;
  }

  .slot:not(.active) .guild {
    filter: saturate(0.8) brightness(0.92);
  }

  .slot:hover .guild {
    filter: none;
  }

  .guild.loading {
    opacity: 0.6;
  }

  .sep {
    flex: none;
    width: 28px;
    height: 2px;
    margin: 2px 0;
    border-radius: 1px;
    background: var(--line-strong);
  }

  .add,
  .update {
    background: rgb(255 255 255 / 0.05);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--green);
  }

  .add:hover {
    background: var(--green);
    color: #062419;
  }

  .update {
    color: var(--accent-fg);
  }

  .update:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }

  .mentions {
    position: absolute;
    right: 10px;
    bottom: -2px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--r-full);
    background: var(--red);
    box-shadow: 0 0 0 3px var(--bg-canvas);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
    pointer-events: none;
  }
</style>
