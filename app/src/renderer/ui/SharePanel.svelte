<script lang="ts">
  import { m } from '../lib/i18n.svelte'
  import { settings, type ScreenMode, type ScreenPreset } from '../lib/settings.svelte'
  import { client } from '../lib/client.svelte'
  import { ui } from '../lib/ui.svelte'
  import { Avatar, Button, Popover, Segmented, Spinner, Switch, tooltip } from './kit'

  /** O dock: o painel abre logo acima dele, com a mesma largura. */
  let { anchor }: { anchor?: HTMLElement } = $props()

  const call = client.call
  const width = $derived(anchor?.offsetWidth ?? 232)
  const viewers = $derived(call.viewerIds)
  const viewerNames = $derived(viewers.map((id) => client.user(id, call.guildId)?.name ?? m.app.someone).join(', '))
  const t = $derived(m.app.sharePanel)

  const qualities: { value: ScreenPreset; label: string }[] = [
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '1440p', label: '1440p' },
  ]
  const modes = $derived(
    (['motion', 'detail'] as const).map((value): { value: ScreenMode; label: string } => ({ value, label: m.app.share.modes[value] })),
  )

  const ink = call.ink
  /** Aviso embaixo da chave dos rabiscos, quando eles não estão funcionando. */
  const inkNote = $derived(
    ink.status === 'window' || ink.status === 'unsupported' || ink.status === 'failed' ? t.inkNotes[ink.status] : null,
  )

  function close() {
    ui.sharePanel = false
  }
</script>

<!-- Qualquer mudança vale na hora pra quem está assistindo, sem reiniciar a transmissão. -->
<Popover {anchor} placement="top-start" {width} onclose={close} label={t.label} class="share-panel">
  <div class="panel">
    <div class="head">
      <span class="live-dot"></span>
      <span class="title">{t.live}</span>
      {#if viewers.length}
        <span class="faces" use:tooltip={viewerNames}>
          {#each viewers.slice(0, 4) as id (id)}
            <Avatar {id} name={client.user(id, call.guildId)?.name ?? '?'} size={20} src={client.avatarOf(id, call.guildId)} cutout="var(--bg-raised)" />
          {/each}
        </span>
      {/if}
      <span class="viewers" class:with-faces={viewers.length > 0}>
        {t.viewers(call.viewerCount)}
      </span>
    </div>

    <div class="option">
      <span class="label">{m.app.share.quality}</span>
      <Segmented label={m.app.share.quality} options={qualities} bind:value={settings.screenPreset} onchange={() => call.updateShare()} />
    </div>

    <div class="option">
      <span class="label">{m.app.share.priority}</span>
      <Segmented label={m.app.share.priority} options={modes} bind:value={settings.screenMode} onchange={() => call.updateShare()} />
    </div>

    <div class="option">
      <label class="ink-head">
        <span class="label">{t.ink}</span>
        <Switch size="sm" checked={settings.inkAllowed} onchange={(e) => ink.setEnabled(e.currentTarget.checked)} />
      </label>
      {#if settings.inkAllowed && ink.status !== 'off'}
        {#if inkNote}<span class="note">{inkNote}</span>{/if}
        {#if ink.status === 'starting'}<span class="note"><Spinner size={12} /> {t.opening}</span>{/if}
        {#if ink.status === 'on'}
          <Button size="sm" variant="secondary" icon="eraser" full onclick={() => ink.clear()}>{t.clearInk}</Button>
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
        }}>{t.watchMine}</Button
      >
      <Button
        variant="danger-soft"
        icon="screen-off"
        full
        onclick={() => {
          call.stopShare()
          close()
        }}>{t.stop}</Button
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
