<script lang="ts">
  import { onMount } from 'svelte'
  import type { Ban } from '../../../../../../shared/protocol'
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { Avatar, Button, EmptyState, PageHeader, Section, Spinner, TextField, tooltip } from '../../kit'
  import { fold, relative, whenText } from '../util'

  let { guild }: { guild: GuildState } = $props()

  let bans = $state<Ban[] | null>(null)
  let failed = $state(false)
  let query = $state('')

  const shown = $derived.by(() => {
    const q = fold(query.trim())
    return (bans ?? []).filter((b) => !q || [b.user?.name ?? '', b.user?.username ?? '', b.reason].some((t) => fold(t).includes(q)))
  })

  async function load() {
    failed = false
    bans = null
    try {
      bans = await guild.bans()
    } catch {
      failed = true
    }
  }

  onMount(load)

  const nameOf = (ban: Ban) => (ban.user?.deleted ? 'Usuário excluído' : (ban.user?.name ?? 'Conta desconhecida'))

  function unban(ban: Ban) {
    guild.unban(ban.userId)
    bans = (bans ?? []).filter((b) => b.userId !== ban.userId)
    client.toast(`Você desbaniu ${nameOf(ban)}.`, 'info')
  }
</script>

<PageHeader title="Banimentos" description="Quem foi banido não volta, nem com convite." />

{#if bans && bans.length > 6}
  <div class="toolbar">
    <TextField icon="search" placeholder="Buscar por nome ou motivo" aria-label="Buscar banimentos" bind:value={query} spellcheck={false} />
  </div>
{/if}

<Section>
  {#if failed}
    <div class="state">
      <EmptyState icon="ban" title="Não deu pra carregar a lista" description="Confira a conexão e tente de novo.">
        {#snippet actions()}<Button onclick={load}>Tentar de novo</Button>{/snippet}
      </EmptyState>
    </div>
  {:else if !bans}
    <div class="state"><Spinner size={20} /></div>
  {:else if bans.length === 0}
    <div class="state">
      <EmptyState icon="ban" title="Ninguém banido" description="Quem for banido aparece aqui, com o motivo." />
    </div>
  {:else if shown.length === 0}
    <div class="state"><p>Ninguém com esse nome ou motivo.</p></div>
  {:else}
    {#each shown as ban (ban.userId)}
      {@const name = nameOf(ban)}
      <div class="ban-row">
        <Avatar id={ban.userId} {name} size={36} src={client.api?.media(ban.user?.avatar ?? null) ?? null} cutout="var(--bg-raised)" />
        <span class="text">
          <span class="name">
            {name}
            {#if ban.user?.username && !ban.user.deleted}<span class="username">@{ban.user.username}</span>{/if}
          </span>
          <span class="reason" class:none={!ban.reason}>{ban.reason || 'Sem motivo'}</span>
          <span class="meta">
            por {guild.displayName(ban.actorId)} ·
            <span use:tooltip={whenText(ban.createdAt, client.now)}>{relative(ban.createdAt, client.now)}</span>
          </span>
        </span>
        <Button size="sm" onclick={() => unban(ban)}>Desbanir</Button>
      </div>
    {/each}
  {/if}
</Section>

<style>
  .toolbar {
    margin-bottom: var(--s-3);
  }

  .ban-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 64px;
    padding: 12px 16px;
  }

  .ban-row + .ban-row {
    border-top: 1px solid var(--line);
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.4;
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
    font-size: var(--text-xs);
    font-weight: 400;
  }

  .reason {
    color: var(--fg-2);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .reason.none {
    color: var(--fg-3);
    font-style: italic;
  }

  .meta {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .state {
    display: grid;
    place-items: center;
    min-height: 160px;
    padding: var(--s-6);
    color: var(--fg-3);
    font-size: var(--text-sm);
  }
</style>
