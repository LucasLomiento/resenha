<script lang="ts" module>
  export type MemberAction = 'roles' | 'nick' | 'timeout' | 'kick' | 'ban'
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { Button, Icon, Modal, Segmented, Switch, TextField } from '../../kit'
  import { hex, myTop } from '../permissions'
  import { settled } from '../settle.svelte'
  import { TIMEOUTS, cleanName, durationText } from '../util'

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

  const TITLES: Record<MemberAction, string> = {
    roles: `Cargos de ${name}`,
    nick: self ? 'Seu apelido neste servidor' : `Apelido de ${name}`,
    timeout: `Castigar ${name}`,
    kick: `Expulsar ${name}?`,
    ban: `Banir ${name}?`,
  }

  const DESCRIPTIONS: Partial<Record<MemberAction, string>> = {
    timeout: 'Não fala nem escreve até o castigo acabar.',
    kick: 'Sai do servidor, mas pode voltar com um convite.',
    ban: 'Sai do servidor e não volta, nem com convite, até alguém desbanir.',
  }

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
        const m = Number(minutes)
        guild.timeout(userId, m, reason.trim())
        const ok = await settled(() => (guild.members[userId]?.timeoutUntil ?? 0) > Date.now())
        if (ok) client.toast(`${name} ficou de castigo por ${durationText(m)}.`, 'info')
        return ok
      }
      case 'kick': {
        guild.kick(userId, reason.trim())
        const ok = await settled(() => !guild.members[userId])
        if (ok) client.toast(`Você expulsou ${name}.`, 'info')
        return ok
      }
      case 'ban': {
        guild.ban(userId, reason.trim(), purge)
        // Apagar as mensagens pode demorar um pouco mais.
        const ok = await settled(() => !guild.members[userId], 20_000)
        if (ok) client.toast(`Você baniu ${name}.`, 'info')
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

<Modal title={TITLES[action]} description={DESCRIPTIONS[action]} size={action === 'roles' ? 'sm' : 'md'} {onclose} dismissible={!busy}>
  <form id="{uid}-form" class="form" onsubmit={submit}>
    {#if action === 'roles'}
      {#if roles.length === 0}
        <p class="empty">Ainda não tem cargo nenhum. Crie em Cargos.</p>
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
        label="Apelido"
        bind:value={nick}
        maxlength={32}
        placeholder={guild.users[userId]?.name ?? ''}
        hint="Vazio volta pro nome de exibição."
        spellcheck={false}
      />
    {:else}
      {#if action === 'timeout'}
        <div class="field">
          <span class="field-label">Por quanto tempo</span>
          <Segmented label="Por quanto tempo" options={TIMEOUTS} bind:value={minutes} />
        </div>
      {/if}
      <TextField label="Motivo" bind:value={reason} maxlength={512} hint="Opcional. Fica no registro de auditoria." />
      {#if action === 'ban'}
        <label class="purge">
          <Switch bind:checked={purge} size="sm" />
          <span>Apagar as mensagens dos últimos 7 dias</span>
        </label>
      {/if}
    {/if}
  </form>

  {#snippet footer()}
    <Button variant="ghost" onclick={onclose} disabled={busy}>Cancelar</Button>
    {#if action === 'kick'}
      <Button variant="danger" type="submit" form="{uid}-form" loading={busy}>Expulsar</Button>
    {:else if action === 'ban'}
      <Button variant="danger" type="submit" form="{uid}-form" loading={busy}>Banir</Button>
    {:else if action === 'timeout'}
      <Button variant="primary" type="submit" form="{uid}-form" loading={busy}>Castigar</Button>
    {:else}
      <Button variant="primary" type="submit" form="{uid}-form" loading={busy} disabled={action === 'roles' && roles.length === 0}>Salvar</Button>
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
