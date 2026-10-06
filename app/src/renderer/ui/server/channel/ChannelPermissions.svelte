<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import { channelPermissions, sameOverwrites } from '../../../../../../shared/permissions'
  import { P, has, type Channel, type Overwrite, type Role } from '../../../../../../shared/protocol'
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { confirmAction } from '../../../lib/ui.svelte'
  import { Avatar, Button, Icon, IconButton, PageHeader, Popover, Row, Section, Switch, TextField } from '../../kit'
  import { channelPermissionGroups, hex, isAdmin, permContext, sameRules, triOf, withTri, type TriValue } from '../permissions'
  import SaveBar from '../SaveBar.svelte'
  import { settled } from '../settle.svelte'
  import TriState from '../TriState.svelte'
  import type { Unsaved } from '../unsaved.svelte'
  import { fold } from '../util'

  let { guild, channel, unsaved }: { guild: GuildState; channel: Channel; unsaved: Unsaved } = $props()

  type Target = { type: 'role' | 'member'; id: string }

  const groups = $derived(channelPermissionGroups(channel.kind))
  const admin = $derived(isAdmin(guild, guild.meId))
  const mine = $derived(guild.guildPermissions)
  /** Quem não é administrador só mexe nas permissões que tem. */
  const canChange = (bit: number) => admin || (mine & bit) === bit

  // ---------- Rascunho das exceções ----------

  let draft = $state<Overwrite[] | null>(null)
  const rules = $derived(draft ?? channel.overwrites)
  const changed = $derived(!!draft && !sameRules(draft, channel.overwrites))
  let saving = $state(false)

  $effect(() => {
    unsaved.dirty = changed
  })
  onDestroy(() => (unsaved.dirty = false))

  const empty = (target: Target): Overwrite => ({ ...target, allow: 0, deny: 0 })
  const find = (list: Overwrite[], target: Target) => list.find((o) => o.type === target.type && o.id === target.id)

  /** Troca (ou cria) a exceção de alguém no rascunho. */
  function put(list: Overwrite[], target: Target, change: (o: Overwrite) => Overwrite): Overwrite[] {
    const current = find(list, target)
    const next = change(current ? { ...current } : empty(target))
    return current ? list.map((o) => (o === current ? next : o)) : [...list, next]
  }

  const everyone = $derived<Target>({ type: 'role', id: guild.id })
  /** Id vazio = @everyone. */
  let selected = $state<Target>({ type: 'role', id: '' })
  const target = $derived<Target>(selected.id ? selected : everyone)
  const current = $derived(find(rules, target) ?? empty(target))

  // A exceção aberta sumiu (desfez, ou salvou vazia): volta pro @everyone.
  $effect(() => {
    if (selected.id && !find(rules, selected)) selected = { type: 'role', id: '' }
  })

  function setBit(bit: number, value: TriValue) {
    draft = put(rules.map((o) => ({ ...o })), target, (o) => withTri(o, bit, value))
  }

  // ---------- Canal privado ----------

  const isPrivate = $derived(triOf(find(rules, everyone), P.VIEW_CHANNEL) === 'deny')

  /** Com essas exceções, eu continuo vendo e editando o canal? */
  function keepsAccess(list: Overwrite[]): boolean {
    const me = guild.me
    if (admin || !me) return true
    const perms = channelPermissions(permContext(guild), me, { ...channel, overwrites: list })
    return has(perms, P.VIEW_CHANNEL) && has(perms, P.MANAGE_CHANNELS)
  }

  function setPrivate(on: boolean) {
    let list = put(rules.map((o) => ({ ...o })), everyone, (o) => withTri(o, P.VIEW_CHANNEL, on ? 'deny' : 'neutral'))
    // Não deixa a pessoa se trancar pra fora: ela mesma ganha a exceção de ver.
    if (on && !keepsAccess(list)) list = put(list, { type: 'member', id: guild.meId }, (o) => withTri(o, P.VIEW_CHANNEL, 'allow'))
    draft = list
  }

  // ---------- Quem tem exceção ----------

  const roleRules = $derived(
    rules
      .filter((o) => o.type === 'role' && o.id !== guild.id)
      .map((o) => guild.roles.find((r) => r.id === o.id))
      .filter((r): r is Role => !!r)
      .sort((a, b) => b.position - a.position),
  )
  const memberRules = $derived(
    rules
      .filter((o) => o.type === 'member' && guild.members[o.id])
      .map((o) => o.id)
      .sort((a, b) => guild.displayName(a).localeCompare(guild.displayName(b), 'pt-BR')),
  )

  const isSelected = (t: Target) => target.type === t.type && target.id === t.id

  function remove(t: Target) {
    draft = rules.filter((o) => !(o.type === t.type && o.id === t.id)).map((o) => ({ ...o }))
    selected = { type: 'role', id: '' }
  }

  // ---------- Adicionar cargo ou pessoa ----------

  let adding = $state<HTMLElement | null>(null)
  let pick = $state('')
  let pickInput = $state<HTMLInputElement>()

  const roleOptions = $derived.by(() => {
    const q = fold(pick.trim())
    return guild.roles
      .filter((r) => r.id !== guild.id && !find(rules, { type: 'role', id: r.id }) && (!q || fold(r.name).includes(q)))
      .sort((a, b) => b.position - a.position)
  })
  const memberOptions = $derived.by(() => {
    const q = fold(pick.trim())
    return Object.keys(guild.members)
      .filter((id) => !find(rules, { type: 'member', id }))
      .filter((id) => !q || fold(guild.displayName(id)).includes(q) || fold(guild.users[id]?.username ?? '').includes(q))
      .sort((a, b) => guild.displayName(a).localeCompare(guild.displayName(b), 'pt-BR'))
      .slice(0, 40)
  })

  async function openPicker(event: MouseEvent) {
    adding = adding ? null : (event.currentTarget as HTMLElement)
    pick = ''
    await tick()
    pickInput?.focus()
  }

  function add(t: Target) {
    draft = put(rules.map((o) => ({ ...o })), t, (o) => o)
    selected = t
    adding = null
  }

  // ---------- Sincronia com a categoria ----------

  const parent = $derived(channel.kind !== 'category' && channel.parentId ? guild.channel(channel.parentId) : null)
  const synced = $derived(!!parent && sameOverwrites(channel.overwrites, parent.overwrites))
  let syncing = $state(false)

  async function sync() {
    if (!parent || syncing || unsaved.blocked()) return
    syncing = true
    const id = channel.id
    const from = parent.id
    guild.updateChannel(id, { syncWithCategory: true })
    const ok = await settled(() => {
      const now = guild.channel(id)
      const category = guild.channel(from)
      return !now || (!!category && sameOverwrites(now.overwrites, category.overwrites))
    })
    syncing = false
    if (ok) draft = null
  }

  // ---------- Salvar ----------

  async function commit(list: Overwrite[]) {
    saving = true
    const id = channel.id
    // Exceção vazia não muda nada (e atrapalharia a sincronia com a categoria).
    const clean = list.filter((o) => o.allow || o.deny).map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }))
    guild.updateChannel(id, { overwrites: clean })
    const ok = await settled(() => {
      const now = guild.channel(id)
      return !now || sameRules(now.overwrites, clean)
    })
    saving = false
    if (ok) draft = null
  }

  function save() {
    if (!draft || saving) return
    const list = draft
    if (keepsAccess(list)) return void commit(list)
    confirmAction({
      title: 'Você vai perder acesso',
      description: 'Com essas permissões, você deixa de ver ou de editar este canal.',
      confirm: 'Salvar mesmo assim',
      onconfirm: () => commit(list),
    })
  }
</script>

<PageHeader title="Permissões" description="Exceções deste canal, por cima do que os cargos dão." />

{#if parent}
  <div class="sync" class:synced>
    <Icon name={synced ? 'check' : 'info'} size={16} />
    <span>
      {#if synced}
        Igual às permissões de <b>{parent.name}</b>. Mudar aqui separa o canal da categoria.
      {:else}
        Diferente das permissões de <b>{parent.name}</b>.
      {/if}
    </span>
    {#if !synced}
      <Button size="sm" icon="restart" loading={syncing} onclick={sync}>Sincronizar</Button>
    {/if}
  </div>
{:else if channel.kind === 'category'}
  <div class="sync synced">
    <Icon name="info" size={16} />
    <span>Os canais com as mesmas permissões da categoria acompanham o que mudar aqui.</span>
  </div>
{/if}

<Section>
  <Row
    label={channel.kind === 'category' ? 'Categoria privada' : 'Canal privado'}
    description="Só os cargos e as pessoas liberados aqui veem."
    for="channel-private"
  >
    <Switch id="channel-private" checked={isPrivate} disabled={!canChange(P.VIEW_CHANNEL)} onchange={(e) => setPrivate(e.currentTarget.checked)} />
  </Row>
</Section>

<div class="perms">
  <div class="targets">
    <div class="targets-head">
      <span>Cargos e pessoas</span>
      <IconButton icon="plus" label="Adicionar cargo ou pessoa" size="sm" active={!!adding} onclick={openPicker} />
    </div>
    <div class="target-list" role="listbox" aria-label="Cargos e pessoas com exceção">
      {#each roleRules as role (role.id)}
        <button
          type="button"
          class="target"
          class:on={isSelected({ type: 'role', id: role.id })}
          role="option"
          aria-selected={isSelected({ type: 'role', id: role.id })}
          onclick={() => (selected = { type: 'role', id: role.id })}
        >
          <span class="dot" style:background={hex(role.color) ?? 'var(--fg-3)'}></span>
          <span class="target-name">{role.name}</span>
        </button>
      {/each}
      {#each memberRules as userId (userId)}
        <button
          type="button"
          class="target"
          class:on={isSelected({ type: 'member', id: userId })}
          role="option"
          aria-selected={isSelected({ type: 'member', id: userId })}
          onclick={() => (selected = { type: 'member', id: userId })}
        >
          <Avatar id={userId} name={guild.displayName(userId)} size={20} src={client.avatarOf(userId, guild.id)} cutout="var(--bg-canvas)" />
          <span class="target-name">{guild.displayName(userId)}</span>
        </button>
      {/each}
      {#if roleRules.length || memberRules.length}<div class="sep" role="separator"></div>{/if}
      <button
        type="button"
        class="target"
        class:on={isSelected(everyone)}
        role="option"
        aria-selected={isSelected(everyone)}
        onclick={() => (selected = { type: 'role', id: '' })}
      >
        <span class="dot everyone"></span>
        <span class="target-name">@everyone</span>
      </button>
    </div>
  </div>

  <div class="editor">
    <div class="editor-head">
      {#if target.type === 'member'}
        <Avatar id={target.id} name={guild.displayName(target.id)} size={24} src={client.avatarOf(target.id, guild.id)} cutout="var(--bg-canvas)" />
        <h3>{guild.displayName(target.id)}</h3>
      {:else}
        {@const role = guild.roles.find((r) => r.id === target.id)}
        <span class="dot big" class:everyone={target.id === guild.id} style:background={target.id === guild.id ? null : (hex(role?.color) ?? 'var(--fg-3)')}></span>
        <h3>{target.id === guild.id ? '@everyone' : (role?.name ?? 'Cargo')}</h3>
      {/if}
      <span class="grow"></span>
      {#if target.id !== guild.id}
        <Button size="sm" variant="ghost" icon="trash" onclick={() => remove(target)}>Tirar exceção</Button>
      {/if}
    </div>

    {#each groups as group (group.title)}
      <Section title={group.title}>
        {#each group.items as item (item.bit)}
          <Row label={item.label} description={item.hint}>
            <TriState value={triOf(current, item.bit)} label={item.label} disabled={!canChange(item.bit)} onchange={(v) => setBit(item.bit, v)} />
          </Row>
        {/each}
      </Section>
    {/each}
  </div>
</div>

{#if changed}
  <SaveBar {saving} nudge={unsaved.nudge} onreset={() => (draft = null)} onsave={save} />
{/if}

{#if adding}
  <Popover anchor={adding} placement="bottom-start" width={260} label="Adicionar cargo ou pessoa" onclose={() => (adding = null)}>
    <div class="picker">
      <TextField icon="search" placeholder="Buscar cargo ou pessoa" aria-label="Buscar cargo ou pessoa" bind:value={pick} bind:input={pickInput} spellcheck={false} />
      <div class="picker-list">
        {#if roleOptions.length}<p class="picker-label">Cargos</p>{/if}
        {#each roleOptions as role (role.id)}
          <button type="button" onclick={() => add({ type: 'role', id: role.id })}>
            <span class="dot" style:background={hex(role.color) ?? 'var(--fg-3)'}></span>
            <span class="target-name">{role.name}</span>
          </button>
        {/each}
        {#if memberOptions.length}<p class="picker-label">Pessoas</p>{/if}
        {#each memberOptions as userId (userId)}
          <button type="button" onclick={() => add({ type: 'member', id: userId })}>
            <Avatar id={userId} name={guild.displayName(userId)} size={20} src={client.avatarOf(userId, guild.id)} cutout="var(--bg-raised)" />
            <span class="target-name">{guild.displayName(userId)}</span>
          </button>
        {/each}
        {#if !roleOptions.length && !memberOptions.length}
          <p class="picker-empty">Nada encontrado.</p>
        {/if}
      </div>
    </div>
  </Popover>
{/if}

<style>
  .sync {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-bottom: var(--s-4);
    padding: 8px 8px 8px 12px;
    min-height: 44px;
    border-radius: var(--r-lg);
    background: var(--yellow-soft);
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .sync > :global(svg) {
    color: var(--yellow);
  }

  .sync.synced {
    background: rgb(255 255 255 / 0.04);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-2);
  }

  .sync.synced > :global(svg) {
    color: var(--fg-3);
  }

  .sync span {
    flex: 1;
    min-width: 0;
  }

  .sync b {
    color: var(--fg);
    font-weight: 600;
  }

  .perms {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: var(--s-5);
    align-items: start;
    margin-top: var(--s-8);
  }

  .targets {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .targets-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-left: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .target-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .target,
  .picker-list button {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    height: var(--h-md);
    padding: 0 10px;
    border-radius: var(--r-md);
    color: var(--fg-2);
    font-size: var(--text-sm);
    text-align: left;
    transition: background-color var(--t-fast) var(--ease);
  }

  .target:hover,
  .picker-list button:hover {
    background: var(--hover);
  }

  .target.on {
    background: var(--selected);
    color: var(--fg);
  }

  .target-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    margin: 0 5px;
    border-radius: 50%;
  }

  .dot.big {
    width: 12px;
    height: 12px;
    margin: 0 6px;
  }

  .dot.everyone {
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--fg-3);
  }

  .sep {
    height: 1px;
    margin: 6px 4px;
    background: var(--line);
  }

  .editor {
    min-width: 0;
  }

  .editor-head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 28px;
    margin-bottom: var(--s-4);
  }

  .editor-head h3 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .grow {
    flex: 1;
  }

  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
  }

  .picker-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 280px;
    overflow-y: auto;
  }

  .picker-label {
    padding: 8px 10px 4px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .picker-empty {
    padding: 12px 10px;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }
</style>
