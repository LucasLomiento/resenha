<script lang="ts">
  import { Avatar, Badge, Icon, IconButton, Kbd, NavItem } from '../kit'
  import { dms, friends, presences, user } from './data'
  import ProtoDock from './ProtoDock.svelte'

  let { active = 'friends' }: { active?: string } = $props()

  const pending = friends.filter((f) => f.state === 'incoming').length
</script>

<aside class="sidebar">
  <header>
    <button class="search">
      <Icon name="search" size={16} />
      <span>Encontrar conversa</span>
      <Kbd keys={['Ctrl', 'K']} />
    </button>
  </header>

  <nav aria-label="Início">
    <NavItem icon="users" label="Amigos" active={active === 'friends'}>
      {#snippet trailing()}
        {#if pending}<Badge tone="count">{pending}</Badge>{/if}
      {/snippet}
    </NavItem>

    <div class="section">
      <span>Mensagens privadas</span>
      <IconButton icon="plus" label="Nova mensagem" size="sm" />
    </div>

    {#each dms as dm (dm.id)}
      {@const person = user(dm.userId)}
      {@const presence = presences[dm.userId]}
      <button class="dm" class:active={active === dm.id} class:unread={dm.unread > 0}>
        <Avatar id={person.id} name={person.name} size={32} status={presence.status} cutout="var(--row-bg)" />
        <span class="dm-text">
          <span class="dm-name">{person.name}</span>
          <span class="dm-sub">{presence.text ?? dm.last}</span>
        </span>
        {#if dm.unread}<Badge tone="count">{dm.unread}</Badge>{/if}
      </button>
    {/each}
  </nav>

  <ProtoDock statusText="Fazendo o app novo" />
</aside>

<style>
  .sidebar {
    --row-bg: var(--bg-canvas);
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding-top: 8px;
  }

  header {
    display: flex;
    align-items: center;
    height: var(--header-h);
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
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 8px 16px;
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
</style>
