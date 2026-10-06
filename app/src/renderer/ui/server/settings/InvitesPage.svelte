<script lang="ts">
  import { onMount } from 'svelte'
  import { P, type Invite } from '../../../../../../shared/protocol'
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { Avatar, Button, EmptyState, IconButton, PageHeader, Section, Select, Spinner, tooltip } from '../../kit'
  import { INVITE_AGES, INVITE_USES, copyText, inviteOptions, plural, relative, whenText } from '../util'

  let { guild }: { guild: GuildState } = $props()

  let invites = $state<Invite[] | null>(null)
  let failed = $state(false)
  let age = $state('604800')
  let uses = $state('none')
  let creating = $state(false)
  let fresh = $state<string | null>(null)
  let copied = $state<string | null>(null)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  const canCreate = $derived(guild.canGuild(P.CREATE_INVITE))
  /** Vencidos ou esgotados somem na hora (o servidor também não lista). */
  const active = $derived(
    (invites ?? []).filter((i) => (i.expiresAt === null || i.expiresAt > client.now) && (i.maxUses === null || i.uses < i.maxUses)),
  )

  async function load() {
    failed = false
    invites = null
    try {
      invites = await guild.invites()
    } catch {
      failed = true
    }
  }

  onMount(() => {
    load()
    return () => clearTimeout(copiedTimer)
  })

  const link = (code: string) => `${client.api?.server ?? ''}/i/${code}`

  async function create() {
    if (creating) return
    creating = true
    try {
      const invite = await guild.createInvite(inviteOptions(age, uses))
      if (invite) {
        invites = [invite, ...(invites ?? []).filter((i) => i.code !== invite.code)]
        fresh = invite.code
      }
    } catch (err) {
      client.toast((err as Error).message)
    } finally {
      creating = false
    }
  }

  async function copy(code: string) {
    if (!(await copyText(link(code)))) return client.toast('Não deu pra copiar o link.')
    copied = code
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied = null), 2000)
  }

  function revoke(code: string) {
    guild.deleteInvite(code)
    invites = (invites ?? []).filter((i) => i.code !== code)
  }

  function usesText(invite: Invite): string {
    return invite.maxUses ? `${invite.uses}/${invite.maxUses} usos` : plural(invite.uses, 'uso', 'usos')
  }
</script>

<PageHeader title="Convites" description="Quem tem o convite entra no servidor." />

{#if canCreate}
  <Section title="Novo convite">
    <div class="invite-form">
      <label class="mini-field">
        <span>Vale por</span>
        <Select label="Vale por" bind:value={age} options={INVITE_AGES} />
      </label>
      <label class="mini-field">
        <span>Usos</span>
        <Select label="Usos" bind:value={uses} options={INVITE_USES} />
      </label>
      <span class="grow"></span>
      <Button variant="primary" icon="link" loading={creating} onclick={create}>Criar convite</Button>
    </div>
  </Section>
{/if}

<Section title="Ativos">
  {#if failed}
    <div class="state">
      <EmptyState icon="link" title="Não deu pra carregar os convites" description="Confira a conexão e tente de novo.">
        {#snippet actions()}<Button onclick={load}>Tentar de novo</Button>{/snippet}
      </EmptyState>
    </div>
  {:else if !invites}
    <div class="state"><Spinner size={20} /></div>
  {:else if active.length === 0}
    <div class="state">
      <EmptyState icon="link" title="Nenhum convite ativo" description="Crie um pra chamar alguém pro servidor." />
    </div>
  {:else}
    {#each active as invite (invite.code)}
      {@const inviter = guild.users[invite.inviterId]}
      {@const inviterName = guild.displayName(invite.inviterId)}
      <div class="invite-row" class:fresh={fresh === invite.code}>
        <code class="selectable">{invite.code}</code>
        <span class="by">
          <Avatar id={invite.inviterId} name={inviterName} size={20} src={client.avatarOf(invite.inviterId, guild.id)} cutout="var(--bg-raised)" />
          <span class="truncate">{inviter ? inviterName : 'Alguém que saiu'}</span>
        </span>
        <span class="uses tabular">{usesText(invite)}</span>
        <span class="expires" use:tooltip={invite.expiresAt ? whenText(invite.expiresAt, client.now) : null}>
          {invite.expiresAt ? `vence ${relative(invite.expiresAt, client.now)}` : 'não vence'}
        </span>
        <IconButton
          icon={copied === invite.code ? 'check' : 'copy'}
          label={copied === invite.code ? 'Copiado' : 'Copiar link'}
          size="sm"
          tone="success"
          active={copied === invite.code}
          onclick={() => copy(invite.code)}
        />
        <IconButton icon="trash" label="Revogar" size="sm" tone="danger" onclick={() => revoke(invite.code)} />
      </div>
    {/each}
  {/if}
</Section>

<style>
  .invite-form {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    padding: 14px 16px;
  }

  .mini-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 150px;
    color: var(--fg-2);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .grow {
    flex: 1;
  }

  .invite-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 52px;
    padding: 8px 10px 8px 16px;
    transition: background-color var(--t-slow) var(--ease);
  }

  .invite-row + .invite-row {
    border-top: 1px solid var(--line);
  }

  .invite-row.fresh {
    background: var(--accent-soft);
  }

  .invite-row:first-child {
    border-radius: var(--r-xl) var(--r-xl) 0 0;
  }

  .invite-row:last-child {
    border-radius: 0 0 var(--r-xl) var(--r-xl);
  }

  .invite-row:only-child {
    border-radius: var(--r-xl);
  }

  code {
    width: 96px;
    flex: none;
    color: var(--fg);
    font: 500 var(--text-sm) var(--mono);
  }

  .by {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .uses {
    width: 72px;
    flex: none;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .expires {
    width: 112px;
    flex: none;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .state {
    display: grid;
    place-items: center;
    min-height: 160px;
    padding: var(--s-6);
    color: var(--fg-3);
  }
</style>
