<script lang="ts">
  import { P, type Friend, type User, type VisibleStatus } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import type { GuildState } from '../../lib/guild.svelte'
  import { confirmAction, openProfile } from '../../lib/ui.svelte'
  import { Avatar, Badge, Button, EmptyState, Icon, IconButton, Menu, Spinner, STATUS_LABEL, Tabs, TextField, type MenuItem } from '../kit'

  type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add'

  const uid = $props.id()
  let tab = $state<Tab>('online')
  let search = $state('')

  const home = $derived(client.home)
  const me = $derived(client.me)

  // ---------- Listas ----------

  const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const byName = (a: Friend, b: Friend) => a.user.name.localeCompare(b.user.name, 'pt-BR')

  const accepted = $derived((home?.friends ?? []).filter((f) => f.state === 'friends').sort(byName))
  const online = $derived(accepted.filter((f) => client.presenceOf(f.user.id).status !== 'offline'))
  const incoming = $derived((home?.friends ?? []).filter((f) => f.state === 'incoming').sort(byName))
  const outgoing = $derived((home?.friends ?? []).filter((f) => f.state === 'outgoing').sort(byName))
  const blocked = $derived([...(home?.blocked ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))

  const term = $derived(fold(search.trim()))
  const matches = (user: User) => !term || fold(user.name).includes(term) || user.username.includes(term)

  // ---------- Quem está em call (servidores em comum) ----------

  interface LiveCall {
    guild: GuildState
    channelId: string
    name: string
    /** Quem está dentro (uma vez por pessoa, mesmo com dois aparelhos). */
    people: string[]
    /** Quem está ao vivo (compartilhando a tela). */
    sharing: string[]
  }

  /** Canal de voz que eu enxergo (canal privado de outros não aparece nem no "Na call"). */
  const visible = (guild: GuildState, channelId: string) => (guild.permissions[channelId] !== undefined ? guild.channel(channelId) : null)

  /** Calls com algum amigo dentro, ao vivo primeiro (coluna "Agora"). */
  const calls = $derived.by(() => {
    const out: LiveCall[] = []
    for (const guild of client.guildList) {
      const channels = new Map<string, LiveCall>()
      for (const member of guild.voice) {
        const channel = visible(guild, member.channelId)
        if (!channel) continue
        let call = channels.get(channel.id)
        if (!call) channels.set(channel.id, (call = { guild, channelId: channel.id, name: channel.name, people: [], sharing: [] }))
        if (!call.people.includes(member.userId)) call.people.push(member.userId)
        if (member.sharing && !call.sharing.includes(member.userId)) call.sharing.push(member.userId)
      }
      for (const call of channels.values()) if (call.people.some((id) => home?.isFriend(id))) out.push(call)
    }
    return out.sort((a, b) => b.sharing.length - a.sharing.length || b.people.length - a.people.length)
  })

  /** Canal de voz em que cada pessoa está, pra linha "Na call · canal". */
  const inCall = $derived.by(() => {
    const map = new Map<string, string>()
    for (const guild of client.guildList) {
      for (const member of guild.voice) {
        const channel = visible(guild, member.channelId)
        if (channel && !map.has(member.userId)) map.set(member.userId, channel.name)
      }
    }
    return map
  })

  const inMyCall = (call: LiveCall) => client.call.guildId === call.guild.id && client.call.channelId === call.channelId
  const names = (call: LiveCall, ids: string[]) => ids.map((id) => call.guild.displayName(id)).join(', ')

  // ---------- Ações ----------

  /** Pessoa com ação em andamento (trava os botões da linha). */
  let busy = $state<Record<string, boolean>>({})

  async function act(userId: string, run: (api: NonNullable<typeof client.api>) => Promise<unknown>) {
    const api = client.api
    if (!api || busy[userId]) return
    busy[userId] = true
    try {
      // A conexão pessoal traz as listas novas (amigos e bloqueados).
      await run(api)
    } catch (err) {
      client.toast((err as Error).message)
    } finally {
      delete busy[userId]
    }
  }

  function unfriend(user: User) {
    confirmAction({
      title: `Desfazer amizade com ${user.name}?`,
      description: 'Pra voltar, alguém manda outro pedido.',
      confirm: 'Desfazer',
      onconfirm: () => act(user.id, (api) => api.friendRemove(user.id)),
    })
  }

  function block(user: User) {
    confirmAction({
      title: `Bloquear ${user.name}?`,
      description: 'A amizade acaba, e a pessoa não consegue te mandar mensagem privada nem pedido.',
      confirm: 'Bloquear',
      onconfirm: () => act(user.id, (api) => api.block(user.id)),
    })
  }

  let menu = $state<{ user: User; anchor: HTMLElement } | null>(null)

  function toggleMenu(user: User, anchor: HTMLElement) {
    menu = menu?.user.id === user.id ? null : { user, anchor }
  }

  function menuItems(user: User, anchor: HTMLElement): MenuItem[] {
    return [
      { label: 'Perfil', icon: 'user', onselect: () => openProfile(user.id, null, anchor) },
      { label: 'Desfazer amizade', icon: 'user-x', onselect: () => unfriend(user) },
      { kind: 'separator' },
      { label: 'Bloquear', icon: 'ban', danger: true, onselect: () => block(user) },
    ]
  }

  function select(next: Tab) {
    search = ''
    menu = null
    // Abrir o "Adicionar" de novo começa limpo.
    if (next === 'add' && tab !== 'add') {
      added = null
      addError = null
    }
    tab = next
  }

  /** Nome do botão da linha pra leitor de tela: nome, status e o resto, sem repetir. */
  function describe(user: User, sub: string, status: VisibleStatus | null): string {
    const parts = [user.name]
    if (status && STATUS_LABEL[status] !== sub) parts.push(STATUS_LABEL[status])
    return [...parts, sub].join(', ')
  }

  // ---------- Adicionar amigo ----------

  let addName = $state('')
  let addInput = $state<HTMLInputElement>()
  let adding = $state(false)
  let addError = $state<string | null>(null)
  let added = $state<{ username: string; state: Friend['state'] } | null>(null)
  let copied = $state(false)

  $effect(() => {
    if (tab === 'add') addInput?.focus()
  })

  async function sendRequest(event: SubmitEvent) {
    event.preventDefault()
    const api = client.api
    const username = addName.trim().replace(/^@/, '').toLowerCase()
    if (!api || !username || adding) return
    addError = null
    added = null
    if (username === me?.username) {
      addError = 'Esse é o seu nome de usuário.'
      return
    }
    adding = true
    try {
      added = { username, state: await api.friendRequest(username) }
      addName = ''
    } catch (err) {
      addError = (err as Error).message
    } finally {
      adding = false
    }
  }

  async function copyUsername() {
    if (!me) return
    try {
      await navigator.clipboard.writeText(me.username)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      client.toast('Não deu pra copiar.')
    }
  }
</script>

{#snippet who(user: User, sub: string, status: VisibleStatus | null, call = false)}
  <button type="button" class="who" aria-label={describe(user, sub, status)} onclick={(e) => openProfile(user.id, null, e.currentTarget)}>
    <Avatar id={user.id} name={user.name} size={36} src={client.api?.avatar(user) ?? null} {status} cutout="var(--row-bg)" />
    <span class="text">
      <span class="name">{user.name} <span class="username">{user.username}</span></span>
      <span class="sub" class:call>
        {#if call}<Icon name="volume" size={14} />{/if}<span class="truncate">{sub}</span>
      </span>
    </span>
  </button>
{/snippet}

{#snippet friendRow(friend: Friend)}
  {@const user = friend.user}
  {@const presence = client.presenceOf(user.id)}
  {@const channel = inCall.get(user.id)}
  <div class="person" class:open={menu?.user.id === user.id}>
    {@render who(user, channel ? `Na call · ${channel}` : (presence.text ?? STATUS_LABEL[presence.status]), presence.status, !!channel)}
    <IconButton icon="message" label="Mensagem" disabled={busy[user.id]} onclick={() => client.openDm(user.id)} />
    <IconButton icon="ellipsis" label="Mais" disabled={busy[user.id]} onclick={(e) => toggleMenu(user, e.currentTarget)} />
  </div>
{/snippet}

{#snippet label(text: string, total: number)}
  <div class="label">{text} — <span class="tabular">{total}</span></div>
{/snippet}

{#snippet searchField(placeholder: string)}
  <TextField icon="search" {placeholder} aria-label={placeholder} bind:value={search} spellcheck={false} class="search" />
{/snippet}

{#snippet noMatch()}
  <p class="no-match">Ninguém com esse nome.</p>
{/snippet}

<div class="page">
  <section class="main">
    <header>
      <Icon name="users" size={20} class="header-icon" />
      <h1>Amigos</h1>
      <span class="divider" aria-hidden="true"></span>
      <Tabs
        label="Amigos"
        class="friend-tabs"
        value={tab}
        onchange={select}
        tabs={[
          { value: 'online', label: 'Online' },
          { value: 'all', label: 'Todos' },
          { value: 'pending', label: 'Pendentes', count: incoming.length, alert: true },
          { value: 'blocked', label: 'Bloqueados' },
        ]}
      />
      <div class="spacer"></div>
      <Button size="sm" variant={tab === 'add' ? 'secondary' : 'primary'} icon="user-plus" onclick={() => select('add')}>Adicionar amigo</Button>
    </header>

    <div class="content">
      {#if !home?.loaded}
        <div class="loading" role="status" aria-label="Carregando"><Spinner size={20} /></div>
      {:else if tab === 'add'}
        <div class="add">
          <h2>Adicionar amigo</h2>
          <p class="add-lead">Pelo nome de usuário. A pessoa recebe o pedido e aceita.</p>
          <form class="add-form" onsubmit={sendRequest}>
            <TextField
              size="lg"
              icon="at"
              placeholder="nome.de.usuario"
              aria-label="Nome de usuário"
              spellcheck={false}
              autocomplete="off"
              maxlength={64}
              bind:value={addName}
              bind:input={addInput}
              error={addError}
              oninput={() => (addError = null)}
            />
            <Button variant="primary" size="lg" type="submit" loading={adding} disabled={!addName.trim()}>Mandar pedido</Button>
          </form>
          {#if added}
            <p class="add-ok" role="status">
              <Icon name="circle-check" size={16} />
              {#if added.state === 'friends'}
                <span>Agora você e <b>{added.username}</b> são amigos.</span>
              {:else}
                <span>Pedido enviado pra <b>{added.username}</b>.</span>
              {/if}
            </p>
          {/if}
          {#if me}
            <div class="share">
              <span>Seu nome de usuário</span>
              <code class="selectable">{me.username}</code>
              <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copiado' : 'Copiar'} size="sm" onclick={copyUsername} />
            </div>
          {/if}
        </div>
      {:else if tab === 'pending'}
        {#if incoming.length || outgoing.length}
          {@render searchField('Buscar pedidos')}
          {@const inc = incoming.filter((f) => matches(f.user))}
          {@const out = outgoing.filter((f) => matches(f.user))}
          {#if inc.length}
            {@render label('Recebidos', inc.length)}
            {#each inc as friend (friend.user.id)}
              <div class="person">
                {@render who(friend.user, `${friend.user.username} · quer ser seu amigo`, null)}
                <IconButton
                  icon="check"
                  label="Aceitar"
                  variant="subtle"
                  tone="success"
                  active
                  disabled={busy[friend.user.id]}
                  onclick={() => act(friend.user.id, (api) => api.friendAccept(friend.user.id))}
                />
                <IconButton
                  icon="x"
                  label="Recusar"
                  variant="subtle"
                  disabled={busy[friend.user.id]}
                  onclick={() => act(friend.user.id, (api) => api.friendRemove(friend.user.id))}
                />
              </div>
            {/each}
          {/if}
          {#if out.length}
            {@render label('Enviados', out.length)}
            {#each out as friend (friend.user.id)}
              <div class="person">
                {@render who(friend.user, `${friend.user.username} · aguardando`, null)}
                <IconButton
                  icon="x"
                  label="Cancelar pedido"
                  variant="subtle"
                  disabled={busy[friend.user.id]}
                  onclick={() => act(friend.user.id, (api) => api.friendRemove(friend.user.id))}
                />
              </div>
            {/each}
          {/if}
          {#if !inc.length && !out.length}{@render noMatch()}{/if}
        {:else}
          <EmptyState icon="inbox" title="Nenhum pedido" description="Os pedidos que você recebe e manda aparecem aqui." class="empty" />
        {/if}
      {:else if tab === 'blocked'}
        {#if blocked.length}
          {@render searchField('Buscar bloqueados')}
          {@const list = blocked.filter(matches)}
          {@render label('Bloqueados', list.length)}
          {#each list as user (user.id)}
            <div class="person">
              {@render who(user, user.username, null)}
              <Button size="sm" loading={busy[user.id]} onclick={() => act(user.id, (api) => api.unblock(user.id))}>Desbloquear</Button>
            </div>
          {:else}
            {@render noMatch()}
          {/each}
        {:else}
          <EmptyState icon="ban" title="Ninguém bloqueado" description="Quem você bloquear aparece aqui." class="empty" />
        {/if}
      {:else if !accepted.length}
        <EmptyState icon="users" title="Nenhum amigo ainda" description="Mande um pedido pelo nome de usuário." class="empty" />
      {:else if tab === 'online' && !online.length}
        <EmptyState icon="moon" title="Ninguém online agora" description="Seus amigos aparecem aqui quando entrarem." class="empty" />
      {:else}
        {@render searchField('Buscar amigos')}
        {@const list = (tab === 'online' ? online : accepted).filter((f) => matches(f.user))}
        {@render label(tab === 'online' ? 'Online' : 'Todos', list.length)}
        {#each list as friend (friend.user.id)}
          {@render friendRow(friend)}
        {:else}
          {@render noMatch()}
        {/each}
      {/if}
    </div>
  </section>

  <aside class="now" aria-labelledby="{uid}-now">
    <h2 id="{uid}-now">Agora</h2>
    {#each calls as call (`${call.guild.id}:${call.channelId}`)}
      {@const mine = inMyCall(call)}
      <div class="now-card">
        <div class="now-head">
          <span class="now-server">
            <Avatar
              id={call.guild.id}
              name={call.guild.info.name}
              size={20}
              square
              src={client.api?.media(call.guild.info.icon) ?? null}
              cutout="var(--bg-raised)"
            />
            <span class="truncate">{call.guild.info.name}</span>
          </span>
          <span class="now-channel"><Icon name="volume" size={14} /><span class="truncate">{call.name}</span></span>
        </div>
        <div class="now-people">
          {#each call.people.slice(0, 5) as id (id)}
            <Avatar {id} name={call.guild.displayName(id)} size={28} src={client.avatarOf(id, call.guild.id)} cutout="var(--bg-raised)" />
          {/each}
          {#if call.people.length > 5}<span class="now-more tabular">+{call.people.length - 5}</span>{/if}
          <span class="now-names">{names(call, call.people)}</span>
        </div>
        {#if call.sharing.length}
          <span class="now-live">
            <Badge tone="live">AO VIVO</Badge>
            <span class="truncate">{names(call, call.sharing)}</span>
          </span>
        {/if}
        {#if mine}
          <Button size="sm" full icon="audio-lines" onclick={() => client.openChannel(call.guild.id, call.channelId)}>Ver call</Button>
        {:else}
          <Button
            size="sm"
            full
            icon="phone"
            disabled={!call.guild.can(call.channelId, P.CONNECT)}
            onclick={() => client.joinVoice(call.guild.id, call.channelId)}>Entrar</Button
          >
        {/if}
      </div>
    {:else}
      <EmptyState icon="headphones" title="Tudo quieto" description="Quando um amigo entrar numa call, aparece aqui." class="now-empty" />
    {/each}
  </aside>
</div>

{#if menu}
  <Menu items={menuItems(menu.user, menu.anchor)} anchor={menu.anchor} placement="bottom-end" label="Mais" onclose={() => (menu = null)} />
{/if}

<style>
  .page {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    height: 100%;
  }

  /* Painel estreito: a coluna "Agora" sai. */
  @container panel (max-width: 820px) {
    .page {
      grid-template-columns: minmax(0, 1fr);
    }

    .page .now {
      display: none;
    }
  }

  /* Janela mínima: o título sai da vista (o ícone fica) pra caber as abas e o botão. */
  @container panel (max-width: 680px) {
    header h1 {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    header .divider {
      display: none;
    }
  }

  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    height: var(--header-h);
    padding: 0 12px 0 20px;
    border-bottom: 1px solid var(--line);
  }

  header :global(.header-icon) {
    color: var(--fg-3);
  }

  h1 {
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .divider {
    flex: none;
    width: 1px;
    height: 18px;
    background: var(--line-strong);
  }

  /* As abas encolhem (e rolam) antes de empurrar o botão. */
  header :global(.friend-tabs) {
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .spacer {
    flex: 1;
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .loading {
    display: grid;
    place-items: center;
    height: 160px;
    color: var(--fg-3);
    animation: rs-fade-in var(--t) var(--ease) 300ms both;
  }

  .content :global(.search) {
    margin-bottom: 18px;
  }

  .label {
    margin: 0 0 6px;
    padding: 0 8px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .person + .label {
    margin-top: 18px;
  }

  .person {
    --row-bg: var(--bg-panel);
    display: flex;
    align-items: center;
    gap: 8px;
    height: 60px;
    padding: 0 8px;
    border-top: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--row-bg);
  }

  /* Fundo opaco no hover: o recorte do status no avatar acompanha. */
  .person:hover,
  .person:focus-within,
  .person.open {
    --row-bg: color-mix(in srgb, var(--bg-panel), var(--fg) 5%);
    border-top-color: transparent;
  }

  .person:hover + .person,
  .person:focus-within + .person,
  .person.open + .person {
    border-top-color: transparent;
  }

  .person:is(:hover, :focus-within, .open) :global(.icon-btn:not(.active)) {
    background: rgb(255 255 255 / 0.06);
    color: var(--fg);
  }

  .who {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    height: 100%;
    margin-right: 4px;
    text-align: left;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.35;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .username {
    margin-left: 4px;
    color: var(--fg-3);
    font-weight: 400;
    font-size: var(--text-sm);
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  .person:is(:hover, :focus-within, .open) .username {
    opacity: 1;
  }

  .sub {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .sub.call {
    color: var(--green);
  }

  .no-match {
    padding: 12px 8px;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .content :global(.empty) {
    margin-top: 72px;
  }

  /* ---------- Adicionar ---------- */

  .add {
    max-width: 560px;
  }

  .add h2 {
    font-size: var(--text-xl);
    font-weight: 650;
  }

  .add-lead {
    margin-top: 4px;
    color: var(--fg-2);
  }

  .add-form {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 16px;
  }

  .add-form :global(.field) {
    flex: 1;
  }

  .add-ok {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    color: var(--green);
    font-size: var(--text-sm);
  }

  .share {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 28px;
    padding: 12px 14px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.035);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .share span {
    flex: 1;
  }

  .share code {
    font: 500 14px var(--mono);
    color: var(--fg);
  }

  /* ---------- Agora ---------- */

  .now {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    padding: 16px;
    border-left: 1px solid var(--line);
    overflow-y: auto;
  }

  .now h2 {
    font-size: var(--text-md);
    font-weight: 600;
  }

  .now-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight);
  }

  .now-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .now-server {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-weight: 600;
    font-size: var(--text-sm);
  }

  .now-channel {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .now-people {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .now-people :global(.avatar + .avatar) {
    margin-left: -8px;
  }

  .now-people :global(.avatar) {
    box-shadow: 0 0 0 2px var(--bg-raised);
  }

  .now-more {
    margin-left: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .now-names {
    flex: 1;
    min-width: 0;
    margin-left: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
    font-size: var(--text-xs);
  }

  .now-live {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--fg-2);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .now :global(.now-empty) {
    margin-top: 40px;
    padding: 0 8px;
  }

  .now :global(.now-empty h2) {
    font-size: var(--text-md);
  }

  .now :global(.now-empty p) {
    font-size: var(--text-sm);
  }
</style>
