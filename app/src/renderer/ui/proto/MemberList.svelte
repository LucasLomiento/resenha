<script lang="ts">
  import { Avatar, Icon, tooltip } from '../kit'
  import { channels, displayName, guilds, members, presences, roleColor, roles, user, voice } from './data'

  let { selected }: { selected?: string } = $props()

  const owner = guilds[0].ownerId
  const online = members.filter((m) => presences[m.userId].status !== 'offline')
  const offline = members.filter((m) => presences[m.userId].status === 'offline')

  /** Cargos separados (hoist), do mais alto pro mais baixo; cada pessoa entra só no mais alto. */
  const hoisted = roles.filter((r) => r.hoist).sort((a, b) => b.position - a.position)
  const topHoisted = (userId: string) => hoisted.find((r) => members.find((m) => m.userId === userId)?.roles.includes(r.id))?.id
  const groups = [
    ...hoisted.map((role) => ({ title: role.name, people: online.filter((m) => topHoisted(m.userId) === role.id) })),
    { title: 'Online', people: online.filter((m) => !topHoisted(m.userId)) },
    { title: 'Offline', people: offline },
  ].filter((g) => g.people.length)

  function activity(userId: string) {
    const call = voice.find((v) => v.userId === userId)
    if (call) return { icon: 'audio-lines' as const, text: `Na call · ${channels.find((c) => c.id === call.channelId)?.name}` }
    const text = presences[userId].text
    return text ? { icon: null, text } : null
  }
</script>

<aside class="members" aria-label="Membros">
  {#each groups as group (group.title)}
    <div class="group-title">{group.title} — {group.people.length}</div>
    {#each group.people as person (person.userId)}
      {@const profile = user(person.userId)}
      {@const now = activity(person.userId)}
      {@const off = presences[person.userId].status === 'offline'}
      <button class="member" class:off class:selected={selected === person.userId}>
        <Avatar
          id={profile.id}
          name={profile.name}
          size={32}
          status={off ? null : presences[person.userId].status}
          cutout={selected === person.userId ? '#1e1e26' : 'var(--bg-panel)'}
        />
        <span class="text">
          <span class="name-row">
            <span class="name" style:color={off ? null : roleColor(person.userId)}>{displayName(person.userId)}</span>
            {#if person.userId === owner}<span class="crown" use:tooltip={'Dono do servidor'}><Icon name="crown" size={13} /></span>{/if}
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

<style>
  .members {
    height: 100%;
    padding: 12px 8px 16px;
    overflow-y: auto;
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

  .crown {
    display: inline-flex;
    color: var(--yellow);
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
