<script lang="ts">
  import { client } from '../../lib/client.svelte'
  import type { GuildState } from '../../lib/guild.svelte'
  import { isFounder, nameStyle } from '../../lib/profile'
  import { openProfile, ui } from '../../lib/ui.svelte'
  import { Avatar, FounderBadge, Icon, Menu, tooltip, type MenuItem } from '../kit'
  import { memberMenu } from './memberMenu'

  let { guild }: { guild: GuildState } = $props()

  const hex = (color: number | null) => (color === null ? null : `#${color.toString(16).padStart(6, '0')}`)
  const selected = $derived(ui.profile?.guildId === guild.id ? ui.profile.userId : null)

  let menu = $state<{ items: MenuItem[]; anchor: { x: number; y: number } } | null>(null)
  /** Linha com o mouse em cima: a foto animada e a moldura dela se mexem. */
  let hovered = $state<string | null>(null)

  /** Embaixo do nome: na call, senão o status personalizado. */
  function activity(userId: string) {
    const call = guild.voice.find((v) => v.userId === userId)
    if (call) return { icon: 'audio-lines' as const, text: `Na call · ${guild.channel(call.channelId)?.name ?? ''}` }
    const text = guild.presences[userId]?.text
    return text ? { icon: null, text } : null
  }

  function timedOut(userId: string) {
    const until = guild.members[userId]?.timeoutUntil
    return !!until && until > client.now
  }
</script>

<aside class="members" aria-label="Membros">
  {#each guild.memberGroups as group (group.title)}
    <div class="group-title">{group.title} — {group.ids.length}</div>
    {#each group.ids as userId (userId)}
      {@const user = guild.users[userId]}
      {@const presence = guild.presences[userId]}
      {@const off = !presence || presence.status === 'offline'}
      {@const now = activity(userId)}
      {@const styled = nameStyle(user)}
      <button
        class="member"
        class:off
        class:selected={selected === userId}
        onpointerenter={() => (hovered = userId)}
        onpointerleave={() => hovered === userId && (hovered = null)}
        onclick={(e) => openProfile(userId, guild.id, e.currentTarget)}
        oncontextmenu={(e) => {
          e.preventDefault()
          menu = { items: memberMenu(guild, userId, { x: e.clientX, y: e.clientY }), anchor: { x: e.clientX, y: e.clientY } }
        }}
      >
        <Avatar
          id={userId}
          name={user?.name ?? '?'}
          size={32}
          src={client.avatarOf(userId, guild.id)}
          animated={client.animatedAvatarOf(userId, guild.id)}
          decoration={user?.deleted ? null : user?.style?.decoration}
          play={hovered === userId}
          status={off ? null : presence.status}
          cutout={selected === userId ? '#1e1e26' : 'var(--bg-panel)'}
        />
        <span class="text">
          <span class="name-row">
            <span class="name" class:styled={!!styled.class} style:color={off ? null : hex(guild.colorOf(userId))}
              ><span class={styled.class} style={styled.style}>{guild.displayName(userId)}</span></span
            >
            {#if isFounder(user)}<FounderBadge size={14} />{/if}
            {#if userId === guild.info.ownerId}<span class="crown" use:tooltip={'Dono do servidor'}><Icon name="crown" size={13} /></span>{/if}
            {#if timedOut(userId)}<span class="timeout" use:tooltip={'De castigo'}><Icon name="clock" size={13} /></span>{/if}
          </span>
          {#if now && !off}
            <span class="activity">
              {#if now.icon}<Icon name={now.icon} size={12} />{/if}
              {now.text}
            </span>
          {/if}
        </span>
      </button>
    {/each}
  {/each}
</aside>

{#if menu}
  <Menu items={menu.items} anchor={menu.anchor} width={232} onclose={() => (menu = null)} />
{/if}

<style>
  .members {
    height: 100%;
    padding: 12px 8px 16px;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .group-title {
    padding: 14px 10px 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .group-title:first-child {
    padding-top: 4px;
  }

  .member {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 44px;
    padding: 0 8px;
    border-radius: var(--r-md);
    text-align: left;
    transition: background-color var(--t-fast) var(--ease);
  }

  .member:hover {
    background: var(--hover);
  }

  .member.selected {
    background: var(--selected);
  }

  .member.off {
    opacity: 0.45;
  }

  .member.off:hover {
    opacity: 0.75;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
    font-size: var(--text-md);
    font-weight: 500;
  }

  /* Fonte com mais sobra em cima e embaixo (cursiva): a caixa do corte cresce sem mexer na linha. */
  .name.styled {
    margin-block: -3px;
    padding-block: 3px;
  }

  .crown {
    display: inline-flex;
    color: var(--yellow);
  }

  .timeout {
    display: inline-flex;
    color: var(--red);
  }

  .activity {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }
</style>
