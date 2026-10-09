<script lang="ts">
  import { onMount } from 'svelte'
  import type { CaptureSource } from '../../preload/api'
  import { settings, type ScreenMode, type ScreenPreset } from '../lib/settings.svelte'
  import { client } from '../lib/client.svelte'
  import { m } from '../lib/i18n.svelte'
  import { ui } from '../lib/ui.svelte'
  import { Button, Icon, IconButton, Modal, Segmented, Spinner, Switch, Tabs } from './kit'

  const platform = client.platform!
  let sources = $state<CaptureSource[]>([])
  let selected = $state<string | null>(null)
  let loading = $state(!platform.portalPicker)
  let starting = $state(false)
  let kind = $state<'screen' | 'window'>('screen')

  let playing = $state<{ binary: string; name: string; voice: boolean }[]>([])
  let loadingApps = $state(false)

  const t = $derived(m.app.share)
  const qualities = $derived(
    (['720p', '1080p', '1440p'] as const).map((value): { value: ScreenPreset; label: string; hint: string } => ({
      value,
      label: value,
      hint: t.qualityHints[value],
    })),
  )
  const modes = $derived(
    (['motion', 'detail'] as const).map((value): { value: ScreenMode; label: string; hint: string } => ({
      value,
      label: t.modes[value],
      hint: t.modeHints[value],
    })),
  )

  const screens = $derived(sources.filter((s) => s.kind === 'screen'))
  const windows = $derived(sources.filter((s) => s.kind === 'window'))
  const shown = $derived(screens.length && windows.length ? (kind === 'screen' ? screens : windows) : sources)

  const audioNote = $derived(t.audioNotes[platform.screenAudio])

  async function loadApps() {
    if (platform.screenAudio !== 'venmic') return
    loadingApps = true
    try {
      playing = await window.resenha.screenAudio.apps()
    } finally {
      loadingApps = false
    }
  }

  function toggleApp(binary: string) {
    settings.screenAudioApps = settings.screenAudioApps.includes(binary)
      ? settings.screenAudioApps.filter((app) => app !== binary)
      : [...settings.screenAudioApps, binary]
  }

  // Só consulta o PipeWire quando a pessoa quer escolher os apps.
  $effect(() => {
    if (settings.screenAudio && settings.screenAudioMode === 'apps') loadApps()
  })

  onMount(async () => {
    if (platform.portalPicker) return
    try {
      sources = await window.resenha.share.sources()
      selected = sources.find((s) => s.kind === 'screen')?.id ?? sources[0]?.id ?? null
    } finally {
      loading = false
    }
  })

  async function start() {
    starting = true
    ui.share = false
    await client.call.startShare(platform.portalPicker ? null : selected)
    starting = false
  }
</script>

<Modal title={t.title} size={platform.portalPicker ? 'lg' : 'xl'} onclose={() => (ui.share = false)}>
  {#if !platform.portalPicker}
    {#if screens.length && windows.length}
      <Tabs
        label={t.kind}
        class="kind-tabs"
        tabs={[
          { value: 'screen', label: t.screens, count: screens.length },
          { value: 'window', label: t.windows, count: windows.length },
        ]}
        bind:value={kind}
      />
    {/if}
    {#if loading}
      <div class="sources-loading"><Spinner size={20} /></div>
    {:else}
      <div class="grid" role="listbox" aria-label={t.sources}>
        {#each shown as source (source.id)}
          <button
            class="source"
            class:selected={selected === source.id}
            role="option"
            aria-selected={selected === source.id}
            onclick={() => (selected = source.id)}
            ondblclick={start}
          >
            <span class="thumb"><img src={source.thumbnail} alt="" draggable="false" /></span>
            <span class="source-name">
              <Icon name={source.kind === 'screen' ? 'monitor' : 'app-window'} size={14} />
              <span>{source.name}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="portal">
      <span class="portal-icon"><Icon name="monitor" size={20} /></span>
      <p>{t.portal}</p>
    </div>
  {/if}

  <div class="options">
    <div class="option">
      <span class="label">{t.quality}</span>
      <Segmented label={t.quality} options={qualities} bind:value={settings.screenPreset} />
    </div>
    <div class="option">
      <span class="label">{t.priority}</span>
      <Segmented label={t.priority} options={modes} bind:value={settings.screenMode} />
    </div>
  </div>

  <div class="audio" class:off={platform.screenAudio === 'none'}>
    <div class="audio-row">
      <span class="audio-icon"><Icon name="volume" size={18} /></span>
      <label for="share-audio" class="audio-text">
        <span class="audio-title">{t.audio}</span>
        <span class="audio-note" class:warn={platform.screenAudio === 'loopback-all'}>{audioNote}</span>
      </label>
      <Switch id="share-audio" bind:checked={settings.screenAudio} disabled={platform.screenAudio === 'none'} />
    </div>

    {#if platform.screenAudio === 'venmic' && settings.screenAudio}
      <div class="apps">
        <Segmented
          label={t.whichApps}
          size="sm"
          options={[
            { value: 'all', label: t.allApps },
            { value: 'apps', label: t.pickApps },
          ]}
          bind:value={settings.screenAudioMode}
        />
        {#if settings.screenAudioMode === 'all'}
          <p class="apps-note">{t.voiceAppsOut}</p>
        {:else}
          <div class="chips">
            {#each playing as app (app.binary)}
              <button
                class="chip"
                class:on={settings.screenAudioApps.includes(app.binary)}
                aria-pressed={settings.screenAudioApps.includes(app.binary)}
                onclick={() => toggleApp(app.binary)}
              >
                {#if settings.screenAudioApps.includes(app.binary)}<Icon name="check" size={14} />{/if}
                {app.name}
                {#if app.voice}<span class="chip-note">{t.voiceApp}</span>{/if}
              </button>
            {:else}
              <p class="apps-note">{loadingApps ? t.lookingApps : t.noApps}</p>
            {/each}
            <IconButton icon="restart" label={t.refreshApps} size="sm" onclick={loadApps} disabled={loadingApps} />
          </div>
          {#if settings.screenAudioApps.length === 0 && playing.length}
            <p class="apps-note warn">{t.pickOne}</p>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

  <div class="audio ink">
    <div class="audio-row">
      <span class="audio-icon"><Icon name="pen" size={18} /></span>
      <label for="share-ink" class="audio-text">
        <span class="audio-title">{t.ink}</span>
        <span class="audio-note">{t.inkNote}</span>
      </label>
      <Switch id="share-ink" bind:checked={settings.inkAllowed} />
    </div>
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (ui.share = false)}>{m.common.cancel}</Button>
    <Button
      variant="primary"
      icon="screen"
      loading={starting}
      disabled={!platform.portalPicker && !selected}
      onclick={start}>{t.start}</Button
    >
  {/snippet}
</Modal>

<style>
  :global(.kind-tabs) {
    margin-bottom: 12px;
  }

  .sources-loading {
    display: grid;
    place-items: center;
    height: 180px;
    color: var(--fg-3);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    max-height: 320px;
    margin: 0 -4px 20px;
    padding: 4px;
    overflow-y: auto;
  }

  .source {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    text-align: left;
  }

  .thumb {
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: var(--r-lg);
    background: #000;
    box-shadow: 0 0 0 1px var(--line-strong);
    overflow: hidden;
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .source:hover .thumb {
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.25);
  }

  .source.selected .thumb {
    box-shadow:
      0 0 0 2px var(--accent-fg),
      0 0 0 5px rgb(122 108 255 / 0.2);
  }

  .source-name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--fg-2);
    font-size: var(--text-xs);
  }

  .source-name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source.selected .source-name {
    color: var(--fg);
  }

  .portal {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    padding: 12px 14px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.035);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-2);
  }

  .portal-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--r-lg);
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  .options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .label {
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .audio {
    margin-top: 20px;
    padding: 12px 14px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.035);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .audio.ink {
    margin-top: 10px;
  }

  .audio.off {
    opacity: 0.55;
  }

  .audio-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .audio-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.06);
    color: var(--fg-2);
  }

  .audio-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    cursor: pointer;
  }

  .audio-title {
    font-weight: 500;
  }

  .audio-note {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .warn {
    color: var(--yellow) !important;
  }

  .apps {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 12px 0 2px 48px;
  }

  .apps :global(.segmented) {
    max-width: 280px;
  }

  .apps-note {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 12px;
    border-radius: var(--r-full);
    background: rgb(255 255 255 / 0.06);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-2);
    font-size: var(--text-xs);
    font-weight: 500;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  .chip:hover {
    background: rgb(255 255 255 / 0.1);
    color: var(--fg);
  }

  .chip.on {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent-line);
    color: var(--accent-fg);
  }

  .chip-note {
    color: var(--fg-3);
    font-weight: 400;
  }
</style>
