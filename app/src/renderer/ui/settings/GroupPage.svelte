<script lang="ts">
  import type { Channel, ChannelKind } from '../../../../../shared/protocol'
  import { store } from '../../lib/store.svelte'
  import { confirmAction } from '../../lib/ui.svelte'
  import { Avatar, Badge, Button, Icon, IconButton, PageHeader, Row, Section, Segmented, TextField } from '../kit'

  const people = $derived(
    Object.values(store.users).sort(
      (a, b) => Number(!!store.online[b.id]) - Number(!!store.online[a.id]) || a.name.localeCompare(b.name),
    ),
  )
  const online = $derived(people.filter((u) => store.online[u.id]).length)

  // --- convite ---
  let copied = $state(false)

  async function copyInvite() {
    await navigator.clipboard.writeText(
      `Bora pro Resenha! Baixa aqui: https://github.com/LucasLomiento/resenha/releases/latest\nNa hora de criar a conta, usa o convite: ${store.invite}`,
    )
    copied = true
    setTimeout(() => (copied = false), 1500)
  }

  // --- canais ---
  let newChannel = $state('')
  let newKind = $state<ChannelKind>('text')
  let renaming = $state<Record<string, string>>({})

  function createChannel(event: SubmitEvent) {
    event.preventDefault()
    if (newChannel.trim().length < 2) return
    store.send({ t: 'channel.create', name: newChannel.trim(), kind: newKind })
    newChannel = ''
  }

  function rename(id: string) {
    const name = renaming[id]?.trim()
    if (name) store.send({ t: 'channel.rename', id, name })
    delete renaming[id]
  }

  function remove(channel: Channel) {
    confirmAction({
      title: channel.kind === 'text' ? `Apagar #${channel.name}?` : `Apagar ${channel.name}?`,
      description: channel.kind === 'text' ? 'As mensagens do canal somem junto.' : 'Quem estiver na call sai.',
      confirm: 'Apagar',
      onconfirm: () => store.send({ t: 'channel.delete', id: channel.id }),
    })
  }

  function focus(node: HTMLInputElement) {
    node.focus()
    node.select()
  }
</script>

<PageHeader title="Grupo" />

<Section title="Pessoas" description="{people.length} no grupo · {online} online">
  {#each people as user (user.id)}
    <Row label={user.name}>
      {#snippet leading()}
        <Avatar id={user.id} name={user.name} size={32} status={store.online[user.id] ? 'online' : 'offline'} cutout="var(--bg-raised)" />
      {/snippet}
      {#if user.id === store.me?.id}<Badge>Você</Badge>{/if}
      {#if user.admin}<Badge tone="accent">Admin</Badge>{/if}
    </Row>
  {/each}
</Section>

{#if store.me?.admin}
  <Section title="Convite" description="Cada convite vale pra uma conta, por 7 dias.">
    <Row>
      <div class="invite">
        {#if store.invite}
          <code class="selectable">{store.invite}</code>
          <Button icon={copied ? 'check' : 'copy'} onclick={copyInvite}>{copied ? 'Copiado' : 'Copiar convite'}</Button>
          <Button variant="ghost" onclick={() => store.send({ t: 'invite.create' })}>Gerar outro</Button>
        {:else}
          <Button variant="primary" icon="user-plus" onclick={() => store.send({ t: 'invite.create' })}>Gerar convite</Button>
        {/if}
      </div>
    </Row>
  </Section>

  <Section title="Canais">
    {#each store.channels as channel (channel.id)}
      <Row>
        {#snippet leading()}
          <span class="channel-icon"><Icon name={channel.kind === 'text' ? 'hash' : 'volume'} size={18} /></span>
        {/snippet}
        <div class="channel">
          {#if channel.id in renaming}
            <input
              class="rename"
              aria-label="Novo nome"
              maxlength="32"
              data-own-escape
              bind:value={renaming[channel.id]}
              onkeydown={(e) => {
                if (e.key === 'Enter') rename(channel.id)
                else if (e.key === 'Escape') {
                  e.stopPropagation()
                  delete renaming[channel.id]
                }
              }}
              onblur={() => rename(channel.id)}
              use:focus
            />
          {:else}
            <span class="channel-name">{channel.name}</span>
            <IconButton icon="pencil" label="Renomear" size="sm" onclick={() => (renaming[channel.id] = channel.name)} />
            <IconButton icon="trash" label="Apagar" size="sm" tone="danger" onclick={() => remove(channel)} />
          {/if}
        </div>
      </Row>
    {/each}
    <form class="new-channel" onsubmit={createChannel}>
      <TextField bind:value={newChannel} placeholder="Nome do canal novo" aria-label="Nome do canal novo" maxlength={32} />
      <Segmented
        label="Tipo do canal"
        options={[
          { value: 'text', label: 'Texto', icon: 'hash' },
          { value: 'voice', label: 'Voz', icon: 'volume' },
        ]}
        bind:value={newKind}
      />
      <Button variant="primary" type="submit" disabled={newChannel.trim().length < 2}>Criar</Button>
    </form>
  </Section>
{/if}

<style>
  .invite {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }

  .invite code {
    flex: 1;
    min-width: 0;
    height: var(--h-md);
    padding: 0 12px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--fg);
    font: 500 15px/34px var(--mono);
    letter-spacing: 0.04em;
  }

  .channel-icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-md);
    background: rgb(255 255 255 / 0.05);
    color: var(--fg-3);
  }

  .channel {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 100%;
  }

  .channel-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .rename {
    flex: 1;
    min-width: 0;
    height: var(--h-sm);
    padding: 0 10px;
    border: 0;
    border-radius: var(--r-md);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--accent-line);
    color: var(--fg);
    outline: none;
    user-select: text;
  }

  .new-channel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 168px auto;
    align-items: center;
    gap: 8px;
    padding: 12px 16px 14px;
    border-top: 1px solid var(--line);
  }
</style>
