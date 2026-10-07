<script lang="ts">
  import { plural } from '../lib/format'
  import { settings, type ScreenMode, type ScreenPreset } from '../lib/settings.svelte'
  import { client } from '../lib/client.svelte'
  import { ui } from '../lib/ui.svelte'
  import { Avatar, Button, Popover, Segmented, Spinner, Switch, tooltip } from './kit'

  /** O dock: o painel abre logo acima dele, com a mesma largura. */
  let { anchor }: { anchor?: HTMLElement } = $props()

  const call = client.call
  const width = $derived(anchor?.offsetWidth ?? 232)
  const viewers = $derived(call.viewerIds)
  const viewerNames = $derived(viewers.map((id) => client.user(id, call.guildId)?.name ?? 'Alguém').join(', '))

  const qualities: { value: ScreenPreset; label: string }[] = [
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '1440p', label: '1440p' },
  ]
  const modes: { value: ScreenMode; label: string }[] = [
    { value: 'motion', label: 'Fluidez' },
    { value: 'detail', label: 'Nitidez' },
  ]

  const ink = call.ink
  /** Os monitores pela posição (esquerda pra direita), que o nome do modelo às vezes repete. */
  const monitorOptions = $derived(
    ink.monitors.map((m, i, all) => ({
      value: m.connector,
      label: all.length === 2 ? (i === 0 ? 'Esquerda' : 'Direita') : `Monitor ${i + 1}`,
    })),
  )
  const inkNote: Partial<Record<typeof ink.status, string>> = {
    window: 'Só funciona compartilhando a tela inteira.',
    unsupported: 'Seu sistema não deixa desenhar por cima da tela (falta o gtk4-layer-shell, ou é GNOME).',
    failed: 'Não deu pra abrir a camada dos rabiscos.',
    choose: 'Qual monitor você está compartilhando?',
  }

  function close() {
    ui.sharePanel = false
  }
</script>

<!-- Qualquer mudança vale na hora pra quem está assistindo, sem reiniciar a transmissão. -->
<Popover {anchor} placement="top-start" {width} onclose={close} label="Transmissão" class="share-panel">
  <div class="panel">
    <div class="head">
      <span class="live-dot"></span>
      <span class="title">Ao vivo</span>
      {#if viewers.length}
        <span class="faces" use:tooltip={viewerNames}>
          {#each viewers.slice(0, 4) as id (id)}
            <Avatar {id} name={client.user(id, call.guildId)?.name ?? '?'} size={20} src={client.avatarOf(id, call.guildId)} cutout="var(--bg-raised)" />
          {/each}
        </span>
      {/if}
      <span class="viewers" class:with-faces={viewers.length > 0}>
        {call.viewerCount === 0 ? 'ninguém assistindo' : plural(call.viewerCount, 'pessoa assistindo', 'pessoas assistindo')}
      </span>
    </div>

    <div class="option">
      <span class="label">Qualidade</span>
      <Segmented label="Qualidade" options={qualities} bind:value={settings.screenPreset} onchange={() => call.updateShare()} />
    </div>

    <div class="option">
      <span class="label">Priorizar</span>
      <Segmented label="Priorizar" options={modes} bind:value={settings.screenMode} onchange={() => call.updateShare()} />
    </div>

    <div class="option">
      <label class="ink-head">
        <span class="label">Rabiscos de quem assiste</span>
        <Switch size="sm" checked={settings.inkAllowed} onchange={(e) => ink.setEnabled(e.currentTarget.checked)} />
      </label>
      {#if settings.inkAllowed && ink.status !== 'off'}
        {#if inkNote[ink.status]}<span class="note">{inkNote[ink.status]}</span>{/if}
        {#if ink.status === 'starting'}<span class="note"><Spinner size={12} /> Abrindo…</span>{/if}
        {#if monitorOptions.length > 1 && (ink.status === 'on' || ink.status === 'choose' || ink.status === 'starting')}
          <Segmented size="sm" label="Monitor" options={monitorOptions} value={ink.monitor?.connector ?? ''} onchange={(c) => ink.choose(c)} />
        {/if}
        {#if ink.status === 'on'}
          <Button size="sm" variant="secondary" icon="eraser" full onclick={() => ink.clear()}>Limpar rabiscos</Button>
        {/if}
      {/if}
    </div>

    <div class="actions">
      <Button
        icon="eye"
        full
        onclick={() => {
          call.watch(client.callConnId!)
          client.view = 'stream'
          close()
        }}>Ver minha tela</Button
      >
      <Button
        variant="danger-soft"
        icon="screen-off"
        full
        onclick={() => {
          call.stopShare()
          close()
        }}>Parar</Button
      >
    </div>
  </div>
</Popover>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--red);
    box-shadow: 0 0 0 3px var(--red-soft);
    animation: rs-pulse 1.6s ease-in-out infinite;
  }

  .title {
    font-weight: 600;
  }

  .faces {
    display: flex;
    margin-left: auto;
    padding-left: 6px;
  }

  .faces > :global(*) {
    margin-left: -6px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--bg-raised);
  }

  .viewers.with-faces {
    margin-left: 4px;
  }

  .viewers {
    margin-left: auto;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label {
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .ink-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
  }

  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 2px;
  }
</style>
