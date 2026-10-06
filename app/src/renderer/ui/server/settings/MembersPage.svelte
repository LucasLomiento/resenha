<script lang="ts">
  import { P, type Member } from '../../../../../../shared/protocol'
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { Avatar, Badge, Button, EmptyState, Icon, IconButton, Menu, PageHeader, Section, Select, TextField, tooltip, type MenuItem } from '../../kit'
  import { hex, isAdmin, myTop, outranksMember } from '../permissions'
  import { settled } from '../settle.svelte'
  import { fold, plural, shortDate, whenText } from '../util'
  import MemberDialog, { type MemberAction } from './MemberDialog.svelte'

  let { guild }: { guild: GuildState } = $props()

  const PAGE = 100

  let query = $state('')
  let roleFilter = $state('all')
  let limit = $state(PAGE)

  const roles = $derived(guild.roles.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position))
  const total = $derived(Object.keys(guild.members).length)
  const top = $derived(myTop(guild))

  const members = $derived.by(() => {
    const q = fold(query.trim())
    return Object.values(guild.members)
      .filter((m) => roleFilter === 'all' || m.roles.includes(roleFilter))
      .filter((m) => {
        if (!q) return true
        const user = guild.users[m.userId]
        return [guild.displayName(m.userId), user?.username ?? '', user?.name ?? ''].some((text) => fold(text).includes(q))
      })
      .sort((a, b) => guild.displayName(a.userId).localeCompare(guild.displayName(b.userId), 'pt-BR'))
  })

  // Filtro mudou: volta pra primeira página.
  $effect(() => {
    void query
    void roleFilter
    limit = PAGE
  })

  const timedOut = (m: Member | undefined) => !!m?.timeoutUntil && m.timeoutUntil > client.now

  // ---------- Ações (só o que a pessoa pode, e só em quem está abaixo dela) ----------

  let menu = $state<{ userId: string; anchor: HTMLElement } | null>(null)
  let dialog = $state<{ action: MemberAction; userId: string } | null>(null)

  function itemsFor(userId: string): MenuItem[] {
    const member = guild.members[userId]
    if (!member) return []
    const self = userId === guild.meId
    const below = outranksMember(guild, userId)
    const name = guild.displayName(userId)
    const open = (action: MemberAction) => () => (dialog = { action, userId })

    const manage: MenuItem[] = []
    if (guild.canGuild(P.MANAGE_ROLES) && (self || below) && roles.some((r) => guild.isOwner || r.position < top)) {
      manage.push({ label: 'Cargos', icon: 'shield', hint: member.roles.length ? String(member.roles.length) : undefined, onselect: open('roles') })
    }
    if (self ? guild.canGuild(P.CHANGE_NICKNAME) : guild.canGuild(P.MANAGE_NICKNAMES) && below) {
      manage.push({ label: 'Mudar apelido', icon: 'pencil', onselect: open('nick') })
    }

    const moderate: MenuItem[] = []
    if (!self && below && guild.canGuild(P.MODERATE_MEMBERS) && !isAdmin(guild, userId)) {
      moderate.push(
        timedOut(member)
          ? { label: 'Tirar castigo', icon: 'clock', onselect: () => untimeout(userId) }
          : { label: 'Castigar…', icon: 'clock', onselect: open('timeout') },
      )
    }
    if (!self && below && guild.canGuild(P.KICK_MEMBERS)) moderate.push({ label: `Expulsar ${name}`, icon: 'door-open', danger: true, onselect: open('kick') })
    if (!self && below && guild.canGuild(P.BAN_MEMBERS)) moderate.push({ label: `Banir ${name}`, icon: 'hammer', danger: true, onselect: open('ban') })

    return manage.length && moderate.length ? [...manage, { kind: 'separator' }, ...moderate] : [...manage, ...moderate]
  }

  function toggleMenu(event: MouseEvent, userId: string) {
    menu = menu?.userId === userId ? null : { userId, anchor: event.currentTarget as HTMLElement }
  }

  async function untimeout(userId: string) {
    const name = guild.displayName(userId)
    guild.timeout(userId, 0)
    if (await settled(() => !timedOut(guild.members[userId]))) client.toast(`Você tirou o castigo de ${name}.`, 'info')
  }
</script>

<PageHeader title="Membros" description="{plural(total, 'pessoa', 'pessoas')} no servidor." />

<div class="toolbar">
  <div class="grow">
    <TextField icon="search" placeholder="Buscar por nome" aria-label="Buscar membros" bind:value={query} spellcheck={false} />
  </div>
  <div class="filter">
    <Select
      label="Filtrar por cargo"
      bind:value={roleFilter}
      options={[{ value: 'all', label: 'Todos os cargos' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]}
    />
  </div>
</div>

{#if members.length === 0}
  <div class="empty">
    <EmptyState icon="search" title="Ninguém encontrado" description="Tente outro nome ou outro cargo." />
  </div>
{:else}
  <Section>
    {#each members.slice(0, limit) as m (m.userId)}
      {@const name = guild.displayName(m.userId)}
      {@const user = guild.users[m.userId]}
      {@const own = guild.rolesOf(m.userId)}
      {@const items = itemsFor(m.userId)}
      <div class="member">
        <Avatar id={m.userId} {name} size={36} src={client.avatarOf(m.userId, guild.id)} cutout="var(--bg-raised)" />
        <span class="member-text">
          <span class="member-name">
            <span class="truncate" style:color={hex(guild.colorOf(m.userId))}>{name}</span>
            {#if m.userId === guild.info.ownerId}
              <span class="crown" use:tooltip={'Dono do servidor'}><Icon name="crown" size={14} /></span>
            {/if}
          </span>
          <span class="member-sub truncate">@{user?.username ?? 'desconhecido'}</span>
        </span>
        <span class="member-roles">
          {#if timedOut(m)}
            <span use:tooltip={`Até ${whenText(m.timeoutUntil!, client.now)}`}><Badge tone="warning">De castigo</Badge></span>
          {/if}
          {#each own.slice(0, 2) as r (r.id)}
            <Badge dot={hex(r.color) ?? undefined}>{r.name}</Badge>
          {/each}
          {#if own.length > 2}
            <span use:tooltip={own.slice(2).map((r) => r.name).join(', ')}><Badge>+{own.length - 2}</Badge></span>
          {/if}
        </span>
        <span class="member-date tabular" use:tooltip={'Entrou no servidor'}>{shortDate(m.joinedAt)}</span>
        {#if items.length}
          <IconButton icon="ellipsis" label="Ações de {name}" size="sm" active={menu?.userId === m.userId} onclick={(e) => toggleMenu(e, m.userId)} />
        {:else}
          <span class="menu-gap" aria-hidden="true"></span>
        {/if}
      </div>
    {/each}
  </Section>
  {#if members.length > limit}
    <div class="more">
      <Button variant="ghost" onclick={() => (limit += PAGE)}>Mostrar mais</Button>
    </div>
  {/if}
{/if}

{#if menu}
  <Menu items={itemsFor(menu.userId)} anchor={menu.anchor} placement="bottom-end" width={230} onclose={() => (menu = null)} />
{/if}

{#if dialog}
  <MemberDialog {guild} action={dialog.action} userId={dialog.userId} onclose={() => (dialog = null)} />
{/if}

<style>
  .toolbar {
    display: flex;
    gap: var(--s-2);
    margin-bottom: var(--s-3);
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  .filter {
    width: 180px;
    display: flex;
    align-items: flex-end;
  }

  .filter :global(.select select) {
    height: var(--h-lg);
  }

  .member {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 56px;
    padding: 10px 12px 10px 16px;
  }

  .member + .member {
    border-top: 1px solid var(--line);
  }

  .member-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.35;
  }

  .member-name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-weight: 600;
  }

  .crown {
    display: grid;
    color: var(--yellow);
  }

  .member-sub {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .member-roles {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 0;
    max-width: 45%;
    overflow: hidden;
  }

  .member-date {
    flex: none;
    width: 84px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    text-align: right;
  }

  .menu-gap {
    width: 28px;
    flex: none;
  }

  .empty {
    padding: var(--s-10) 0;
  }

  .more {
    display: flex;
    justify-content: center;
    margin-top: var(--s-3);
  }
</style>
