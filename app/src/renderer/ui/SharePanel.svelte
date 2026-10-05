<script lang="ts">
  import { PRESETS, settings, type ScreenPreset, type VideoCodec } from '../lib/settings.svelte'
  import { store } from '../lib/store.svelte'
  import { ui } from '../lib/ui.svelte'
  import Icon from './Icon.svelte'

  const call = store.call

  // Qualquer mudança vale na hora pra quem está assistindo, sem reiniciar a transmissão.
  function change(apply: () => void) {
    apply()
    call.updateShare()
  }

  function close(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (!target.closest('.share-panel') && !target.closest('.voice-panel')) ui.sharePanel = false
  }
</script>

<svelte:window onmousedown={close} onkeydown={(e) => e.key === 'Escape' && (ui.sharePanel = false)} />

<div class="share-panel" role="dialog" aria-label="Transmissão">
  <div class="head">
    <span class="live">AO VIVO</span>
    <span class="viewers">{call.viewerCount === 1 ? '1 pessoa assistindo' : `${call.viewerCount} pessoas assistindo`}</span>
  </div>

  <span class="label">Qualidade · 60 fps</span>
  <div class="segmented">
    {#each Object.entries(PRESETS) as [key, preset] (key)}
      <button class:on={settings.screenPreset === key} onclick={() => change(() => (settings.screenPreset = key as ScreenPreset))}>
        {preset.label.replace(' (QHD)', '')}
      </button>
    {/each}
  </div>

  <span class="label">Prioridade</span>
  <div class="segmented">
    <button class:on={settings.screenMode === 'motion'} onclick={() => change(() => (settings.screenMode = 'motion'))}>Fluidez</button>
    <button class:on={settings.screenMode === 'detail'} onclick={() => change(() => (settings.screenMode = 'detail'))}>Nitidez</button>
  </div>

  <span class="label">Codec</span>
  <div class="segmented">
    {#each ['VP9', 'VP8', 'H264', 'AV1'] as codec (codec)}
      <button class:on={settings.codec === codec} onclick={() => change(() => (settings.codec = codec as VideoCodec))}>{codec}</button>
    {/each}
  </div>

  <div class="actions">
    <button
      class="btn secondary"
      onclick={() => {
        call.watch(store.connId!)
        store.view = 'stream'
        ui.sharePanel = false
      }}><Icon name="eye" size={16} />Ver minha tela</button
    >
    <button
      class="btn danger"
      onclick={() => {
        call.stopShare()
        ui.sharePanel = false
      }}><Icon name="screen-off" size={16} />Parar</button
    >
  </div>
</div>

<style>
  .share-panel {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 128px;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border-radius: 12px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.5);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .viewers {
    color: var(--text-dim);
    font-size: 13px;
  }

  .segmented {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 3px;
    padding: 3px;
    border-radius: 8px;
    background: var(--bg-deep);
  }

  .segmented button {
    padding: 6px 4px;
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .segmented button.on {
    background: var(--bg-active);
    color: var(--text);
    font-weight: 600;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 6px;
  }

  .actions .btn {
    padding: 7px 8px;
    font-size: 13px;
  }
</style>
