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

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else container?.requestFullscreen()
  }

  function describe(s: VideoStats) {
    return `${s.width}×${s.height} · ${s.fps} fps · ${formatBitrate(s.bitrate)} · ${s.codec}`
  }
</script>

<svelte:document onfullscreenchange={() => (fullscreen = !!document.fullscreenElement)} />

<div class="stream" class:full class:mini={!full} bind:this={container}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} autoplay playsinline ondblclick={toggleFullscreen}></video>

  {#if !stream}
    <div class="waiting">Conectando à transmissão…</div>
  {/if}

  {#if !full}
    <button class="expand-hit" aria-label="Abrir transmissão" onclick={() => (store.view = 'stream')}></button>
  {/if}

  <div class="bar">
    {#if user && sharer}
      <Avatar id={sharer.userId} name={user.name} size={24} />
      <span class="who">{self ? 'Sua tela' : user.name}</span>
      <span class="live">AO VIVO</span>
    {/if}
    <span class="spacer"></span>

    {#if full && !self}
      <div class="volume">
        <button
          class="icon-btn"
          title="Som da transmissão"
          onclick={() => (settings.streamVolume = settings.streamVolume > 0 ? 0 : 1)}
        >
          <Icon name={settings.streamVolume > 0 ? 'volume' : 'volume-off'} />
        </button>
        <input type="range" min="0" max="1" step="0.01" bind:value={settings.streamVolume} />
      </div>
    {/if}
    {#if full}
      <button class="icon-btn" class:active={settings.showStats} title="Estatísticas" onclick={() => (settings.showStats = !settings.showStats)}>
        <Icon name="stats" />
      </button>
      <button class="icon-btn" title="Voltar pro chat (miniatura)" onclick={() => (store.view = 'chat')}>
        <Icon name="pip" />
      </button>
      <button class="icon-btn" title="Tela cheia" onclick={toggleFullscreen}>
        <Icon name={fullscreen ? 'shrink' : 'expand'} />
      </button>
    {/if}
    <button class="icon-btn" title="Parar de assistir" onclick={() => call.unwatch()}><Icon name="x" /></button>
  </div>

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
    right: 20px;
    bottom: 84px;
    width: 360px;
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
  }

  .expand-hit {
    position: absolute;
    inset: 0;
  }

  .bar {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: linear-gradient(rgb(0 0 0 / 0.7), transparent);
    opacity: 0;
    transition: opacity 150ms;
  }

  .stream:hover .bar,
  .mini .bar {
    opacity: 1;
  }

  .mini .bar {
    padding: 6px 8px;
  }

  .who {
    font-weight: 700;
  }

  .spacer {
    flex: 1;
  }

  .bar .icon-btn {
    color: #e8e8ee;
  }

  .bar .icon-btn:hover,
  .bar .icon-btn.active {
    background: rgb(255 255 255 / 0.14);
  }

  .volume {
    display: flex;
    align-items: center;
  }

  .volume input {
    width: 100px;
    accent-color: var(--accent);
  }

  .stats {
    position: absolute;
    left: 12px;
    bottom: 12px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgb(0 0 0 / 0.7);
    font: 12px/1.6 var(--mono);
    color: #d6f5e3;
    pointer-events: none;
  }
</style>
