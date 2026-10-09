<script lang="ts">
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { fmt, m } from '../../../lib/i18n.svelte'
  import { confirmAction } from '../../../lib/ui.svelte'
  import { Avatar, Button, Modal, TextField } from '../../kit'
  import { settled } from '../settle.svelte'
  import { fold } from '../util'

  let { guild, onclose }: { guild: GuildState; onclose: () => void } = $props()

  const t = $derived(m.server.transfer)
  let query = $state('')
  let chosen = $state<string | null>(null)
  let busy = $state(false)

  const people = $derived.by(() => {
    const q = fold(query.trim())
    return Object.values(guild.members)
      .filter((m) => m.userId !== guild.meId && !guild.users[m.userId]?.deleted)
      .map((m) => ({ id: m.userId, name: guild.displayName(m.userId), username: guild.users[m.userId]?.username ?? '' }))
      .filter((p) => !q || fold(p.name).includes(q) || fold(p.username).includes(q))
      .sort((a, b) => fmt.compare(a.name, b.name))
  })

  function transfer() {
    const id = chosen
    if (!id) return
    const name = guild.displayName(id)
    confirmAction({
      title: t.confirmTitle(name),
      description: t.confirmDescription,
      confirm: t.confirm,
      onconfirm: async () => {
        busy = true
        guild.transfer(id)
        const ok = await settled(() => guild.info.ownerId === id)
        busy = false
        if (!ok) return
        client.toast(m.server.transfer.done(name), 'info')
        onclose()
      },
    })
  }
</script>

<Modal title={t.title} description={t.description} {onclose} dismissible={!busy}>
  <TextField icon="search" placeholder={t.search} aria-label={t.search} bind:value={query} spellcheck={false} />
  <div class="people" role="radiogroup" aria-label={t.who}>
    {#each people as person (person.id)}
      <button type="button" role="radio" aria-checked={chosen === person.id} class:on={chosen === person.id} onclick={() => (chosen = person.id)}>
        <Avatar id={person.id} name={person.name} size={32} src={client.avatarOf(person.id, guild.id)} cutout="var(--bg-raised)" />
        <span class="text">
          <span class="name">{person.name}</span>
          {#if person.username}<span class="username">@{person.username}</span>{/if}
        </span>
        <span class="dot" aria-hidden="true"></span>
      </button>
    {:else}
      <p class="empty">{t.none}</p>
    {/each}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={onclose} disabled={busy}>{m.common.cancel}</Button>
    <Button variant="primary" disabled={!chosen} loading={busy} onclick={transfer}>{t.confirm}</Button>
  {/snippet}
</Modal>

<style>
  .people {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 280px;
    margin-top: var(--s-3);
    overflow-y: auto;
  }

  button {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 48px;
    padding: 6px 12px 6px 8px;
    border-radius: var(--r-lg);
    text-align: left;
    transition: background-color var(--t-fast) var(--ease);
  }

  button:hover {
    background: var(--hover);
  }

  button.on {
    background: var(--selected);
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }

  .username {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .dot {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--fg-3);
    transition: box-shadow var(--t) var(--ease);
  }

  .on .dot {
    box-shadow:
      inset 0 0 0 5px var(--accent),
      inset 0 0 0 9px var(--fg-on-accent);
  }

  .empty {
    padding: var(--s-4) var(--s-2);
    color: var(--fg-3);
    font-size: var(--text-sm);
  }
</style>
