<script lang="ts">
  // Qual câmera ligar, quando tem mais de uma (com uma só, a dock liga direto). Como no
  // compartilhar tela: cada uma aparece ao vivo e a escolhida vira a câmera das configurações.
  import { onDestroy, onMount } from 'svelte'
  import { client } from '../lib/client.svelte'
  import { listDevices, namedDevices } from '../lib/devices'
  import { m } from '../lib/i18n.svelte'
  import { settings } from '../lib/settings.svelte'
  import { ui } from '../lib/ui.svelte'
  import { Button, Icon, Modal, Spinner } from './kit'
  import VideoTile from './VideoTile.svelte'

  interface Camera {
    id: string
    /** Vazio sem permissão: aí aparece "Câmera 1", "Câmera 2"… */
    name: string
    stream: MediaStream | null
    /** Não abriu (em uso por outro app, desconectada). */
    failed: boolean
  }

  const t = $derived(m.app.camera)
  const call = client.call
  let cameras = $state<Camera[]>([])
  let selected = $state<string | null>(null)
  let loading = $state(true)
  let starting = $state(false)
  let gone = false

  /** Prévia pequena: só pra reconhecer qual é qual. */
  const PREVIEW: MediaTrackConstraints = { width: { ideal: 480 }, height: { ideal: 270 }, frameRate: { ideal: 15, max: 15 } }

  onMount(async () => {
    const found = namedDevices((await listDevices()).cameras)
    if (gone) return
    cameras = found.map((d) => ({ id: d.deviceId, name: d.label, stream: null, failed: false }))
    selected = cameras.some((c) => c.id === settings.cameraDevice) ? settings.cameraDevice : (cameras[0]?.id ?? null)
    loading = false
    // Uma de cada vez: duas câmeras USB no mesmo hub às vezes não abrem ao mesmo tempo.
    for (const camera of cameras) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { ...PREVIEW, deviceId: { exact: camera.id } } })
        if (gone) {
          for (const track of stream.getTracks()) track.stop()
          return
        }
        camera.stream = stream
      } catch {
        camera.failed = true
      }
    }
  })

  function stopPreviews() {
    for (const camera of cameras) {
      for (const track of camera.stream?.getTracks() ?? []) track.stop()
      camera.stream = null
    }
  }

  onDestroy(() => {
    gone = true
    stopPreviews()
  })

  // Saiu da call com o diálogo aberto: não tem mais onde ligar.
  $effect(() => {
    if (!call.channelId) ui.camera = false
  })

  async function start() {
    if (!selected || starting) return
    starting = true
    // A prévia solta a câmera antes de ela abrir de verdade, em alta resolução.
    stopPreviews()
    settings.cameraDevice = selected
    await call.toggleCamera()
    starting = false
    ui.camera = false
    if (call.camera) client.view = 'call'
  }
</script>

<Modal title={t.title} size="lg" onclose={() => (ui.camera = false)}>
  {#if loading}
    <div class="loading"><Spinner size={20} /></div>
  {:else}
    <div class="grid" role="listbox" aria-label={t.sources}>
      {#each cameras as camera, i (camera.id)}
        <button
          class="camera"
          class:selected={selected === camera.id}
          role="option"
          aria-selected={selected === camera.id}
          onclick={() => (selected = camera.id)}
          ondblclick={start}
        >
          <span class="preview">
            {#if camera.stream}
              <VideoTile stream={camera.stream} mirror />
            {:else if camera.failed}
              <span class="empty"><Icon name="camera-off" size={22} /><span>{t.noPreview}</span></span>
            {:else}
              <span class="empty"><Spinner size={18} /></span>
            {/if}
          </span>
          <span class="name">
            <Icon name="camera" size={14} />
            <span>{camera.name || t.unnamed(i + 1)}</span>
          </span>
        </button>
      {/each}
    </div>
  {/if}

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (ui.camera = false)}>{m.common.cancel}</Button>
    <Button variant="primary" icon="camera" loading={starting} disabled={!selected} onclick={start}>{t.start}</Button>
  {/snippet}
</Modal>

<style>
  .loading {
    display: grid;
    place-items: center;
    height: 180px;
    color: var(--fg-3);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    max-height: 420px;
    margin: 0 -4px;
    padding: 4px;
    overflow-y: auto;
  }

  .camera {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    text-align: left;
  }

  .preview {
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: var(--r-lg);
    background: #000;
    box-shadow: 0 0 0 1px var(--line-strong);
    overflow: hidden;
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .camera:hover .preview {
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.25);
  }

  .camera.selected .preview {
    box-shadow:
      0 0 0 2px var(--accent-fg),
      0 0 0 5px rgb(var(--accent-rgb) / 0.2);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    padding: 0 16px;
    background: var(--bg-input);
    color: var(--fg-3);
    font-size: var(--text-xs);
    text-align: center;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .camera.selected .name {
    color: var(--fg);
  }
</style>
