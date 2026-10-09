<script lang="ts" module>
  import type { Invite } from '../../../../../shared/protocol'

  /** Último convite gerado em cada servidor nesta sessão: abrir de novo reaproveita, sem encher a lista. */
  const recent = new Map<string, { invite: Invite; age: string; uses: string }>()
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import { P } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { m } from '../../lib/i18n.svelte'
  import { ui } from '../../lib/ui.svelte'
  import { Button, EmptyState, Icon, Modal, Select } from '../kit'
  import { copyText, inviteAges, inviteOptions, inviteUses, relative } from './util'

  const t = $derived(m.server.invite)
  const request = $derived(ui.invite)
  const guild = $derived(request ? (client.guilds[request.guildId] ?? null) : null)
  const canInvite = $derived(!!guild && guild.canGuild(P.CREATE_INVITE))

  $effect(() => {
    if (request && !guild) close()
  })

  let invite = $state<Invite | null>(null)
  let busy = $state(false)
  let failed = $state(false)
  let editing = $state(false)
  let age = $state('604800')
  let uses = $state('none')
  let copied = $state(false)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  /** Esse link já saiu daqui (copiado ou reaproveitado): não pode ser apagado sem avisar ninguém. */
  let shared = false

  const link = $derived(invite && client.api ? `${client.api.server}/i/${invite.code}` : '')
  const summary = $derived.by(() => {
    if (!invite) return ''
    const expiry = invite.expiresAt ? t.expires(relative(invite.expiresAt, client.now)) : t.never
    const limit = invite.maxUses ? t.upTo(invite.maxUses) : t.unlimited
    return `${expiry} · ${limit}`
  })

  const usable = (i: Invite) => (i.expiresAt === null || i.expiresAt > Date.now() + 60_000) && (i.maxUses === null || i.uses < i.maxUses)

  onMount(() => {
    const last = guild ? recent.get(guild.id) : undefined
    if (last && usable(last.invite)) {
      invite = last.invite
      age = last.age
      uses = last.uses
      shared = true
    } else if (canInvite) {
      generate()
    }
    return () => clearTimeout(copiedTimer)
  })

  function close() {
    ui.invite = null
  }

  async function generate() {
    if (!guild || busy) return
    busy = true
    failed = false
    const previous = invite && !shared ? invite.code : null
    try {
      const next = await guild.createInvite(inviteOptions(age, uses))
      if (!next) throw new Error('sem convite')
      invite = next
      shared = false
      copied = false
      editing = false
      recent.set(guild.id, { invite: next, age, uses })
      // O anterior nem chegou a sair daqui: apaga pra não sobrar convite à toa.
      if (previous) guild.deleteInvite(previous)
    } catch {
      failed = true
    } finally {
      busy = false
    }
  }

  async function copy() {
    if (!link) return
    if (!(await copyText(link))) return client.toast(m.server.shared.copyFailed)
    shared = true
    copied = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied = false), 2000)
  }
</script>

{#if guild}
  <Modal title={t.title(guild.info.name)} description={t.description} onclose={close}>
    {#if !canInvite}
      <EmptyState icon="lock" title={t.noPermissionTitle} description={t.noPermissionDescription} />
    {:else}
      <!-- Copiou na mão (Ctrl + C) também conta: esse link pode ter saído daqui. -->
      <div class="box" class:failed oncopy={() => (shared = true)}>
        <span class="link selectable" class:muted={!invite}>
          {#if invite}{link}{:else if failed}{t.failed}{:else}{t.generating}{/if}
        </span>
        {#if failed && !invite}
          <Button size="sm" icon="restart" onclick={generate} loading={busy}>{m.common.retry}</Button>
        {:else}
          <Button class="copy" size="sm" variant={copied ? 'secondary' : 'primary'} icon={copied ? 'check' : 'copy'} disabled={!invite || busy} onclick={copy}>
            {copied ? m.common.copied : m.common.copy}
          </Button>
        {/if}
      </div>

      <p class="meta">
        {#if invite}
          <span>{t.code} <code class="selectable">{invite.code}</code> · {summary}</span>
        {/if}
        <button type="button" class="edit" aria-expanded={editing} onclick={() => (editing = !editing)}>
          <Icon name="settings" size={14} />{t.change}
        </button>
      </p>

      {#if editing}
        <div class="options">
          <label class="mini-field">
            <span>{t.validFor}</span>
            <Select label={t.validFor} bind:value={age} options={inviteAges()} />
          </label>
          <label class="mini-field">
            <span>{t.uses}</span>
            <Select label={t.uses} bind:value={uses} options={inviteUses()} />
          </label>
          <Button onclick={generate} loading={busy}>{t.newLink}</Button>
        </div>
        {#if failed && invite}<p class="error">{t.newFailed}</p>{/if}
      {/if}
    {/if}
  </Modal>
{/if}

<style>
  .box {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: var(--h-xl);
    padding: 5px 5px 5px 14px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .box.failed {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--red) 55%, transparent);
  }

  .link {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 500 var(--text-sm) var(--mono);
  }

  .link.muted {
    color: var(--fg-3);
    font-family: var(--font);
  }

  .box :global(.copy) {
    min-width: 92px;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-top: var(--s-2);
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .meta span {
    flex: 1;
    min-width: 0;
  }

  code {
    color: var(--fg-2);
    font: 500 var(--text-xs) var(--mono);
    letter-spacing: 0.02em;
  }

  .edit {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    padding: 2px 6px;
    border-radius: var(--r-sm);
    color: var(--accent-fg);
    font-weight: 500;
  }

  .edit:hover {
    background: var(--accent-soft);
  }

  .options {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    margin-top: var(--s-4);
  }

  .mini-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
    color: var(--fg-2);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .error {
    margin-top: var(--s-2);
    color: var(--red);
    font-size: var(--text-xs);
  }
</style>
