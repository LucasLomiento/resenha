<script lang="ts">
  import { P } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { formatDay } from '../../lib/format'
  import { confirmAction, ui } from '../../lib/ui.svelte'
  import { canModerate, memberMenu } from '../guild/memberMenu'
  import { nameStyle } from '../../lib/profile'
  import { Avatar, Badge, Button, Icon, IconButton, Menu, STATUS_LABEL, tooltip, type MenuItem } from '../kit'
  import ProfileShell from './ProfileShell.svelte'

  /**
   * Corpo do perfil: no cartão (popover) e no painel ao lado da conversa
   * privada (`flat`, sem as ações de mensagem).
   */
  let { userId, guildId, flat = false, onaction }: { userId: string; guildId: string | null; flat?: boolean; onaction?: () => void } = $props()

  const guild = $derived(guildId ? (client.guilds[guildId] ?? null) : null)
  const profile = $derived(client.user(userId, guildId))
  const presence = $derived(client.presenceOf(userId))
  const member = $derived(guild?.members[userId] ?? null)
  const self = $derived(userId === client.me?.id)
  const hex = (color: number | null) => (color === null ? null : `#${color.toString(16).padStart(6, '0')}`)
  const style = $derived(profile?.deleted ? undefined : profile?.style)
  const styledName = $derived(nameStyle(profile))
  const ownRoles = $derived(guild ? guild.rolesOf(userId).filter((r) => r.id !== guild.id) : [])
  /** Servidores que vocês dois estão (entre os que eu vejo). */
  const mutual = $derived(self ? [] : client.guildList.filter((g) => !!g.members[userId]))
  const friend = $derived(client.home?.friends.find((f) => f.user.id === userId) ?? null)
  const blocked = $derived(client.home?.isBlocked(userId) ?? false)
  const canEditRoles = $derived(!!guild && guild.canGuild(P.MANAGE_ROLES) && (self || canModerate(guild, userId)))
  const canEditNick = $derived(
    !!guild && !!member && (self ? guild.canGuild(P.CHANGE_NICKNAME) : guild.canGuild(P.MANAGE_NICKNAMES) && canModerate(guild, userId)),
  )

  let menu = $state<{ items: MenuItem[]; anchor: HTMLElement } | null>(null)
  let editingNick = $state(false)
  let nick = $state('')

  function rolesMenu(anchor: HTMLElement) {
    if (!guild) return
    const me = guild.members[guild.meId]
    const myTop = guild.isOwner ? Infinity : Math.max(0, ...guild.roles.filter((r) => me?.roles.includes(r.id)).map((r) => r.position))
    const current = new Set(member?.roles ?? [])
    const items: MenuItem[] = guild.roles
      .filter((r) => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        label: role.name,
        checked: current.has(role.id),
        disabled: role.position >= myTop,
        onselect: () => {
          const next = current.has(role.id) ? [...current].filter((id) => id !== role.id) : [...current, role.id]
          guild.setRoles(userId, next)
        },
      }))
    if (!items.length) items.push({ label: 'Nenhum cargo criado ainda', disabled: true })
    menu = { items, anchor }
  }

  function moreMenu(anchor: HTMLElement) {
    const items: MenuItem[] = guild ? memberMenu(guild, userId, anchor).filter((i) => !('label' in i) || i.label !== 'Perfil') : []
    if (!self && profile) {
      if (items.length) items.push({ kind: 'separator' })
      if (friend?.state === 'friends') {
        items.push({
          label: 'Desfazer amizade',
          icon: 'user-x',
          onselect: () =>
            confirmAction({
              title: `Desfazer a amizade com ${profile.name}?`,
              confirm: 'Desfazer',
              onconfirm: () => client.api?.friendRemove(userId).catch((e) => client.toast((e as Error).message)),
            }),
        })
      }
      items.push(
        blocked
          ? { label: 'Desbloquear', icon: 'ban', onselect: () => client.api?.unblock(userId).catch((e) => client.toast((e as Error).message)) }
          : {
              label: 'Bloquear',
              icon: 'ban',
              danger: true,
              onselect: () =>
                confirmAction({
                  title: `Bloquear ${profile.name}?`,
                  description: 'Vocês não vão poder trocar mensagens privadas, e a amizade acaba.',
                  confirm: 'Bloquear',
                  onconfirm: () => client.api?.block(userId).catch((e) => client.toast((e as Error).message)),
                }),
            },
      )
    }
    if (items.length) menu = { items, anchor }
  }

  async function addFriend() {
    if (!profile || !client.api) return
    try {
      if (friend?.state === 'incoming') await client.api.friendAccept(userId)
      else await client.api.friendRequest(profile.username)
      client.toast(friend?.state === 'incoming' ? 'Agora vocês são amigos.' : 'Pedido de amizade enviado.', 'info')
    } catch (err) {
      client.toast((err as Error).message)
    }
  }

  function saveNick() {
    if (!guild) return
    const value = nick.trim()
    if (value !== (member?.nick ?? '')) guild.setNick(userId, value || null)
    editingNick = false
  }

  async function message() {
    await client.openDm(userId)
    onaction?.()
  }

  async function call() {
    await client.openDm(userId)
    onaction?.()
    if (client.route.kind === 'dm') client.startDmCall(client.route.channelId)
  }
</script>

{#if profile}
  <ProfileShell user={profile} banner={client.api?.media(style?.banner ?? null) ?? null} variant={flat ? 'flat' : 'card'}>
    <div class="top">
      <Avatar
        id={profile.id}
        name={profile.name}
        size={80}
        src={client.api?.media(profile.avatar) ?? null}
        decoration={style?.decoration}
        play
        status={profile.deleted ? null : presence.status}
        cutout="var(--card-cut)"
      />
      {#if !profile.deleted}
        <div class="top-actions">
          {#if self}
            <IconButton icon="pencil" label="Editar perfil" size="sm" variant="subtle" onclick={() => ((ui.settings = 'profile'), onaction?.())} />
          {:else}
            <IconButton icon="ellipsis" label="Mais" size="sm" variant="subtle" onclick={(e) => moreMenu(e.currentTarget)} />
          {/if}
        </div>
      {/if}
    </div>

    <div class="body">
      {#if editingNick}
        <input
          class="nick"
          bind:value={nick}
          maxlength={32}
          placeholder={profile.name}
          aria-label="Apelido no servidor"
          data-own-escape
          onkeydown={(e) => {
            if (e.key === 'Enter') saveNick()
            if (e.key === 'Escape') {
              e.preventDefault()
              editingNick = false
            }
          }}
          onblur={saveNick}
          use:autofocus
        />
      {:else}
        <h2>
          <span class={styledName.class} style={styledName.style}>{guild ? guild.displayName(userId) : profile.name}</span>
          {#if canEditNick}
            <button class="nick-edit" aria-label="Mudar apelido" use:tooltip={'Apelido neste servidor'} onclick={() => ((nick = member?.nick ?? ''), (editingNick = true))}>
              <Icon name="pencil" size={13} />
            </button>
          {/if}
        </h2>
      {/if}
      <p class="username">
        {profile.deleted ? 'Conta excluída' : `@${profile.username}`}{#if member?.nick}<span> · {profile.name}</span>{/if}{#if style?.pronouns}<span
            class="pronouns">{style.pronouns}</span
          >{/if}
      </p>
      {#if !profile.deleted}
        {#if presence.text}
          <p class="custom"><span class="bubble">{presence.text}</span></p>
        {:else}
          <p class="custom muted">{STATUS_LABEL[presence.status]}</p>
        {/if}
      {/if}

      {#if profile.bio}
        <section>
          <h3>Sobre mim</h3>
          <p class="bio selectable">{profile.bio}</p>
        </section>
      {/if}

      {#if guild && member}
        <section>
          <h3>Membro desde</h3>
          <p class="since"><Icon name="calendar" size={14} />{formatDay(member.joinedAt)}</p>
        </section>
        {#if ownRoles.length || canEditRoles}
          <section>
            <h3>Cargos</h3>
            <div class="roles">
              {#each ownRoles as role (role.id)}
                <Badge dot={hex(role.color) ?? undefined}>{role.name}</Badge>
              {/each}
              {#if canEditRoles}
                <button class="add-role" aria-label="Dar ou tirar cargos" use:tooltip={'Cargos'} onclick={(e) => rolesMenu(e.currentTarget)}>
                  <Icon name="plus" size={14} />
                </button>
              {/if}
            </div>
          </section>
        {/if}
      {/if}

      {#if !guild && mutual.length}
        <section>
          <h3>Servidores em comum</h3>
          <div class="mutual">
            {#each mutual.slice(0, 5) as g (g.id)}
              <button class="mutual-item" onclick={() => ((onaction?.(), client.openGuild(g.id)))}>
                <Avatar id={g.id} name={g.info.name} size={24} square src={client.api?.media(g.info.icon) ?? null} />{g.info.name}
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if !self && !profile.deleted && !flat}
        <div class="actions">
          <Button variant="primary" icon="message" onclick={message} disabled={blocked}>Mensagem</Button>
          <IconButton icon="phone" label="Ligar" variant="subtle" size="lg" disabled={blocked} onclick={call} />
          {#if !friend || friend.state === 'incoming'}
            <IconButton icon="user-plus" label={friend?.state === 'incoming' ? 'Aceitar amizade' : 'Adicionar amigo'} variant="subtle" size="lg" onclick={addFriend} />
          {/if}
        </div>
      {:else if self && !flat}
        <div class="actions">
          <Button variant="secondary" icon="pencil" onclick={() => ((ui.settings = 'profile'), onaction?.())}>Editar perfil</Button>
        </div>
      {/if}
    </div>
  </ProfileShell>
{/if}

{#if menu}
  <Menu items={menu.items} anchor={menu.anchor} placement="bottom-end" width={232} onclose={() => (menu = null)} />
{/if}

<script lang="ts" module>
  function autofocus(node: HTMLInputElement) {
    requestAnimationFrame(() => {
      node.focus()
      node.select()
    })
  }
</script>

<style>
  .top {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-top: -44px;
    padding: 0 16px;
  }

  .top :global(.avatar) {
    border-radius: 50%;
    box-shadow: 0 0 0 6px var(--card-cut);
  }

  .top-actions {
    padding-bottom: 6px;
  }

  .body {
    padding: 12px 16px 16px;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.015em;
    overflow-wrap: anywhere;
  }

  /* No cartão o nome pode quebrar linha: volta pro espaçamento normal. */
  h2 :global(.styled-name) {
    line-height: inherit;
  }

  .nick-edit {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  h2:hover .nick-edit,
  .nick-edit:focus-visible {
    opacity: 1;
  }

  .nick-edit:hover {
    background: var(--hover);
    color: var(--fg);
  }

  .nick {
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--r-md);
    outline: none;
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--accent-line);
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .username {
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .username span {
    color: var(--fg-3);
  }

  .username .pronouns {
    margin-left: 8px;
    padding: 1px 7px;
    border-radius: var(--r-full);
    background: rgb(255 255 255 / 0.07);
    color: var(--fg-2);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .custom {
    margin-top: 10px;
    font-size: var(--text-sm);
  }

  .bubble {
    display: inline-block;
    padding: 6px 10px;
    border-radius: 12px 12px 12px 4px;
    background: rgb(255 255 255 / 0.06);
    color: var(--fg);
  }

  .custom.muted {
    color: var(--fg-3);
  }

  section {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  h3 {
    margin-bottom: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  section p {
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .bio {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .since {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .since :global(svg) {
    color: var(--fg-3);
  }

  .roles {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .add-role {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: var(--r-sm);
    background: rgb(255 255 255 / 0.07);
    color: var(--fg-2);
  }

  .add-role:hover {
    background: rgb(255 255 255 / 0.12);
    color: var(--fg);
  }

  .mutual {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mutual-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px;
    border-radius: var(--r-md);
    font-size: var(--text-sm);
    font-weight: 500;
    text-align: left;
  }

  .mutual-item:hover {
    background: var(--hover);
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }

  .actions :global(.btn) {
    flex: 1;
    height: 36px;
  }
</style>
