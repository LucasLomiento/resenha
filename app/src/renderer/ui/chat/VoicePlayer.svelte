<script lang="ts" module>
  /** Só um áudio toca por vez: dar play num pausa o outro. */
  let playingNow: HTMLAudioElement | null = null
</script>

<script lang="ts">
  import { formatSize } from '../../lib/format'
  import { settings } from '../../lib/settings.svelte'
  import { clock, isVoiceNote, voiceWave } from '../../lib/voice-note'
  import { Icon, IconButton } from '../kit'

  /**
   * Áudio no chat (mensagem de voz ou arquivo de áudio): play, a onda (que mostra o
   * progresso e dá pra clicar pra pular), o tempo, a velocidade e o botão de baixar.
   * A onda é calculada só quando o áudio aparece na tela, uma vez por anexo.
   */
  let { id, name, size, src }: { id: string; name: string; size: number; src: string } = $props()

  const BARS = 44
  const SPEEDS = [1, 1.5, 2]

  let audio = $state<HTMLAudioElement>()
  let wave = $state<HTMLElement>()
  let playing = $state(false)
  let current = $state(0)
  let duration = $state(0)
  let bars = $state<number[] | null>(null)
  let speed = $state(1)
  let failed = $state(false)
  const voice = $derived(isVoiceNote(name))
  const progress = $derived(duration ? Math.min(1, current / duration) : 0)

  // A onda só quando o áudio aparece na tela (uma conversa cheia de áudios não baixa tudo de uma vez).
  $effect(() => {
    const node = wave
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      voiceWave(id, src, BARS)
        .then((result) => {
          bars = result.bars
          if (!duration) duration = result.seconds
        })
        .catch(() => (bars = null))
    })
    observer.observe(node)
    return () => observer.disconnect()
  })

  $effect(() => {
    audio?.setSinkId(settings.outputDevice === 'default' ? '' : settings.outputDevice).catch(() => {})
  })

  // Tocando: o progresso anda a cada quadro (o timeupdate do <audio> pula de 250 em 250 ms).
  $effect(() => {
    if (!playing || !audio) return
    let frame = requestAnimationFrame(function tick() {
      current = audio!.currentTime
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  })

  function toggle() {
    if (!audio) return
    if (audio.paused) {
      if (playingNow && playingNow !== audio) playingNow.pause()
      playingNow = audio
      audio.playbackRate = speed
      void audio.play().catch(() => (failed = true))
    } else audio.pause()
  }

  function nextSpeed() {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    if (audio) audio.playbackRate = speed
  }

  function seek(event: PointerEvent) {
    if (!audio || !duration || !wave) return
    const box = wave.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    audio.currentTime = fraction * duration
    current = audio.currentTime
  }

  function seekKey(event: KeyboardEvent) {
    if (!audio || !duration) return
    const step = event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : 0
    if (!step) return
    event.preventDefault()
    audio.currentTime = Math.min(duration, Math.max(0, audio.currentTime + step))
    current = audio.currentTime
  }
</script>

<div class="voice" class:playing class:file={!voice}>
  <button class="play" aria-label={playing ? 'Pausar' : 'Ouvir'} disabled={failed} onclick={toggle}>
    <Icon name={playing ? 'pause' : 'play'} size={16} />
  </button>
  <div class="middle">
    {#if !voice}<span class="name" title={name}>{name}</span>{/if}
    <div
      bind:this={wave}
      class="wave"
      role="slider"
      tabindex="0"
      aria-label="Posição no áudio"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(current)}
      aria-valuetext={clock(current)}
      onpointerdown={seek}
      onkeydown={seekKey}
    >
      {#each bars ?? Array.from({ length: BARS }, () => 0.12) as height, i (i)}
        <span class="bar" class:done={(i + 0.5) / BARS <= progress} style:height="{Math.round(height * 100)}%"></span>
      {/each}
    </div>
  </div>
  <span class="time tabular">{failed ? 'erro' : clock(playing || current > 0 ? current : duration)}</span>
  <button class="speed tabular" aria-label="Velocidade: {speed}×" onclick={nextSpeed}>{String(speed).replace('.', ',')}×</button>
  <IconButton icon="download" label={voice ? 'Baixar o áudio (.mp3)' : `Baixar (${formatSize(size)})`} onclick={() => window.resenha.download(src)} />
  <audio
    bind:this={audio}
    {src}
    preload="metadata"
    onloadedmetadata={() => audio && Number.isFinite(audio.duration) && (duration = audio.duration)}
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    onended={() => {
      playing = false
      current = 0
      if (audio) audio.currentTime = 0
    }}
    onerror={() => (failed = true)}
  ></audio>
</div>

<style>
  .voice {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(100%, 400px);
    margin-top: 6px;
    padding: 8px 6px 8px 8px;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow: 0 0 0 1px var(--line);
  }

  .play {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    transition: transform var(--t-fast) var(--ease);
  }

  .play:hover:not(:disabled) {
    transform: scale(1.06);
  }

  .play:disabled {
    background: var(--bg-overlay);
    color: var(--fg-3);
  }

  .middle {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .wave {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 28px;
    cursor: pointer;
    touch-action: none;
  }

  .file .wave {
    height: 20px;
  }

  .wave:focus-visible {
    border-radius: var(--r-sm);
  }

  .bar {
    flex: 1;
    min-width: 2px;
    border-radius: var(--r-full);
    background: var(--fg-3);
    opacity: 0.45;
    transition: height var(--t-slow) var(--ease);
  }

  .bar.done {
    background: var(--accent-fg);
    opacity: 1;
  }

  .time {
    flex: none;
    min-width: 34px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    text-align: right;
  }

  .speed {
    flex: none;
    min-width: 32px;
    padding: 2px 6px;
    border-radius: var(--r-full);
    background: var(--bg-overlay);
    color: var(--fg-2);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .speed:hover {
    color: var(--fg);
  }
</style>
