<script lang="ts">
  import { untrack } from 'svelte'
  import { channelPermissions } from '../../../../../shared/permissions'
  import { P, has, type ChannelKind, type Overwrite } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { m } from '../../lib/i18n.svelte'
  import { ui } from '../../lib/ui.svelte'
  import { Button, Icon, Modal, Switch, TextField, type IconName } from '../kit'
  import { hex, isAdmin, permContext, withTri } from './permissions'
  import { settled } from './settle.svelte'
  import { cleanName } from './util'

  const request = $derived(ui.createChannel)
  const guild = $derived(request ? (client.guilds[request.guildId] ?? null) : null)
  const uid = $props.id()
  const t = $derived(m.server.createChannel)
  const shared = $derived(m.server.shared)

  // O servidor sumiu, ou a pessoa perdeu a permissão: fecha.
  $effect(() => {
    if (request && (!guild || !guild.canGuild(P.MANAGE_CHANNELS))) close()
  })

  const parent = $derived(guild && request?.parentId ? guild.channel(request.parentId) : null)

  let kind = $state<ChannelKind>(untrack(() => request?.kind ?? 'text'))
  let name = $state('')
  let isPrivate = $state(false)
  /** Cargos que veem o canal privado. */
  let allowed = $state<string[]>([])
  let busy = $state(false)

  const KINDS = $derived<{ value: ChannelKind; label: string; hint: string; icon: IconName }[]>([
    { value: 'text', ...t.kinds.text, icon: 'hash' },
    { value: 'voice', ...t.kinds.voice, icon: 'volume' },
    { value: 'category', ...t.kinds.category, icon: 'folder' },
  ])
  // Dentro de uma categoria não cabe outra.
  const kinds = $derived(parent ? KINDS.filter((k) => k.value !== 'category') : KINDS)

  const canPrivate = $derived(!!guild && guild.canGuild(P.MANAGE_ROLES))
  const roles = $derived(guild ? guild.roles.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position) : [])
  const clean = $derived(cleanName(name))
  const title = $derived(kind === 'category' ? t.titleCategory : t.titleChannel)

  function close() {
    ui.createChannel = null
  }

  function toggleRole(id: string, on: boolean) {
    allowed = on ? [...allowed, id] : allowed.filter((r) => r !== id)
  }

  /** Privado: @everyone não vê; os cargos escolhidos veem. Parte das exceções da categoria. */
  function privateRules(parentId: string | null): Overwrite[] {
    if (!guild) return []
    let list: Overwrite[] = (parentId ? (guild.channel(parentId)?.overwrites ?? []) : []).map((o) => ({ ...o }))
    const put = (id: string, type: 'role' | 'member', value: 'allow' | 'deny') => {
      const found = list.find((o) => o.id === id && o.type === type)
      const next = withTri(found ?? { id, type, allow: 0, deny: 0 }, P.VIEW_CHANNEL, value)
      list = found ? list.map((o) => (o === found ? next : o)) : [...list, next]
    }
    put(guild.id, 'role', 'deny')
    for (const id of allowed) put(id, 'role', 'allow')
    // Quem cria e não é administrador continua vendo o canal que criou.
    const me = guild.me
    if (me && !isAdmin(guild, guild.meId)) {
      const draft = { id: '', name: clean, kind, position: 0, parentId, topic: '', overwrites: list, userLimit: 0, slowmode: 0 }
      if (!has(channelPermissions(permContext(guild), me, draft), P.VIEW_CHANNEL)) put(guild.meId, 'member', 'allow')
    }
    return list
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!guild || !clean || busy) return
    busy = true
    const target = guild
    const parentId = kind === 'category' ? null : (parent?.id ?? null)
    const before = new Set(target.channels.map((c) => c.id))
    const created = () => target.channels.find((c) => !before.has(c.id) && c.kind === kind && c.name === clean)
    target.createChannel(clean, kind, parentId, isPrivate && canPrivate ? privateRules(parentId) : undefined)
    // Espera também as permissões dele chegarem: sem elas, abrir o canal cairia no primeiro de texto.
    const ok = await settled(() => {
      const channel = created()
      return !!channel && target.permissions[channel.id] !== undefined
    })
    busy = false
    if (!ok) return
    const channel = created()
    close()
    // Canal de texto novo já abre.
    if (channel?.kind === 'text') client.openChannel(target.id, channel.id)
  }
</script>

{#if guild}
  <Modal {title} description={parent ? t.inParent(parent.name) : undefined} onclose={close} dismissible={!busy}>
    <form id="{uid}-form" class="form" onsubmit={submit}>
      <div class="kinds" role="radiogroup" aria-label={t.kind}>
        {#each kinds as option (option.value)}
          <button
            type="button"
            class="kind"
            class:on={kind === option.value}
            role="radio"
            aria-checked={kind === option.value}
            onclick={() => (kind = option.value)}
          >
            <span class="kind-icon"><Icon name={option.icon} size={20} /></span>
            <span class="kind-text">
              <span class="kind-label">{option.label}</span>
              <span class="kind-hint">{option.hint}</span>
            </span>
            <span class="radio" aria-hidden="true"></span>
          </button>
        {/each}
      </div>

      <TextField
        label={kind === 'category' ? shared.categoryName : shared.channelName}
        icon={kind === 'text' ? 'hash' : kind === 'voice' ? 'volume' : 'folder'}
        placeholder={t.placeholders[kind]}
        bind:value={name}
        maxlength={100}
        spellcheck={false}
      />

      {#if canPrivate}
        <div class="private">
          <label class="private-row" for="{uid}-private">
            <span class="private-icon"><Icon name="lock" size={16} /></span>
            <span class="private-text">
              <span class="private-label">{kind === 'category' ? shared.privateCategory : shared.privateChannel}</span>
              <span class="private-hint">{t.privateHint}</span>
            </span>
            <Switch id="{uid}-private" bind:checked={isPrivate} />
          </label>
          {#if isPrivate}
            {#if roles.length}
              <div class="roles" role="group" aria-label={t.whoCanSee}>
                {#each roles as role (role.id)}
                  <label class="role">
                    <span class="dot" style:background={hex(role.color) ?? 'var(--fg-3)'}></span>
                    <span class="role-name">{role.name}</span>
                    <Switch size="sm" checked={allowed.includes(role.id)} onchange={(e) => toggleRole(role.id, e.currentTarget.checked)} />
                  </label>
                {/each}
              </div>
            {:else}
              <p class="none">{t.noRoles}</p>
            {/if}
          {/if}
        </div>
      {/if}
    </form>

    {#snippet footer()}
      <Button variant="ghost" onclick={close} disabled={busy}>{m.common.cancel}</Button>
      <Button variant="primary" type="submit" form="{uid}-form" disabled={!clean} loading={busy}>{title}</Button>
    {/snippet}
  </Modal>
{/if}

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .kinds {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .kind {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: 10px 14px 10px 10px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.035);
    box-shadow: inset 0 0 0 1px var(--line);
    text-align: left;
    transition:
      background-color var(--t-fast) var(--ease),
      box-shadow var(--t-fast) var(--ease);
  }

  .kind:hover {
    background: rgb(255 255 255 / 0.06);
  }

  .kind.on {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }

  .kind-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.06);
    color: var(--fg-2);
  }

  .kind.on .kind-icon {
    color: var(--accent-fg);
  }

  .kind-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.35;
  }

  .kind-label {
    font-weight: 600;
  }

  .kind-hint {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .radio {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--fg-3);
    transition: box-shadow var(--t) var(--ease);
  }

  .on .radio {
    box-shadow:
      inset 0 0 0 5px var(--accent),
      inset 0 0 0 9px var(--fg-on-accent);
  }

  .private {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .private-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    cursor: pointer;
  }

  .private-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.06);
    color: var(--fg-2);
  }

  .private-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.35;
  }

  .private-label {
    font-weight: 500;
  }

  .private-hint {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .roles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 196px;
    padding: 4px;
    overflow-y: auto;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .role {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    padding: 0 8px;
    border-radius: var(--r-md);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .role:hover {
    background: var(--hover);
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .role-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .none {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }
</style>
