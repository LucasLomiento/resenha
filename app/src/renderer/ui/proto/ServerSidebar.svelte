<script lang="ts">
  import { Avatar, Icon, IconButton, NavItem, tooltip } from '../kit'
  import { channels, displayName, guilds, user, voice } from './data'
  import ProtoDock from './ProtoDock.svelte'

  let {
    active = 'c-geral',
    menuOpen = false,
    inCall = false,
  }: {
    active?: string
    /** Menu do servidor aberto (cabeçalho destacado). */
    menuOpen?: boolean
    inCall?: boolean
  } = $props()

  const guild = guilds[0]
  const categories = channels.filter((c) => c.kind === 'category')
  const inside = (id: string) => channels.filter((c) => c.parentId === id)
  let collapsed = $state<Record<string, boolean>>({})
</script>

<aside class="sidebar">
  <header>
    <button class="server" class:open={menuOpen} aria-haspopup="menu">
      <span class="server-name">{guild.name}</span>
      <Icon name="chevron-down" size={16} />
    </button>
  </header>

  <nav aria-label="Canais">
    {#each categories as category (category.id)}
      <div class="category">
        <button class="category-toggle" onclick={() => (collapsed[category.id] = !collapsed[category.id])}>
          <Icon name={collapsed[category.id] ? 'chevron-right' : 'chevron-down'} size={12} />
          {category.name}
        </button>
        <span class="category-add"><IconButton icon="plus" label="Criar canal" size="sm" tip="top" /></span>
      </div>

      {#if !collapsed[category.id]}
        {#each inside(category.id) as channel (channel.id)}
          {#if channel.kind === 'text'}
            <NavItem
              icon={channel.private ? 'lock' : 'hash'}
              label={channel.name}
              active={active === channel.id}
              unread={channel.unread}
              muted={channel.muted}
              count={channel.mentions ?? 0}
            />
          {:else}
            {@const people = voice.filter((v) => v.channelId === channel.id)}
            <NavItem icon="volume" label={channel.name} active={active === channel.id} />
            {#if people.length}
              <ul class="members">
                {#each people as person (person.userId)}
                  <li class="member">
                    <Avatar id={person.userId} name={user(person.userId).name} size={22} speaking={person.speaking} />
                    <span class="member-name">{displayName(person.userId)}</span>
                    {#if person.camera}<Icon name="camera" size={14} class="soft" />{/if}
                    {#if person.deafened}<Icon name="headphones-off" size={14} class="state" />
                    {:else if person.muted}<Icon name="mic-off" size={14} class="state" />{/if}
                    {#if person.sharing}<span class="live" use:tooltip={'Assistir'}>AO VIVO</span>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        {/each}
      {/if}
    {/each}
  </nav>

  <ProtoDock call={inCall ? { channel: 'Rolê', server: guild.name } : null} />
</aside>

<style>
  .sidebar {
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

  .server {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    height: 40px;
    padding: 0 10px 0 10px;
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
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px 16px;
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
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
    transition: color var(--t-fast) var(--ease);
  }

  .category-toggle:hover {
    color: var(--fg-2);
  }

  .category-add {
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  .category:hover .category-add {
    opacity: 1;
  }

  .members {
    margin: 2px 0 4px;
    padding: 0;
    list-style: none;
  }

  .member {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 6px 0 38px;
    border-radius: var(--r-md);
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .member:hover {
    background: var(--hover);
    color: var(--fg);
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

  .member :global(.state) {
    color: var(--red);
  }

  .live {
    height: 18px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--red);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    line-height: 18px;
  }
</style>
