<script lang="ts">
  import { onDestroy } from 'svelte'
  import { P } from '../../../../../../shared/protocol'
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { confirmAction, ui } from '../../../lib/ui.svelte'
  import { Avatar, Button, Icon, PageHeader, Row, Section, TextField } from '../../kit'
  import SaveBar from '../SaveBar.svelte'
  import { settled } from '../settle.svelte'
  import type { Unsaved } from '../unsaved.svelte'
  import { cleanName, iconBlob, pickImage, plural } from '../util'
  import DeleteGuildModal from './DeleteGuildModal.svelte'
  import TransferModal from './TransferModal.svelte'

  let { guild, unsaved }: { guild: GuildState; unsaved: Unsaved } = $props()

  const canEdit = $derived(guild.canGuild(P.MANAGE_GUILD))
  const memberCount = $derived(Object.keys(guild.members).length)

  // Rascunho. Nome: null = igual ao do servidor. Ícone: undefined = sem mudança,
  // null = tirar, blob = ícone novo (só sobe pro servidor ao salvar).
  let name = $state<string | null>(null)
  let icon = $state<{ blob: Blob; url: string } | null | undefined>(undefined)
  let iconError = $state<string | null>(null)
  let saving = $state(false)
  let dialog = $state<'transfer' | 'delete' | null>(null)

  const shownName = $derived(name ?? guild.info.name)
  const nameError = $derived(name !== null && cleanName(name).length < 2 ? 'O nome precisa ter pelo menos 2 caracteres.' : null)
  const iconUrl = $derived(icon === undefined ? (client.api?.media(guild.info.icon) ?? null) : (icon?.url ?? null))
  const changed = $derived((name !== null && cleanName(name) !== guild.info.name) || icon !== undefined)

  $effect(() => {
    unsaved.dirty = changed
  })

  onDestroy(() => {
    unsaved.dirty = false
    setIcon(undefined)
  })

  function setIcon(next: { blob: Blob; url: string } | null | undefined) {
    if (icon) URL.revokeObjectURL(icon.url)
    icon = next
  }

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

  function removeIcon() {
    iconError = null
    setIcon(guild.info.icon ? null : undefined)
  }

  function reset() {
    name = null
    iconError = null
    setIcon(undefined)
  }

  async function save() {
    if (nameError || saving) return
    saving = true
    try {
      const patch: { name?: string; icon?: string | null } = {}
      const nextName = name === null ? guild.info.name : cleanName(name)
      if (nextName !== guild.info.name) patch.name = nextName
      if (icon === null) patch.icon = null
      else if (icon) patch.icon = (await client.api!.uploadGuildIcon(icon.blob)).id
      if (patch.name === undefined && patch.icon === undefined) return reset()
      guild.updateGuild(patch)
      const ok = await settled(
        () => (patch.name === undefined || guild.info.name === patch.name) && (patch.icon === undefined || guild.info.icon === patch.icon),
      )
      if (ok) reset()
    } catch (err) {
      client.toast((err as Error).message || 'Não deu pra salvar agora.')
    } finally {
      saving = false
    }
  }

  function leave() {
    const { id, info } = guild
    confirmAction({
      title: `Sair de ${info.name}?`,
      description: 'Pra voltar, só com um convite novo.',
      confirm: 'Sair',
      onconfirm: async () => {
        ui.guildSettings = null
        try {
          await client.leaveGuild(id)
        } catch (err) {
          client.toast((err as Error).message)
        }
      },
    })
  }
</script>

<PageHeader title="Visão geral" />

<Section>
  <Row stack>
    <div class="identity">
      {#if canEdit}
        <button class="icon-edit" type="button" aria-label="Trocar ícone" onclick={chooseIcon}>
          <Avatar id={guild.id} name={cleanName(shownName) || guild.info.name} size={88} square src={iconUrl} cutout="var(--bg-raised)" />
          <span class="icon-overlay" aria-hidden="true"><Icon name="photo" size={20} /></span>
        </button>
      {:else}
        <Avatar id={guild.id} name={guild.info.name} size={88} square src={iconUrl} cutout="var(--bg-raised)" />
      {/if}

      <div class="identity-fields">
        {#if canEdit}
          <TextField
            label="Nome do servidor"
            bind:value={() => shownName, (v) => (name = v)}
            maxlength={100}
            spellcheck={false}
            error={nameError}
          />
          {#if iconError}
            <p class="hint error" role="alert"><Icon name="circle-alert" size={14} />{iconError}</p>
          {:else}
            <p class="hint">Imagem quadrada, de pelo menos 512 px.</p>
          {/if}
          <div class="identity-actions">
            <Button size="sm" icon="upload" onclick={chooseIcon}>{iconUrl ? 'Trocar ícone' : 'Escolher ícone'}</Button>
            {#if iconUrl}<Button size="sm" variant="ghost" onclick={removeIcon}>Remover</Button>{/if}
          </div>
        {:else}
          <h2 class="guild-name">{guild.info.name}</h2>
          <p class="hint tabular">{plural(memberCount, 'membro', 'membros')}</p>
        {/if}
      </div>
    </div>
  </Row>
</Section>

{#if guild.isOwner}
  <Section title="Zona de perigo">
    <Row
      label="Transferir o servidor"
      description={memberCount > 1 ? 'Outra pessoa vira a dona. Você continua como membro.' : 'Só dá pra passar pra alguém que já está no servidor.'}
    >
      <Button onclick={() => (dialog = 'transfer')} disabled={memberCount < 2}>Transferir</Button>
    </Row>
    <Row label="Excluir o servidor" description="Apaga canais, mensagens e arquivos. Não dá pra desfazer.">
      <Button variant="danger-soft" icon="trash" onclick={() => (dialog = 'delete')}>Excluir</Button>
    </Row>
  </Section>
{:else}
  <Section>
    <Row label="Sair do servidor" description="Pra voltar, só com um convite novo.">
      <Button variant="danger-soft" icon="door-open" onclick={leave}>Sair</Button>
    </Row>
  </Section>
{/if}

{#if changed}
  <SaveBar {saving} nudge={unsaved.nudge} disabled={!!nameError} onreset={reset} onsave={save} />
{/if}

{#if dialog === 'transfer'}
  <TransferModal {guild} onclose={() => (dialog = null)} />
{:else if dialog === 'delete'}
  <DeleteGuildModal {guild} onclose={() => (dialog = null)} />
{/if}

<style>
  .identity {
    display: flex;
    align-items: flex-start;
    gap: var(--s-5);
  }

  .icon-edit {
    position: relative;
    flex: none;
    border-radius: 30%;
  }

  .icon-overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border-radius: 30%;
    background: color-mix(in srgb, var(--bg-canvas) 60%, transparent);
    color: var(--fg);
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  .icon-edit:hover .icon-overlay,
  .icon-edit:focus-visible .icon-overlay {
    opacity: 1;
  }

  .identity-fields {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .guild-name {
    padding-top: var(--s-5);
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.015em;
  }

  .hint {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .hint.error {
    color: var(--red);
  }

  .identity-actions {
    display: flex;
    gap: 6px;
  }
</style>
