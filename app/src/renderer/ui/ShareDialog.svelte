<script lang="ts">
  import { onMount } from 'svelte'
  import type { CaptureSource } from '../../preload/api'
  import { PRESETS, settings, type ScreenPreset } from '../lib/settings.svelte'
  import { store } from '../lib/store.svelte'
  import { ui } from '../lib/ui.svelte'
  import Icon from './Icon.svelte'
  import Modal from './Modal.svelte'

  const platform = store.platform!
  let sources = $state<CaptureSource[]>([])
  let selected = $state<string | null>(null)
  let loading = $state(!platform.portalPicker)
  let starting = $state(false)

  const audioNote = $derived(
    {
      venmic: 'Som de todos os apps, menos o da call.',
      'exclude-self': 'Som do sistema, menos o da call.',
      'loopback-all': 'Este Windows não separa o som do app: a voz da call vai junto.',
      none: 'Sem áudio da tela neste sistema.',
    }[platform.screenAudio],
  )

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
    await store.call.startShare(platform.portalPicker ? null : selected)
    starting = false
  }
</script>

<Modal title="Compartilhar tela" onclose={() => (ui.share = false)} width={platform.portalPicker ? 460 : 720}>
  {#if !platform.portalPicker}
    {#if loading}
      <p class="dim">Procurando telas e janelas…</p>
    {:else}
      <div class="grid">
        {#each sources as source (source.id)}
          <button class="source" class:selected={selected === source.id} onclick={() => (selected = source.id)} ondblclick={start}>
            <img src={source.thumbnail} alt="" />
            <span>{source.name}</span>
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="dim">Depois de confirmar, o seletor do sistema pergunta qual tela ou janela compartilhar.</p>
  {/if}

  <div class="options">
    <div class="option">
      <span class="label">Qualidade · sempre 60 fps</span>
      <div class="segmented">
        {#each Object.entries(PRESETS) as [key, preset] (key)}
          <button class:on={settings.screenPreset === key} onclick={() => (settings.screenPreset = key as ScreenPreset)}>
            {preset.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="option">
      <span class="label">Prioridade</span>
      <div class="segmented">
        <button class:on={settings.screenMode === 'motion'} onclick={() => (settings.screenMode = 'motion')}>
          Fluidez (jogo, vídeo)
        </button>
        <button class:on={settings.screenMode === 'detail'} onclick={() => (settings.screenMode = 'detail')}>
          Nitidez (texto, código)
        </button>
      </div>
    </div>

    <label class="check" class:disabled={platform.screenAudio === 'none'}>
      <input type="checkbox" bind:checked={settings.screenAudio} disabled={platform.screenAudio === 'none'} />
      <span>
        Compartilhar o áudio
        <small class:warn={platform.screenAudio === 'loopback-all'}>{audioNote}</small>
      </span>
    </label>
  </div>

  {#snippet footer()}
    <button class="btn secondary" onclick={() => (ui.share = false)}>Cancelar</button>
    <button class="btn" onclick={start} disabled={starting || (!platform.portalPicker && !selected)}>
      <Icon name="screen" size={16} />
      {platform.portalPicker ? 'Escolher e transmitir' : 'Transmitir'}
    </button>
  {/snippet}
</Modal>

<style>
  .dim {
    color: var(--text-dim);
    margin: 0 0 16px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    max-height: 340px;
    overflow-y: auto;
    margin-bottom: 18px;
  }

  .source {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border-radius: 8px;
    border: 2px solid transparent;
    background: var(--bg-deep);
    text-align: left;
  }

  .source.selected {
    border-color: var(--accent);
  }

  .source img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: contain;
    background: black;
    border-radius: 4px;
  }

  .source span {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .segmented {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 8px;
    background: var(--bg-deep);
  }

  .segmented button {
    flex: 1;
    padding: 7px 8px;
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 13px;
  }

  .segmented button.on {
    background: var(--bg-active);
    color: var(--text);
    font-weight: 600;
  }

  .check {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    cursor: pointer;
  }

  .check input {
    margin-top: 3px;
    accent-color: var(--accent);
  }

  .check span {
    display: flex;
    flex-direction: column;
  }

  .check small {
    color: var(--text-faint);
  }

  .check small.warn {
    color: var(--yellow);
  }

  .check.disabled {
    opacity: 0.5;
  }
</style>
