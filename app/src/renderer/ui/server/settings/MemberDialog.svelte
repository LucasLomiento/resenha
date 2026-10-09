<script lang="ts" module>
  export type MemberAction = 'roles' | 'nick' | 'timeout' | 'kick' | 'ban'
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { m } from '../../../lib/i18n.svelte'
  import { Button, Icon, Modal, Segmented, Switch, TextField } from '../../kit'
  import { hex, myTop } from '../permissions'
  import { settled } from '../settle.svelte'
  import { cleanName, durationText, timeouts } from '../util'

  let { guild, action, userId, onclose }: { guild: GuildState; action: MemberAction; userId: string; onclose: () => void } = $props()

  const uid = $props.id()
  // Nome e estado de quando o diálogo abriu (a pessoa pode sair no meio).
  const name = untrack(() => guild.displayName(userId))
  const self = untrack(() => userId === guild.meId)

  let busy = $state(false)
  let reason = $state('')
  let minutes = $state('10')
  let purge = $state(false)
  let nick = $state(untrack(() => guild.members[userId]?.nick ?? ''))
  let chosen = $state<string[]>(untrack(() => [...(guild.members[userId]?.roles ?? [])]))

  const roles = $derived(guild.roles.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position))
  const top = $derived(myTop(guild))
  const canGive = (position: number) => guild.isOwner || position < top

  // A pessoa saiu do servidor (ou outra pessoa já tirou ela): fecha.
  $effect(() => {
    if (!guild.members[userId] && !busy) onclose()
  })

  const t = $derived(m.server.memberDialog)

  const titles = $derived<Record<MemberAction, string>>({
    roles: t.rolesTitle(name),
    nick: self ? t.nickTitleSelf : t.nickTitle(name),
    timeout: t.timeoutTitle(name),
    kick: t.kickTitle(name),
    ban: t.banTitle(name),
  })

  const descriptions = $derived<Partial<Record<MemberAction, string>>>({
    timeout: t.timeoutDescription,
    kick: t.kickDescription,
    ban: t.banDescription,
  })

  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id))

  function toggleRole(id: string, on: boolean) {
    chosen = on ? [...chosen, id] : chosen.filter((r) => r !== id)
  }

  async function run(): Promise<boolean> {
    switch (action) {
      case 'roles': {
        const next = [...chosen]
        guild.setRoles(userId, next)
        return settled(() => sameSet(guild.members[userId]?.roles ?? [], next))
      }
      case 'nick': {
        const value = cleanName(nick) || null
        guild.setNick(userId, value)
        return settled(() => (guild.members[userId]?.nick ?? null) === value)
      }
      case 'timeout': {
        const length = Number(minutes)
        guild.timeout(userId, length, reason.trim())
        const ok = await settled(() => (guild.members[userId]?.timeoutUntil ?? 0) > Date.now())
        if (ok) client.toast(t.timedOut(name, durationText(length)), 'info')
        return ok
      }
      case 'kick': {
        guild.kick(userId, reason.trim())
        const ok = await settled(() => !guild.members[userId])
        if (ok) client.toast(t.kicked(name), 'info')
        return ok
      }
      case 'ban': {
        guild.ban(userId, reason.trim(), purge)
        // Apagar as mensagens pode demorar um pouco mais.
        const ok = await settled(() => !guild.members[userId], 20_000)
        if (ok) client.toast(t.banned(name), 'info')
        return ok
      }
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (busy) return
    busy = true
    const ok = await run()
    busy = false
    if (ok) onclose()
  }
</script>

<Modal title={titles[action]} description={descriptions[action]} size={action === 'roles' ? 'sm' : 'md'} {onclose} dismissible={!busy}>
  <form id="{uid}-form" class="form" onsubmit={submit}>
    {#if action === 'roles'}
      {#if roles.length === 0}
        <p class="empty">{t.noRoles}</p>
      {:else}
        <div class="roles">
          {#each roles as r (r.id)}
            {@const allowed = canGive(r.position)}
            <label class="role" class:locked={!allowed}>
              <span class="dot" style:background={hex(r.color) ?? 'var(--fg-3)'}></span>
              <span class="role-name">{r.name}</span>
              {#if !allowed}<Icon name="lock" size={14} />{/if}
              <Switch
                size="sm"
                checked={chosen.includes(r.id)}
                disabled={!allowed || busy}
                onchange={(e) => toggleRole(r.id, e.currentTarget.checked)}
              />
            </label>
          {/each}
        </div>
      {/if}
    {:else if action === 'nick'}
      <TextField
        label={t.nick}
        bind:value={nick}
        maxlength={32}
        placeholder={guild.users[userId]?.name ?? ''}
        hint={t.nickHint}
        spellcheck={false}
      />
    {:else}
      {#if action === 'timeout'}
        <div class="field">
          <span class="field-label">{t.howLong}</span>
          <Segmented label={t.howLong} options={timeouts()} bind:value={minutes} />
        </div>
      {/if}
      <TextField label={t.reason} bind:value={reason} maxlength={512} hint={t.reasonHint} />
      {#if action === 'ban'}
        <label class="purge">
          <Switch bind:checked={purge} size="sm" />
          <span>{t.purge}</span>
        </label>
      {/if}
    {/if}
  </form>

  {#snippet footer()}
    <Button variant="ghost" onclick={onclose} disabled={busy}>{m.common.cancel}</Button>
    {#if action === 'kick'}
      <Button variant="danger" type="submit" form="{uid}-form" loading={busy}>{t.kick}</Button>
    {:else if action === 'ban'}
      <Button variant="danger" type="submit" form="{uid}-form" loading={busy}>{t.ban}</Button>
    {:else if action === 'timeout'}
      <Button variant="primary" type="submit" form="{uid}-form" loading={busy}>{t.timeout}</Button>
    {:else}
      <Button variant="primary" type="submit" form="{uid}-form" loading={busy} disabled={action === 'roles' && roles.length === 0}>{m.common.save}</Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .roles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    margin: 0 -8px;
    overflow-y: auto;
  }

  .role {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 38px;
    padding: 0 8px;
    border-radius: var(--r-md);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background-color var(--t-fast) var(--ease);
  }

  .role:hover {
    background: var(--hover);
  }

  .role.locked {
    color: var(--fg-3);
    cursor: default;
  }

  .role.locked:hover {
    background: none;
  }

  .role :global(svg) {
    color: var(--fg-4);
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

  .purge {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--fg-2);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .empty {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }
</style>
