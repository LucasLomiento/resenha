<script lang="ts">
  import type { DmPolicy, User } from '../../../../../shared/protocol'
  import { HttpError } from '../../lib/api'
  import { client } from '../../lib/client.svelte'
  import { m } from '../../lib/i18n.svelte'
  import { Avatar, Button, Icon, Modal, PageHeader, RadioGroup, Row, Section, TextField } from '../kit'

  const DOCS = 'https://github.com/LucasLomiento/resenha/blob/main/docs'
  const uid = $props.id()
  const t = $derived(m.settings.privacy)

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
      link.download = t.data.file
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
  const blocker = $derived(owned.length ? t.remove.ownsServers(owned.join(', ')) : null)
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

<PageHeader title={m.settings.pages.privacy} />

<Section setting="privacy.dms" title={t.dms.title} description={t.dms.description}>
  <RadioGroup
    label={t.dms.title}
    bind:value={() => policy, (value) => setPolicy(value)}
    options={[
      { value: 'everyone', label: t.dms.everyone },
      { value: 'servers', label: t.dms.servers },
      { value: 'friends', label: t.dms.friends },
    ]}
  />
</Section>

<Section setting="privacy.blocked" title={t.blocked.title} description={t.blocked.description}>
  {#each blocked as user (user.id)}
    <Row label={user.name} description={user.username}>
      {#snippet leading()}
        <Avatar id={user.id} name={user.name} size={32} src={client.api?.avatar(user) ?? null} cutout="var(--bg-raised)" />
      {/snippet}
      <Button size="sm" loading={unblocking === user.id} disabled={!!unblocking} onclick={() => unblock(user)}>{t.blocked.unblock}</Button>
    </Row>
  {:else}
    <Row description={t.blocked.none} />
  {/each}
</Section>

<Section title={t.data.section}>
  <Row setting="privacy.export" label={t.data.export} description={t.data.exportDescription}>
    <Button icon="download" loading={exporting} onclick={download}>{t.data.download}</Button>
  </Row>
  <Row setting="privacy.delete" label={t.remove.label} description={t.remove.description}>
    <Button variant="danger-soft" icon="trash" onclick={openDelete}>{t.remove.label}</Button>
  </Row>
</Section>

<p class="docs" data-setting="privacy.docs">
  <a href="{DOCS}/PRIVACIDADE.md" target="_blank" rel="noreferrer">{t.docs.privacy}<Icon name="arrow-up-right" size={14} /></a>
  <a href="{DOCS}/TERMOS.md" target="_blank" rel="noreferrer">{t.docs.terms}<Icon name="arrow-up-right" size={14} /></a>
</p>

{#if deleting}
  <Modal
    title={t.remove.title}
    description={t.remove.warning}
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
          label={t.remove.password}
          type="password"
          bind:value={password}
          autocomplete="current-password"
          error={passwordError}
          oninput={() => (passwordError = null)}
        />
      {/if}
    </form>
    {#snippet footer()}
      <Button variant="ghost" disabled={removing} onclick={() => (deleting = false)}>{m.common.cancel}</Button>
      <Button variant="danger" type="submit" form="{uid}-delete" loading={removing} disabled={!password || !!blocker}>{m.common.delete}</Button>
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
