<script lang="ts">
  import { plural } from '../lib/format'
  import { settings, type ScreenMode, type ScreenPreset } from '../lib/settings.svelte'
  import { store } from '../lib/store.svelte'
  import { ui } from '../lib/ui.svelte'
  import { Button, Popover, Segmented } from './kit'

  /** O dock: o painel abre logo acima dele, com a mesma largura. */
  let { anchor }: { anchor?: HTMLElement } = $props()

  const call = store.call
  const width = $derived(anchor?.offsetWidth ?? 232)

  const qualities: { value: ScreenPreset; label: string }[] = [
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '1440p', label: '1440p' },
  ]
  const modes: { value: ScreenMode; label: string }[] = [
    { value: 'motion', label: 'Fluidez' },
    { value: 'detail', label: 'Nitidez' },
  ]

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
      <span class="viewers">
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

    <div class="actions">
      <Button
        icon="eye"
        full
        onclick={() => {
          call.watch(store.connId!)
          store.view = 'stream'
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

  .actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 2px;
  }
</style>
