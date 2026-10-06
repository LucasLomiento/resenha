<script lang="ts">
  import type { DmPolicy, User } from '../../../../../shared/protocol'
  import { HttpError } from '../../lib/api'
  import { client } from '../../lib/client.svelte'
  import { Avatar, Button, Icon, Modal, PageHeader, RadioGroup, Row, Section, TextField } from '../kit'

  const DOCS = 'https://github.com/LucasLomiento/resenha/blob/main/docs'
  const uid = $props.id()

  const blocked = $derived(client.home?.blocked ?? [])

  // ---------- Mensagens privadas ----------

  /** Escolha esperando o servidor confirmar (a lista não pisca de volta). */
  let pendingPolicy = $state<DmPolicy | null>(null)
  const policy = $derived(pendingPolicy ?? client.me?.dmPolicy ?? 'servers')

  $effect(() => {
    if (pendingPolicy && client.me?.dmPolicy === pendingPolicy) pendingPolicy = null
  })

  async function setPolicy(value: DmPolicy) {
    const api = client.api
    if (!api || value === policy) return
    pendingPolicy = value
    try {
      await api.updateMe({ dmPolicy: value })
    } catch (err) {
      pendingPolicy = null
      client.toast((err as Error).message)
    }
  }

  // ---------- Bloqueados ----------

  let unblocking = $state<string | null>(null)

  async function unblock(user: User) {
    const api = client.api
    if (!api) return
    unblocking = user.id
    try {
      // A conexão pessoal traz a lista nova.
      await api.unblock(user.id)
    } catch (err) {
      client.toast((err as Error).message)
    } finally {
      unblocking = null
    }
  }

  // ---------- Seus dados ----------

  let exporting = $state(false)

  async function download() {
    const api = client.api
    if (!api) return
    exporting = true
    try {
      const url = URL.createObjectURL(await api.exportData())
      const link = document.createElement('a')
      link.href = url
      link.download = 'resenha-meus-dados.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      client.toast((err as Error).message)
    } finally {
      exporting = false
    }
  }

  // ---------- Excluir conta ----------

  let deleting = $state(false)
  let password = $state('')
  /** Dono de servidor não pode excluir a conta antes de passar ou excluir o servidor. */
  const owned = $derived((client.home?.guilds ?? []).filter((g) => g.ownerId === client.me?.id).map((g) => g.name))
  const blocker = $derived(owned.length ? `Antes, transfira ou exclua seus servidores: ${owned.join(', ')}.` : null)
  let removing = $state(false)
  let passwordError = $state<string | null>(null)
  let deleteError = $state<string | null>(null)

  function openDelete() {
    password = ''
    passwordError = deleteError = null
    deleting = true
  }

  async function removeAccount(event: SubmitEvent) {
    event.preventDefault()
    if (!client.api || !password || blocker || removing) return
    removing = true
    passwordError = deleteError = null
    try {
      await client.deleteAccount(password)
      deleting = false
    } catch (err) {
      const message = (err as Error).message
      // Senha errada fica no campo; o resto (dono de servidor, muitas tentativas) em cima.
      if (err instanceof HttpError && err.status === 401) passwordError = message
      else deleteError = message
    } finally {
      removing = false
    }
  }
</script>

<PageHeader title="Privacidade" />

<Section title="Quem pode te mandar mensagem privada" description="Seus amigos sempre podem.">
  <RadioGroup
    label="Quem pode te mandar mensagem privada"
    bind:value={() => policy, (value) => setPolicy(value)}
    options={[
      { value: 'everyone', label: 'Qualquer pessoa' },
      { value: 'servers', label: 'Quem está nos meus servidores' },
      { value: 'friends', label: 'Só amigos' },
    ]}
  />
</Section>

<Section title="Bloqueados" description="Não podem te mandar mensagem privada nem pedido de amizade.">
  {#each blocked as user (user.id)}
    <Row label={user.name} description={user.username}>
      {#snippet leading()}
        <Avatar id={user.id} name={user.name} size={32} src={client.api?.media(user.avatar) ?? null} cutout="var(--bg-raised)" />
      {/snippet}
      <Button size="sm" loading={unblocking === user.id} disabled={!!unblocking} onclick={() => unblock(user)}>Desbloquear</Button>
    </Row>
  {:else}
    <Row description="Você não bloqueou ninguém." />
  {/each}
</Section>

<Section title="Seus dados">
  <Row label="Baixar meus dados" description="Perfil, aparelhos, servidores, amigos e bloqueios, num arquivo JSON.">
    <Button icon="download" loading={exporting} onclick={download}>Baixar</Button>
  </Row>
  <Row label="Excluir conta" description="Sai de todos os servidores. Suas mensagens ficam como “Usuário excluído”.">
    <Button variant="danger-soft" icon="trash" onclick={openDelete}>Excluir conta</Button>
  </Row>
</Section>

<p class="docs">
  <a href="{DOCS}/PRIVACIDADE.md" target="_blank" rel="noreferrer">Política de privacidade<Icon name="arrow-up-right" size={14} /></a>
  <a href="{DOCS}/TERMOS.md" target="_blank" rel="noreferrer">Termos de uso<Icon name="arrow-up-right" size={14} /></a>
</p>

{#if deleting}
  <Modal
    title="Excluir conta?"
    description="Não dá pra desfazer. Você sai de todos os servidores e suas mensagens ficam como “Usuário excluído”."
    size="sm"
    dismissible={!removing}
    onclose={() => (deleting = false)}
  >
    <form id="{uid}-delete" class="delete" onsubmit={removeAccount}>
      {#if blocker}
        <p class="callout" role="alert"><Icon name="circle-alert" size={16} /><span>{blocker}</span></p>
      {:else}
        {#if deleteError}
          <p class="callout" role="alert"><Icon name="circle-alert" size={16} /><span>{deleteError}</span></p>
        {/if}
        <TextField
          label="Sua senha"
          type="password"
          bind:value={password}
          autocomplete="current-password"
          error={passwordError}
          oninput={() => (passwordError = null)}
        />
      {/if}
    </form>
    {#snippet footer()}
      <Button variant="ghost" disabled={removing} onclick={() => (deleting = false)}>Cancelar</Button>
      <Button variant="danger" type="submit" form="{uid}-delete" loading={removing} disabled={!password || !!blocker}>Excluir</Button>
    {/snippet}
  </Modal>
{/if}

<style>
  .docs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 20px;
    margin-top: var(--s-6);
    padding: 0 2px;
    font-size: var(--text-sm);
  }

  .docs a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .delete {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .callout {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--r-lg);
    background: var(--red-soft);
    color: var(--red);
    font-size: var(--text-sm);
  }

  .callout :global(svg) {
    margin-top: 2px;
  }
</style>
