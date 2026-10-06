<script lang="ts">
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { ui } from '../../../lib/ui.svelte'
  import { Button, Modal, TextField } from '../../kit'
  import { settled } from '../settle.svelte'

  let { guild, onclose }: { guild: GuildState; onclose: () => void } = $props()

  const uid = $props.id()
  let typed = $state('')
  let busy = $state(false)
  let error = $state<string | null>(null)

  // O servidor confere do mesmo jeito: sem diferença de maiúscula e sem espaço nas pontas.
  const matches = $derived(typed.trim().toLowerCase() === guild.info.name.trim().toLowerCase())

  async function remove(event: SubmitEvent) {
    event.preventDefault()
    if (!matches || busy || !client.api) return
    busy = true
    error = null
    const { id } = guild
    const name = guild.info.name
    const since = client.toasts.reduce((max, t) => Math.max(max, t.id), 0)
    try {
      await client.api.deleteGuild(id, typed.trim())
    } catch (err) {
      error = (err as Error).message
      busy = false
      return
    }
    ui.guildSettings = null
    // O app já avisa quando o servidor some da lista; só avisa aqui se esse aviso não vier.
    await settled(() => !client.guilds[id], 3000)
    if (!client.toasts.some((t) => t.id > since)) client.toast(`${name} foi excluído.`, 'info')
  }
</script>

<Modal
  title="Excluir {guild.info.name}?"
  description="Apaga canais, mensagens e arquivos pra todo mundo. Não dá pra desfazer."
  size="sm"
  {onclose}
  dismissible={!busy}
>
  <form id="{uid}-form" onsubmit={remove}>
    <TextField
      label="Digite o nome do servidor pra confirmar"
      placeholder={guild.info.name}
      bind:value={typed}
      {error}
      autocomplete="off"
      spellcheck={false}
    />
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={onclose} disabled={busy}>Cancelar</Button>
    <Button variant="danger" type="submit" form="{uid}-form" disabled={!matches} loading={busy}>Excluir</Button>
  {/snippet}
</Modal>
