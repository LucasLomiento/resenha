<script lang="ts">
  import { formatBitrate } from '../lib/format'
  import type { VideoStats } from '../lib/peer'
  import { settings } from '../lib/settings.svelte'
  import { client } from '../lib/client.svelte'
  import { Avatar, Badge, Icon, IconButton, Slider, Spinner } from './kit'

  let { full }: { full: boolean } = $props()

  const call = client.call
  const stream = $derived(call.watchedStream)
  const self = $derived(call.watching === client.callConnId)
  const sharer = $derived(client.callMembers.find((m) => m.connId === call.watching))
  const user = $derived(sharer ? client.user(sharer.userId, call.guildId) : null)
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
    video.muted = self || call.deafened || settings.streamMuted
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

  /** Sem som: pelo botão ou com o volume em zero. */
  const silent = $derived(settings.streamMuted || settings.streamVolume === 0)

  /** O botão tira e devolve o som sem mexer no volume escolhido. */
  function toggleSound() {
    if (silent) {
      settings.streamMuted = false
      if (settings.streamVolume === 0) settings.streamVolume = 0.5
    } else settings.streamMuted = true
  }

  /** Mexer no volume já devolve o som. */
  function setVolume(value: number) {
    settings.streamVolume = value
    if (value > 0) settings.streamMuted = false
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else container?.requestFullscreen()
  }

  /** Janela flutuante do próprio sistema: fica por cima de tudo, dá pra mover e redimensionar. */
  async function togglePip() {
    if (!video) return
    if (document.pictureInPictureElement) await document.exitPictureInPicture()
    else await video.requestPictureInPicture().catch(() => client.toast('Não deu pra abrir a janela flutuante.'))
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
    const x = next.x < 0 ? window.innerWidth - width - 24 : Math.min(Math.max(next.x, 8), window.innerWidth - width - 8)
    const y = next.y < 0 ? window.innerHeight - height - 96 : Math.min(Math.max(next.y, 8), window.innerHeight - height - 8)
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
      if (!moved && mode === 'move') client.view = 'stream'
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
    <div class="waiting"><Spinner size={18} /> Conectando à transmissão…</div>
  {:else if nativePip}
    <div class="waiting"><Icon name="pip" size={18} /> Na janela flutuante</div>
  {/if}

  {#if !full}
    <button class="drag-surface" aria-label="Abrir a transmissão (arraste pra mover)" onpointerdown={(e) => startDrag(e, 'move')}></button>
  {/if}

  {#if user && sharer}
    <div class="who">
      <Avatar id={sharer.userId} name={user.name} size={20} src={client.avatarOf(sharer.userId, call.guildId)} />
      <span>{self ? 'Sua tela' : user.name}</span>
      <Badge tone="live">AO VIVO</Badge>
    </div>
  {/if}

  <!-- Controles sempre centralizados embaixo, na mesma ordem, em qualquer tamanho de tela. -->
  <div class="controls">
    {#if full}
      <div class="volume">
        <IconButton
          variant="glass"
          icon={self || silent ? 'volume-off' : 'volume'}
          label={self ? 'Sua prévia fica sem som' : silent ? 'Ativar o som' : 'Tirar o som'}
          disabled={self}
          onclick={toggleSound}
        />
        <Slider
          label="Volume da transmissão"
          disabled={self}
          value={settings.streamMuted ? 0 : settings.streamVolume}
          oninput={(e) => setVolume(Number(e.currentTarget.value))}
        />
      </div>
      <span class="divider"></span>
      <IconButton
        variant="glass"
        icon="activity"
        label="Estatísticas"
        active={settings.showStats}
        onclick={() => (settings.showStats = !settings.showStats)}
      />
    {/if}
    <IconButton variant="glass" icon="pip" label="Janela flutuante" active={nativePip} onclick={togglePip} />
    {#if full}
      <IconButton variant="glass" icon="minimize" label="Minimizar" onclick={() => (client.view = 'chat')} />
      <IconButton variant="glass" icon="fullscreen" label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onclick={toggleFullscreen} />
    {:else}
      <IconButton variant="glass" icon="maximize" label="Ampliar" onclick={() => (client.view = 'stream')} />
    {/if}
    <span class="divider"></span>
    <IconButton variant="glass" icon="x" label="Parar de assistir" tone="danger" onclick={() => call.unwatch()} />
  </div>

  {#if !full}
    <button class="resize" aria-label="Redimensionar" onpointerdown={(e) => startDrag(e, 'resize')}></button>
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
          → {client.displayName(out.userId, call.guildId)}: {describe(out.stats)}{out.stats.implementation !== '?' ? ` · ${out.stats.implementation}` : ''}
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
    z-index: var(--z-float);
    aspect-ratio: 16 / 9;
    border-radius: var(--r-xl);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-lg);
    animation: rs-pop-in var(--t-slow) var(--ease);
  }

  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .waiting {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--fg-2);
    font-size: var(--text-sm);
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
    top: 12px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 6px 0 6px;
    border-radius: var(--r-full);
    background: rgb(10 10 14 / 0.62);
    backdrop-filter: blur(12px);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.08);
    color: #f4f4f8;
    font-size: var(--text-sm);
    font-weight: 600;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--t) var(--ease);
  }

  .mini .who {
    top: 8px;
    left: 8px;
    height: 28px;
  }

  .controls {
    position: absolute;
    left: 50%;
    bottom: 16px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: var(--r-xl);
    background: rgb(12 12 17 / 0.72);
    backdrop-filter: blur(16px);
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 0.09),
      var(--shadow-md);
    white-space: nowrap;
    translate: -50% 0;
    opacity: 0;
    transition: opacity var(--t) var(--ease);
  }

  .mini .controls {
    bottom: 8px;
    padding: 2px;
    border-radius: 12px;
  }

  .stream:hover .controls,
  .stream:hover .who,
  .stream:focus-within .controls {
    opacity: 1;
  }

  .divider {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: rgb(255 255 255 / 0.12);
  }

  .volume {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 8px;
  }

  .volume :global(.slider) {
    width: 96px;
  }

  .resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 20px;
    height: 20px;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 55%, rgb(255 255 255 / 0.4) 55%, rgb(255 255 255 / 0.4) 62%, transparent 62%, transparent 72%, rgb(255 255 255 / 0.4) 72%, rgb(255 255 255 / 0.4) 79%, transparent 79%);
    border-bottom-right-radius: var(--r-xl);
    opacity: 0;
    transition: opacity var(--t) var(--ease);
  }

  .mini:hover .resize {
    opacity: 1;
  }

  .stats {
    position: absolute;
    left: 12px;
    top: 56px;
    padding: 10px 12px;
    border-radius: var(--r-lg);
    background: rgb(10 10 14 / 0.72);
    backdrop-filter: blur(12px);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.08);
    color: #c9f7e2;
    font: 12px/1.65 var(--mono);
    pointer-events: none;
  }
</style>
