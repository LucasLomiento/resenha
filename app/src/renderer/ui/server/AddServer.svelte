<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import type { InvitePreview } from '../../../../../shared/protocol'
  import { HttpError } from '../../lib/api'
  import { client, inviteCode } from '../../lib/client.svelte'
  import { ui } from '../../lib/ui.svelte'
  import { Avatar, Button, Icon, IconButton, Modal, Spinner, TextField } from '../kit'
  import { settled } from './settle.svelte'
  import { cleanName, iconBlob, pickImage, plural } from './util'

  type Step = 'choose' | 'create' | 'join'

  const uid = $props.id()
  let step = $state<Step>(untrack(() => ui.addServer?.step ?? 'choose'))
  let body = $state<HTMLDivElement>()

  function close() {
    // Sem isso o convite pendente reabriria esta janela na hora.
    client.pendingInvite = null
    ui.addServer = null
  }

  async function go(next: Step) {
    step = next
    await tick()
    ;(body?.querySelector<HTMLElement>('input') ?? body?.querySelector<HTMLElement>('button'))?.focus()
  }

  // ---------- Criar ----------

  let name = $state(untrack(() => (client.me ? `Servidor de ${client.me.name}` : 'Meu servidor')))
  let icon = $state<{ blob: Blob; url: string } | null>(null)
  let iconError = $state<string | null>(null)
  let createError = $state<string | null>(null)
  let creating = $state(false)
  const cleanTitle = $derived(cleanName(name))
  const createProblem = $derived(
    iconError ?? createError ?? (name && cleanTitle.length < 2 ? 'O nome precisa ter pelo menos 2 caracteres.' : null),
  )

  function setIcon(next: { blob: Blob; url: string } | null) {
    if (icon) URL.revokeObjectURL(icon.url)
    icon = next
  }

  onDestroy(() => {
    if (icon) URL.revokeObjectURL(icon.url)
  })

  async function chooseIcon() {
    const file = await pickImage()
    if (!file) return
    iconError = null
    try {
      const blob = await iconBlob(file)
      setIcon({ blob, url: URL.createObjectURL(blob) })
    } catch (err) {
      iconError = (err as Error).message
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault()
    if (cleanTitle.length < 2 || creating || !client.api) return
    creating = true
    createError = null
    try {
      // O ícone sobe antes; entra no servidor assim que a conexão dele abrir.
      const iconId = icon ? (await client.api.uploadGuildIcon(icon.blob)).id : null
      const created = await client.createGuild(cleanTitle)
      close()
      if (iconId && created) applyIcon(created.id, iconId)
    } catch (err) {
      createError = (err as Error).message
      creating = false
    }
  }

  async function applyIcon(guildId: string, iconId: string) {
    if (!(await settled(() => !!client.guilds[guildId]?.loaded, 20_000))) return
    client.guilds[guildId]?.updateGuild({ icon: iconId })
  }

  // ---------- Entrar com convite ----------

  let code = $state(untrack(() => ui.addServer?.code ?? client.pendingInvite ?? ''))
  let preview = $state<InvitePreview | null>(null)
  let checking = $state(false)
  let joinError = $state<string | null>(null)
  let joining = $state(false)

  const member = $derived(preview ? !!client.guilds[preview.guild.id] : false)

  // Abriram outro link de convite com a janela aberta: vai direto pra ele.
  let lastPending = untrack(() => client.pendingInvite)
  $effect(() => {
    const pending = client.pendingInvite
    if (!pending || pending === lastPending) return
    lastPending = pending
    code = pending
    go('join')
  })

  // Prévia ao vivo do convite colado (código ou link).
  $effect(() => {
    const value = inviteCode(code)
    preview = null
    joinError = null
    if (!/^[\w-]{4,32}$/.test(value) || !client.api) {
      checking = false
      return
    }
    checking = true
    const api = client.api
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const found = await api.invitePreview(value)
        if (!cancelled) preview = found
      } catch (err) {
        if (!cancelled) joinError = err instanceof HttpError && err.status === 404 ? 'Convite inválido, vencido ou já usado.' : (err as Error).message
      } finally {
        if (!cancelled) checking = false
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  })

  async function join(event: SubmitEvent) {
    event.preventDefault()
    if (!preview || joining) return
    const id = preview.guild.id
    if (member) {
      close()
      client.openGuild(id)
      return
    }
    joining = true
    joinError = null
    try {
      await client.joinInvite(code)
      close()
    } catch (err) {
      joinError = (err as Error).message
      joining = false
    }
  }

  const TITLES: Record<Step, string> = { choose: 'Novo servidor', create: 'Criar servidor', join: 'Entrar com convite' }
  const busy = $derived(creating || joining)
</script>

<!-- O "+" do trilho: criar um servidor ou entrar num com convite, no mesmo lugar. -->
<Modal
  title={TITLES[step]}
  description={step === 'choose' ? 'Crie o seu ou entre num com convite.' : undefined}
  onclose={close}
  dismissible={!busy}
>
  <div class="body" bind:this={body}>
    {#if step === 'choose'}
      <div class="choices">
        <button type="button" class="choice" onclick={() => go('create')}>
          <span class="choice-icon create"><Icon name="plus" size={24} /></span>
          <span class="choice-text">
            <span class="choice-title">Criar meu servidor</span>
            <span class="choice-sub">Pro seu grupo, do seu jeito.</span>
          </span>
          <Icon name="chevron-right" size={18} />
        </button>
        <button type="button" class="choice" onclick={() => go('join')}>
          <span class="choice-icon join"><Icon name="link" size={22} /></span>
          <span class="choice-text">
            <span class="choice-title">Entrar com convite</span>
            <span class="choice-sub">Cole o código ou o link que te mandaram.</span>
          </span>
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
    {:else if step === 'create'}
      <form id="{uid}-create" onsubmit={create}>
        <div class="create-form">
          <div class="upload-wrap">
            <button type="button" class="upload" class:filled={!!icon} aria-label={icon ? 'Trocar ícone' : 'Escolher ícone'} onclick={chooseIcon}>
              {#if icon}
                <img src={icon.url} alt="" />
              {:else}
                <Icon name="image-plus" size={24} />
                <span>Ícone</span>
              {/if}
            </button>
            {#if icon}
              <span class="upload-clear">
                <IconButton icon="x" label="Tirar ícone" size="sm" variant="subtle" onclick={() => setIcon(null)} />
              </span>
            {/if}
          </div>
          <TextField label="Nome do servidor" bind:value={name} maxlength={64} spellcheck={false} aria-invalid={!!createProblem} />
        </div>
        <!-- Erro na mesma linha da dica: o campo não cresce e o ícone não sai do lugar. -->
        {#if createProblem}
          <p class="note error" role="alert"><Icon name="circle-alert" size={14} />{createProblem}</p>
        {:else}
          <p class="note">Ícone é opcional. Dá pra mudar tudo depois.</p>
        {/if}
      </form>
    {:else}
      <form id="{uid}-join" onsubmit={join}>
        <TextField
          label="Convite ou link"
          mono
          bind:value={code}
          placeholder="Código ou link"
          spellcheck={false}
          autocomplete="off"
          error={joinError}
        />
        {#if preview}
          <div class="preview">
            <Avatar id={preview.guild.id} name={preview.guild.name} size={52} square src={client.api?.media(preview.guild.icon) ?? null} cutout="var(--bg-raised)" />
            <div class="preview-text">
              <span class="preview-name">{preview.guild.name}</span>
              <span class="preview-meta tabular">{plural(preview.memberCount, 'membro', 'membros')}</span>
              {#if member}
                <span class="preview-by">Você já está nesse servidor.</span>
              {:else if preview.inviter}
                <span class="preview-by">Convite de {preview.inviter.name}</span>
              {/if}
            </div>
          </div>
        {:else if checking}
          <div class="preview loading"><Spinner size={18} /><span>Procurando o convite…</span></div>
        {/if}
      </form>
    {/if}
  </div>

  {#snippet footer()}
    {#if step !== 'choose'}
      <Button variant="ghost" icon="arrow-left" onclick={() => go('choose')} disabled={busy}>Voltar</Button>
      <span class="grow"></span>
    {/if}
    {#if step === 'create'}
      <Button variant="primary" type="submit" form="{uid}-create" disabled={cleanTitle.length < 2} loading={creating}>Criar</Button>
    {:else if step === 'join'}
      <Button variant="primary" type="submit" form="{uid}-join" disabled={!preview} loading={joining}>
        {member ? 'Abrir servidor' : 'Entrar no servidor'}
      </Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .choices {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px;
    border-radius: var(--r-xl);
    background: rgb(255 255 255 / 0.035);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-3);
    text-align: left;
    transition:
      background-color var(--t-fast) var(--ease),
      box-shadow var(--t-fast) var(--ease);
  }

  .choice:hover {
    background: rgb(255 255 255 / 0.06);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--fg-2);
  }

  .choice-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 48px;
    height: 48px;
    border-radius: var(--r-xl);
    color: var(--fg-on-accent);
  }

  .choice-icon.create {
    background: var(--brand-gradient);
  }

  .choice-icon.join {
    background: linear-gradient(135deg, #36d6ad, #36a9dd);
  }

  .choice-text {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .choice-title {
    color: var(--fg);
    font-weight: 600;
  }

  .choice-sub {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .create-form {
    display: flex;
    align-items: flex-end;
    gap: var(--s-4);
  }

  .create-form :global(.field) {
    flex: 1;
  }

  .upload-wrap {
    position: relative;
    flex: none;
  }

  .upload {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 84px;
    height: 84px;
    overflow: hidden;
    border: 1.5px dashed var(--line-strong);
    border-radius: 24px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
    transition:
      border-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  .upload:hover {
    border-color: var(--accent-line);
    color: var(--accent-fg);
  }

  .upload.filled {
    border: 0;
  }

  .upload img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .upload-clear {
    position: absolute;
    top: -8px;
    right: -8px;
  }

  .upload-clear :global(.icon-btn) {
    border-radius: 50%;
    background: var(--bg-overlay);
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: var(--s-3);
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .note.error {
    color: var(--red);
  }

  .grow {
    flex: 1;
  }

  .preview {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: var(--s-4);
    padding: 14px;
    border-radius: var(--r-xl);
    background: rgb(255 255 255 / 0.035);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .preview.loading {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .preview-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .preview-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-lg);
    font-weight: 650;
  }

  .preview-meta {
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .preview-by {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }
</style>
