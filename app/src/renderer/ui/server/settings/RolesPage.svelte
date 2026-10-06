<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import { P, type Role } from '../../../../../../shared/protocol'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { confirmAction } from '../../../lib/ui.svelte'
  import { Button, Icon, PageHeader, Row, Section, Switch, TextField, tooltip } from '../../kit'
  import { ROLE_PERMISSIONS, ROLE_SWATCHES, colorValue, grantable, hex, isAdmin, myTop } from '../permissions'
  import SaveBar from '../SaveBar.svelte'
  import { settled } from '../settle.svelte'
  import type { Unsaved } from '../unsaved.svelte'
  import { cleanName, plural } from '../util'

  let { guild, unsaved }: { guild: GuildState; unsaved: Unsaved } = $props()

  interface Draft {
    name: string
    color: number | null
    hoist: boolean
    mentionable: boolean
    permissions: number
  }

  const everyone = $derived(guild.roles.find((r) => r.id === guild.id) ?? null)
  const sorted = $derived(guild.roles.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position))
  const owner = $derived(guild.isOwner)
  const top = $derived(myTop(guild))
  /** Cargos no meu nível ou acima ficam onde estão (o dono mexe em todos). */
  const locked = $derived(owner ? 0 : sorted.filter((r) => r.position >= top).length)
  const admin = $derived(isAdmin(guild, guild.meId))
  const grant = $derived(grantable(guild))

  const editable = (r: Role) => r.id === guild.id || owner || r.position < top

  // Ordem nova enquanto o servidor não confirma (o item arrastado não "volta" por um instante).
  let pendingOrder = $state<string[] | null>(null)
  const ordered = $derived.by(() => {
    if (!pendingOrder) return sorted
    const byId = new Map(sorted.map((r) => [r.id, r]))
    const list = pendingOrder.map((id) => byId.get(id)).filter((r): r is Role => !!r)
    return list.length === sorted.length ? list : sorted
  })

  const counts = $derived.by(() => {
    const map = new Map<string, number>()
    for (const m of Object.values(guild.members)) for (const id of m.roles) map.set(id, (map.get(id) ?? 0) + 1)
    return map
  })
  const total = $derived(Object.keys(guild.members).length)

  // ---------- Cargo aberto e rascunho ----------

  let selectedId = $state(untrack(() => (sorted.find(editable) ?? everyone)?.id ?? guild.id))
  const role = $derived(guild.roles.find((r) => r.id === selectedId) ?? null)
  const isEveryone = $derived(role?.id === guild.id)
  const readOnly = $derived(!role || !editable(role))

  let draft = $state<Draft | null>(null)

  // Apagaram o cargo aberto (aqui ou em outro lugar): abre outro.
  $effect(() => {
    if (role || !guild.roles.length) return
    selectedId = (sorted.find(editable) ?? everyone)?.id ?? guild.id
    draft = null
  })

  const base = $derived<Draft | null>(
    role ? { name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions } : null,
  )
  const view = $derived(draft ?? base)
  const changed = $derived(
    !!draft &&
      !!base &&
      (cleanName(draft.name) !== base.name ||
        draft.color !== base.color ||
        draft.hoist !== base.hoist ||
        draft.mentionable !== base.mentionable ||
        draft.permissions !== base.permissions),
  )
  const nameError = $derived(draft && !isEveryone && !cleanName(draft.name) ? 'Dê um nome pro cargo.' : null)
  let saving = $state(false)

  $effect(() => {
    unsaved.dirty = changed
  })
  onDestroy(() => (unsaved.dirty = false))

  function edit(patch: Partial<Draft>) {
    if (!view || readOnly) return
    draft = { ...view, ...patch }
  }

  function setPermission(bit: number, on: boolean) {
    if (view) edit({ permissions: on ? view.permissions | bit : view.permissions & ~bit })
  }

  /** Quem não é administrador só dá o que tem (e tirar, pode sempre). Administrador só administrador dá. */
  function canToggle(bit: number): boolean {
    if (readOnly || !role) return false
    if (role.permissions & bit) return true
    if (bit === P.ADMINISTRATOR) return admin
    return (grant & bit) === bit
  }

  function select(id: string) {
    if (id === selectedId || unsaved.blocked()) return
    selectedId = id
    draft = null
  }

  async function save() {
    if (!role || !draft || !base || nameError || saving) return
    const id = role.id
    const patch: { name?: string; color?: number | null; hoist?: boolean; mentionable?: boolean; permissions?: number } = {}
    if (!isEveryone) {
      const name = cleanName(draft.name)
      if (name !== base.name) patch.name = name
      if (draft.color !== base.color) patch.color = draft.color
      if (draft.hoist !== base.hoist) patch.hoist = draft.hoist
      if (draft.mentionable !== base.mentionable) patch.mentionable = draft.mentionable
    }
    if (draft.permissions !== base.permissions) patch.permissions = draft.permissions
    if (Object.keys(patch).length === 0) {
      draft = null
      return
    }
    saving = true
    guild.updateRole(id, patch)
    const ok = await settled(() => {
      const now = guild.roles.find((r) => r.id === id)
      return !!now && (Object.keys(patch) as (keyof typeof patch)[]).every((key) => now[key] === patch[key])
    })
    saving = false
    if (ok) draft = null
  }

  // ---------- Criar e apagar ----------

  let creating = $state(false)
  let nameInput = $state<HTMLInputElement>()

  async function create() {
    if (creating || unsaved.blocked()) return
    creating = true
    const before = new Set(guild.roles.map((r) => r.id))
    guild.createRole('Novo cargo')
    const ok = await settled(() => guild.roles.some((r) => !before.has(r.id)))
    creating = false
    const fresh = guild.roles.find((r) => !before.has(r.id))
    if (!ok || !fresh) return
    selectedId = fresh.id
    draft = null
    await tick()
    nameInput?.focus()
    nameInput?.select()
  }

  function remove() {
    if (!role || isEveryone || readOnly) return
    const { id, name } = role
    const count = counts.get(id) ?? 0
    confirmAction({
      title: `Apagar o cargo ${name}?`,
      description: count ? `${plural(count, 'pessoa perde', 'pessoas perdem')} o que ele dá.` : 'Ninguém tem esse cargo agora.',
      confirm: 'Apagar',
      onconfirm: () => {
        draft = null
        guild.deleteRole(id)
      },
    })
  }

  // ---------- Ordem (arrastar, ou Alt + ↑/↓) ----------

  let list = $state<HTMLDivElement>()
  let dragging = $state<string | null>(null)
  /** Onde o cargo arrastado entra (índice de inserção na lista). */
  let dropAt = $state<number | null>(null)

  async function move(id: string, at: number) {
    const ids = ordered.map((r) => r.id)
    const from = ids.indexOf(id)
    if (from < 0) return
    const to = at > from ? at - 1 : at
    if (to === from || to < locked || to >= ids.length) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    pendingOrder = ids
    guild.reorderRoles(ids)
    await tick()
    list?.querySelector<HTMLElement>(`[data-role="${id}"]`)?.focus()
    await settled(() => sorted.map((r) => r.id).join() === ids.join())
    pendingOrder = null
  }

  function ondragstart(event: DragEvent, r: Role) {
    if (!editable(r)) return event.preventDefault()
    dragging = r.id
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', r.id)
    }
  }

  function ondragover(event: DragEvent, index: number) {
    if (!dragging) return
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const at = event.clientY < box.top + box.height / 2 ? index : index + 1
    if (at < locked) {
      dropAt = null
      return
    }
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropAt = at
  }

  function ondrop(event: DragEvent) {
    event.preventDefault()
    if (dragging && dropAt !== null) move(dragging, dropAt)
    ondragend()
  }

  function ondragend() {
    dragging = null
    dropAt = null
  }

  function onkeydown(event: KeyboardEvent, r: Role, index: number) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    // Sem isso o Alt + ↑/↓ da janela (trocar de canal) também roda.
    event.preventDefault()
    event.stopPropagation()
    if (editable(r)) move(r.id, event.key === 'ArrowUp' ? index - 1 : index + 2)
  }

  const canReorder = $derived(ordered.length - locked > 1)
</script>

{#snippet warning()}
  <span class="warn"><Icon name="triangle-alert" size={18} /></span>
{/snippet}

<PageHeader title="Cargos" description="Quem pode o quê. Cargos mais altos mandam nos de baixo.">
  {#snippet actions()}
    <Button variant="primary" icon="plus" size="sm" loading={creating} onclick={create}>Criar cargo</Button>
  {/snippet}
</PageHeader>

<div class="roles">
  <div class="role-list" role="listbox" aria-label="Cargos" bind:this={list}>
    {#each ordered as r, i (r.id)}
      {@const shown = r.id === role?.id && draft ? draft : r}
      {@const canMove = editable(r)}
      <button
        type="button"
        class="role-item"
        class:on={r.id === role?.id}
        class:dragging={dragging === r.id}
        class:drop-above={dropAt === i}
        class:drop-below={dropAt === ordered.length && i === ordered.length - 1}
        role="option"
        aria-selected={r.id === role?.id}
        data-role={r.id}
        draggable={canMove}
        onclick={() => select(r.id)}
        ondragstart={(e) => ondragstart(e, r)}
        ondragover={(e) => ondragover(e, i)}
        ondrop={ondrop}
        ondragend={ondragend}
        onkeydown={(e) => onkeydown(e, r, i)}
      >
        <span class="grip" use:tooltip={canMove ? null : { text: 'Só quem está acima mexe nesse cargo', placement: 'right' }}>
          <Icon name={canMove ? 'grip' : 'lock'} size={14} />
        </span>
        <span class="role-dot" style:background={hex(shown.color) ?? 'var(--fg-3)'}></span>
        <span class="role-name">{cleanName(shown.name) || 'Sem nome'}</span>
        <span class="role-count tabular" use:tooltip={plural(counts.get(r.id) ?? 0, 'pessoa', 'pessoas')}>{counts.get(r.id) ?? 0}</span>
      </button>
    {/each}
    {#if ordered.length}<div class="role-sep" role="separator"></div>{/if}
    {#if everyone}
      <button
        type="button"
        class="role-item"
        class:on={isEveryone}
        role="option"
        aria-selected={isEveryone}
        data-role={everyone.id}
        onclick={() => select(everyone.id)}
      >
        <span class="grip"></span>
        <span class="role-dot everyone"></span>
        <span class="role-name">@everyone</span>
        <span class="role-count tabular" use:tooltip={plural(total, 'pessoa', 'pessoas')}>{total}</span>
      </button>
    {/if}
    {#if canReorder}<p class="role-tip">Arraste pra mudar a ordem.</p>{/if}
  </div>

  <div class="role-editor">
    {#if role && view}
      {#if readOnly}
        <p class="notice"><Icon name="lock" size={16} />Esse cargo está no seu nível ou acima. Só quem está mais alto mexe nele.</p>
      {/if}

      {#if isEveryone}
        <p class="notice soft"><Icon name="users" size={16} />Vale pra todo mundo do servidor, antes de qualquer cargo.</p>
      {:else}
        <Section>
          <Row label="Nome">
            <div class="w240">
              <TextField
                aria-label="Nome do cargo"
                bind:value={() => view.name, (v) => edit({ name: v })}
                bind:input={nameInput}
                maxlength={100}
                spellcheck={false}
                disabled={readOnly}
                error={nameError}
              />
            </div>
          </Row>
          <Row label="Cor" stack>
            <div class="swatches" role="radiogroup" aria-label="Cor do cargo">
              {#each [...ROLE_SWATCHES, ...(view.color !== null && !ROLE_SWATCHES.includes(hex(view.color)!) ? [hex(view.color)!] : []), null] as color (color)}
                {@const on = hex(view.color) === color}
                <button
                  type="button"
                  class="swatch"
                  class:on
                  class:none={!color}
                  style:background={color}
                  role="radio"
                  aria-checked={on}
                  aria-label={color ?? 'Sem cor'}
                  disabled={readOnly}
                  use:tooltip={color ? null : 'Sem cor'}
                  onclick={() => edit({ color: colorValue(color) })}
                >
                  {#if on}<Icon name="check" size={14} stroke={2.25} />{/if}
                </button>
              {/each}
            </div>
          </Row>
          <Row label="Mostrar separado na lista de membros" for="role-hoist">
            <Switch id="role-hoist" checked={view.hoist} disabled={readOnly} onchange={(e) => edit({ hoist: e.currentTarget.checked })} />
          </Row>
          <Row
            label="Qualquer um pode mencionar"
            for="role-mention"
            description="Com @{cleanName(view.name) || 'cargo'}, todo mundo do cargo é avisado."
          >
            <Switch
              id="role-mention"
              checked={view.mentionable}
              disabled={readOnly}
              onchange={(e) => edit({ mentionable: e.currentTarget.checked })}
            />
          </Row>
        </Section>
      {/if}

      {#each ROLE_PERMISSIONS as group (group.title)}
        <Section title={group.title}>
          {#each group.items as item (item.bit)}
            {@const isAdminBit = item.bit === P.ADMINISTRATOR}
            <Row
              label={item.label}
              description={isAdminBit ? `${item.hint} Dê só pra quem confia muito.` : item.hint}
              for="perm-{item.bit}"
              leading={isAdminBit ? warning : undefined}
            >
              <Switch
                id="perm-{item.bit}"
                checked={(view.permissions & item.bit) !== 0}
                disabled={!canToggle(item.bit)}
                onchange={(e) => setPermission(item.bit, e.currentTarget.checked)}
              />
            </Row>
          {/each}
        </Section>
      {/each}

      {#if !isEveryone && !readOnly}
        <Section>
          <Row label="Apagar o cargo" description="Quem tem o cargo perde o que ele dá.">
            <Button variant="danger-soft" icon="trash" onclick={remove}>Apagar</Button>
          </Row>
        </Section>
      {/if}
    {/if}
  </div>
</div>

{#if changed}
  <SaveBar {saving} nudge={unsaved.nudge} disabled={!!nameError} onreset={() => (draft = null)} onsave={save} />
{/if}

<style>
  .roles {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: var(--s-5);
    align-items: start;
  }

  .role-list {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .role-item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    height: var(--h-md);
    padding: 0 10px 0 4px;
    border-radius: var(--r-md);
    color: var(--fg-2);
    font-size: var(--text-sm);
    text-align: left;
    transition:
      background-color var(--t-fast) var(--ease),
      opacity var(--t-fast) var(--ease);
  }

  .role-item:hover {
    background: var(--hover);
  }

  .role-item.on {
    background: var(--selected);
    color: var(--fg);
  }

  .role-item.dragging {
    opacity: 0.45;
  }

  .role-item.drop-above {
    box-shadow: inset 0 2px 0 var(--accent-fg);
  }

  .role-item.drop-below {
    box-shadow: inset 0 -2px 0 var(--accent-fg);
  }

  .role-item[draggable='true'] {
    cursor: grab;
  }

  .grip {
    display: grid;
    width: 14px;
    color: var(--fg-4);
  }

  .role-dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .role-dot.everyone {
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--fg-3);
  }

  .role-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .role-count {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .role-sep {
    height: 1px;
    margin: 6px 4px;
    background: var(--line);
  }

  .role-tip {
    padding: var(--s-2) 6px;
    color: var(--fg-4);
    font-size: var(--text-xs);
  }

  .role-editor {
    min-width: 0;
  }

  .notice {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    margin-bottom: var(--s-4);
    padding: 10px 12px;
    border-radius: var(--r-lg);
    background: var(--yellow-soft);
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .notice :global(svg) {
    margin-top: 1px;
    color: var(--yellow);
  }

  .notice.soft {
    background: rgb(255 255 255 / 0.04);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-2);
  }

  .notice.soft :global(svg) {
    color: var(--fg-3);
  }

  .w240 {
    width: 240px;
    max-width: 100%;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .swatch {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--r-md);
    color: var(--bg-canvas);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12);
    transition: transform var(--t-fast) var(--ease);
  }

  .swatch:hover:not(:disabled) {
    transform: scale(1.08);
  }

  .swatch:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .swatch.on {
    box-shadow:
      0 0 0 2px var(--bg-raised),
      0 0 0 4px var(--fg);
  }

  .swatch.none {
    background: linear-gradient(135deg, transparent 45%, var(--red) 45%, var(--red) 55%, transparent 55%), rgb(255 255 255 / 0.06);
    color: var(--fg);
  }

  .warn {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-lg);
    background: var(--yellow-soft);
    color: var(--yellow);
  }
</style>
