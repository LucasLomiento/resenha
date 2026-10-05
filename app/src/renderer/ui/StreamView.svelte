<script lang="ts">
  import { formatBitrate } from '../lib/format'
  import type { VideoStats } from '../lib/peer'
  import { settings } from '../lib/settings.svelte'
  import { store } from '../lib/store.svelte'
  import Avatar from './Avatar.svelte'
  import Icon from './Icon.svelte'

  let { full }: { full: boolean } = $props()

  const call = store.call
  const stream = $derived(call.watchedStream)
  const self = $derived(call.watching === store.connId)
  const sharer = $derived(store.voice.find((m) => m.connId === call.watching))
  const user = $derived(sharer ? store.users[sharer.userId] : null)
  const link = $derived(call.watching ? call.links[call.watching] : undefined)

  let video = $state<HTMLVideoElement>()
  let container = $state<HTMLDivElement>()
  let fullscreen = $state(false)
  let nativePip = $state(false)
  let stats = $state<{ inbound: VideoStats | null; outbound: { userId: string; stats: VideoStats }[] } | null>(null)

  $effect(() => {
    if (!video || video.srcObject === stream) return
    video.srcObject = stream
    video.play().catch(() => {})
  })

  $effect(() => {
    if (!video) return
    // A prévia da própria tela fica muda, senão o som volta pro alto-falante em dobro.
    video.muted = self || call.deafened
    video.volume = settings.streamVolume
  })

  $effect(() => {
    video?.setSinkId(settings.outputDevice === 'default' ? '' : settings.outputDevice).catch(() => {})
  })

  $effect(() => {
    if (!settings.showStats || !full) {
      stats = null
      return
    }
    const timer = setInterval(async () => (stats = await call.videoStats()), 1000)
    return () => clearInterval(timer)
  })

  // Os eventos da janela flutuante saem do próprio <video>.
  $effect(() => {
    if (!video) return
    const enter = () => (nativePip = true)
    const leave = () => (nativePip = false)
    video.addEventListener('enterpictureinpicture', enter)
    video.addEventListener('leavepictureinpicture', leave)
    return () => {
      video?.removeEventListener('enterpictureinpicture', enter)
      video?.removeEventListener('leavepictureinpicture', leave)
    }
  })

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else container?.requestFullscreen()
  }

  /** Janela flutuante do próprio sistema: fica por cima de tudo, dá pra mover e redimensionar. */
  async function togglePip() {
    if (!video) return
    if (document.pictureInPictureElement) await document.exitPictureInPicture()
    else await video.requestPictureInPicture().catch(() => store.toast('Não deu pra abrir a janela flutuante.'))
  }

  function describe(s: VideoStats) {
    return `${s.width}×${s.height} · ${s.fps} fps · ${formatBitrate(s.bitrate)} · ${s.codec}`
  }

  // ---------- Miniatura: arrastar e redimensionar ----------

  const MIN_WIDTH = 240
  let pip = $state(settings.pip ?? { x: -1, y: -1, width: 360 })

  /** Mantém a miniatura inteira dentro da janela (e no canto inferior direito na primeira vez). */
  function clamp(next: { x: number; y: number; width: number }) {
    const width = Math.min(Math.max(next.width, MIN_WIDTH), window.innerWidth - 24)
    const height = (width * 9) / 16
    const x = next.x < 0 ? window.innerWidth - width - 20 : Math.min(Math.max(next.x, 8), window.innerWidth - width - 8)
    const y = next.y < 0 ? window.innerHeight - height - 84 : Math.min(Math.max(next.y, 8), window.innerHeight - height - 8)
    return { x, y, width }
  }

  const placed = $derived(clamp(pip))

  function startDrag(event: PointerEvent, mode: 'move' | 'resize') {
    if (full || event.button !== 0) return
    if (mode === 'move' && (event.target as HTMLElement).closest('button:not(.drag-surface)')) return
    event.preventDefault()
    const start = { px: event.clientX, py: event.clientY, ...placed }
    let moved = false
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)

    const move = (e: PointerEvent) => {
      const dx = e.clientX - start.px
      const dy = e.clientY - start.py
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
      pip =
        mode === 'move'
          ? { x: start.x + dx, y: start.y + dy, width: start.width }
          : { x: start.x, y: start.y, width: start.width + dx }
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      pip = clamp(pip)
      settings.pip = { ...pip }
      // Clique sem arrastar na miniatura abre a transmissão grande.
      if (!moved && mode === 'move') store.view = 'stream'
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }
</script>

<svelte:document onfullscreenchange={() => (fullscreen = !!document.fullscreenElement)} />
<svelte:window onresize={() => (pip = clamp(pip))} />

<div
  class="stream"
  class:full
  class:mini={!full}
  bind:this={container}
  style:left={full ? null : `${placed.x}px`}
  style:top={full ? null : `${placed.y}px`}
  style:width={full ? null : `${placed.width}px`}
>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} autoplay playsinline ondblclick={toggleFullscreen}></video>

  {#if !stream}
    <div class="waiting">Conectando à transmissão…</div>
  {:else if nativePip}
    <div class="waiting">Na janela flutuante</div>
  {/if}

  {#if !full}
    <button
      class="drag-surface"
      aria-label="Arraste pra mover, clique pra abrir"
      onpointerdown={(e) => startDrag(e, 'move')}
    ></button>
  {/if}

  <div class="who">
    {#if user && sharer}
      <Avatar id={sharer.userId} name={user.name} size={22} />
      <span>{self ? 'Sua tela' : user.name}</span>
      <span class="live">AO VIVO</span>
    {/if}
  </div>

  <!-- Controles sempre centralizados embaixo, na mesma ordem, em qualquer tamanho de tela. -->
  <div class="controls">
    {#if full}
      <div class="volume" class:disabled={self}>
        <button
          class="icon-btn"
          title={self ? 'Sua prévia fica sem som' : 'Som da transmissão'}
          disabled={self}
          onclick={() => (settings.streamVolume = settings.streamVolume > 0 ? 0 : 1)}
        >
          <Icon name={self || settings.streamVolume === 0 ? 'volume-off' : 'volume'} />
        </button>
        <input type="range" min="0" max="1" step="0.01" disabled={self} bind:value={settings.streamVolume} />
      </div>
      <button class="icon-btn" class:active={settings.showStats} title="Estatísticas" onclick={() => (settings.showStats = !settings.showStats)}>
        <Icon name="stats" />
      </button>
    {/if}
    <button class="icon-btn" class:active={nativePip} title="Janela flutuante (fica por cima de tudo)" onclick={togglePip}>
      <Icon name="pip" />
    </button>
    {#if full}
      <button class="icon-btn" title="Miniatura (volta pro chat)" onclick={() => (store.view = 'chat')}>
        <Icon name="shrink" />
      </button>
      <button class="icon-btn" title="Tela cheia" onclick={toggleFullscreen}>
        <Icon name={fullscreen ? 'shrink' : 'expand'} />
      </button>
    {:else}
      <button class="icon-btn" title="Abrir grande" onclick={() => (store.view = 'stream')}>
        <Icon name="expand" />
      </button>
    {/if}
    <button class="icon-btn stop" title="Parar de assistir" onclick={() => call.unwatch()}><Icon name="x" /></button>
  </div>

  {#if !full}
    <button class="resize" aria-label="Redimensionar" title="Arraste pra redimensionar" onpointerdown={(e) => startDrag(e, 'resize')}
    ></button>
  {/if}

  {#if stats}
    <div class="stats">
      {#if stats.inbound}
        <div>{describe(stats.inbound)}</div>
        <div>
          {#if stats.inbound.implementation !== '?'}decodificador {stats.inbound.implementation} ·{/if}
          buffer {stats.inbound.jitterBuffer ?? 0} ms
          {#if stats.inbound.dropped}· {stats.inbound.dropped} quadros perdidos{/if}
        </div>
        {#if link?.rtt != null}<div>ping {link.rtt} ms · {link.route}</div>{/if}
      {/if}
      {#each stats.outbound as out (out.userId)}
        <div>
          → {store.users[out.userId]?.name}: {describe(out.stats)}{out.stats.implementation !== '?' ? ` · ${out.stats.implementation}` : ''}
          {#if out.stats.limitation && out.stats.limitation !== 'none'}· limitado por {out.stats.limitation}{/if}
        </div>
      {/each}
      {#if self && stats.outbound.length === 0}<div>Ninguém assistindo agora.</div>{/if}
    </div>
  {/if}
</div>

<style>
  .stream {
    background: #000;
    overflow: hidden;
  }

  .full {
    position: absolute;
    inset: 0;
    z-index: 10;
  }

  .mini {
    position: fixed;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.55);
    border: 1px solid var(--border);
    z-index: 30;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .waiting {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    pointer-events: none;
  }

  .drag-surface {
    position: absolute;
    inset: 0;
    cursor: grab;
  }

  .drag-surface:active {
    cursor: grabbing;
  }

  .who {
    position: absolute;
    top: 10px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px 4px 4px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.55);
    font-weight: 700;
    pointer-events: none;
    opacity: 0;
    transition: opacity 150ms;
  }

  .controls {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: 12px;
    background: rgb(16 17 21 / 0.82);
    border: 1px solid rgb(255 255 255 / 0.08);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
    white-space: nowrap;
    opacity: 0;
    transition: opacity 150ms;
  }

  .mini .controls {
    bottom: 8px;
    padding: 2px;
  }

  .stream:hover .controls,
  .stream:hover .who,
  .stream:focus-within .controls {
    opacity: 1;
  }

  .controls .icon-btn {
    color: #e8e8ee;
  }

  .controls .icon-btn:hover:not(:disabled),
  .controls .icon-btn.active {
    background: rgb(255 255 255 / 0.14);
  }

  .stop:hover {
    color: var(--red) !important;
  }

  .volume {
    display: flex;
    align-items: center;
    padding-right: 6px;
  }

  .volume input {
    width: 100px;
    accent-color: var(--accent);
  }

  .volume.disabled input {
    opacity: 0.4;
  }

  .resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 18px;
    height: 18px;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, rgb(255 255 255 / 0.35) 50%);
    border-bottom-right-radius: 12px;
  }

  .stats {
    position: absolute;
    left: 12px;
    top: 48px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgb(0 0 0 / 0.7);
    font: 12px/1.6 var(--mono);
    color: #d6f5e3;
    pointer-events: none;
  }
</style>
