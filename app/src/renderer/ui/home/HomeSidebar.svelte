<script lang="ts">
  import type { DmChannel } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { ui } from '../../lib/ui.svelte'
  import { Avatar, Badge, Icon, IconButton, Kbd, Menu, NavItem, type MenuItem } from '../kit'

  const home = $derived(client.home)
  const route = $derived(client.route)
  const dms = $derived(home?.sortedDms ?? [])

  let menu = $state<{ dm: DmChannel; anchor: { x: number; y: number } } | null>(null)

  /** Embaixo do nome: o status personalizado, senão em call, senão nada. */
  function subtitle(dm: DmChannel): string {
    const presence = client.presenceOf(dm.user.id)
    if (presence.text) return presence.text
    if (client.home?.calls[dm.id]?.members.length) return 'Em chamada'
    return ''
  }

  function dmMenu(dm: DmChannel): MenuItem[] {
    return [
      { label: 'Perfil', icon: 'user', onselect: () => (ui.profile = { userId: dm.user.id, guildId: null, anchor: menu!.anchor }) },
      { label: 'Ligar', icon: 'phone', onselect: () => client.startDmCall(dm.id) },
      { kind: 'separator' },
      { label: 'Fechar conversa', icon: 'x', onselect: () => home?.closeDm(dm.id) },
    ]
  }
</script>

<header>
  <button class="search" onclick={() => (ui.switcher = true)}>
    <Icon name="search" size={16} />
    <span>Encontrar conversa</span>
    <Kbd keys={['Ctrl', 'K']} />
  </button>
</header>

<nav aria-label="Início">
  <NavItem icon="users" label="Amigos" active={route.kind === 'home'} onclick={() => client.openHome()}>
    {#snippet trailing()}
      {#if home?.pendingRequests}<Badge tone="count">{home.pendingRequests}</Badge>{/if}
    {/snippet}
  </NavItem>

  <div class="section">
    <span>Mensagens privadas</span>
    <IconButton icon="plus" label="Nova mensagem" size="sm" onclick={() => (ui.switcher = true)} />
  </div>

  {#each dms as dm (dm.id)}
    {@const presence = client.presenceOf(dm.user.id)}
    {@const sub = subtitle(dm)}
    {@const active = route.kind === 'dm' && route.channelId === dm.id}
    <div class="dm-row">
      <button
        class="dm"
        class:active
        class:unread={dm.unread > 0}
        onclick={() => client.navigate({ kind: 'dm', channelId: dm.id })}
        oncontextmenu={(e) => {
          e.preventDefault()
          menu = { dm, anchor: { x: e.clientX, y: e.clientY } }
        }}
      >
        <Avatar id={dm.user.id} name={dm.user.name} size={32} src={client.api?.media(dm.user.avatar) ?? null} status={presence.status} cutout="var(--row-bg)" />
        <span class="dm-text">
          <span class="dm-name">{dm.user.name}</span>
          {#if sub}<span class="dm-sub">{sub}</span>{/if}
        </span>
        {#if dm.unread}<Badge tone="count">{dm.unread > 99 ? '99+' : dm.unread}</Badge>{/if}
      </button>
      <span class="close">
        <IconButton icon="x" label="Fechar conversa" size="sm" onclick={() => home?.closeDm(dm.id)} />
      </span>
    </div>
  {:else}
    <p class="empty">Suas conversas privadas aparecem aqui.</p>
  {/each}
</nav>

{#if menu}
  <Menu items={dmMenu(menu.dm)} anchor={menu.anchor} width={208} onclose={() => (menu = null)} />
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

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 34px;
    padding: 0 6px 0 10px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.045);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-3);
    font-size: var(--text-sm);
    transition: background-color var(--t-fast) var(--ease);
  }

  .search span {
    flex: 1;
    text-align: left;
  }

  .search:hover {
    background: rgb(255 255 255 / 0.07);
  }

  nav {
    --row-bg: var(--bg-canvas);
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 8px 16px;
    scrollbar-width: thin;
  }

  .section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 2px 4px 10px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .dm-row {
    position: relative;
  }

  .dm {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 44px;
    padding: 0 8px;
    border-radius: var(--r-md);
    color: var(--fg-3);
    text-align: left;
    transition: background-color var(--t-fast) var(--ease);
  }

  .dm:hover {
    --row-bg: color-mix(in srgb, var(--bg-canvas) 95.5%, white);
    background: var(--hover);
    color: var(--fg-2);
  }

  .dm.active {
    --row-bg: color-mix(in srgb, var(--bg-canvas) 92.5%, white);
    background: var(--selected);
    color: var(--fg);
  }

  .dm-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .dm-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-md);
    font-weight: 500;
  }

  .dm-sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .dm.unread .dm-name {
    color: var(--fg);
    font-weight: 600;
  }

  .dm.unread .dm-sub {
    color: var(--fg-2);
  }

  /* O × aparece no hover, no lugar do contador. */
  .close {
    position: absolute;
    top: 50%;
    right: 6px;
    translate: 0 -50%;
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  .dm-row:hover .close,
  .close:focus-within {
    opacity: 1;
  }

  .dm-row:hover .dm :global(.badge) {
    visibility: hidden;
  }

  .empty {
    padding: 8px 10px;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }
</style>
