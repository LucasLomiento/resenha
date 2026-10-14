<script lang="ts">
  import { onMount } from 'svelte'
  import { m } from '../../lib/i18n.svelte'
  import { Avatar, Badge, Icon } from '../kit'

  // A vitrine da tela de entrada: uma call, um chat, uma transmissão rabiscada e o Spotify, de
  // mentira, contando em loop o que o app faz. Só enfeite (aria-hidden no pai).

  const t = $derived(m.app.login.showcase)

  /** Um passo a cada 2,2 s: quem fala na call e até onde o chat já chegou. */
  let beat = $state(0)
  /** Volta do chat (pra as mensagens entrarem animadas de novo a cada volta). */
  const round = $derived(Math.floor(beat / 7))
  const step = $derived(beat % 7)
  const speaker = $derived(beat % 3)
  /** Quantas mensagens aparecem e quem está digitando, em cada passo da volta. */
  const shown = $derived([0, 1, 1, 2, 2, 3, 3][step])
  const typing = $derived([0, -1, 1, -1, 2, -1, -1][step])
  /** Quem manda cada mensagem (índices em `people`). */
  const AUTHORS = [1, 0, 2]

  let stage = $state<HTMLElement>()

  onMount(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      beat = 5
      return
    }
    const timer = setInterval(() => beat++, 2200)
    return () => clearInterval(timer)
  })

  /** Os cartões acompanham o mouse de leve, cada um numa profundidade. */
  function parallax(event: PointerEvent) {
    if (!stage) return
    const box = stage.getBoundingClientRect()
    stage.style.setProperty('--px', ((event.clientX - box.left) / box.width - 0.5).toFixed(3))
    stage.style.setProperty('--py', ((event.clientY - box.top) / box.height - 0.5).toFixed(3))
  }

  function settle() {
    stage?.style.setProperty('--px', '0')
    stage?.style.setProperty('--py', '0')
  }
</script>

<svelte:window onpointermove={parallax} onblur={settle} />

<div class="stage" bind:this={stage}>
  <!-- Transmissão ao vivo, com um rabisco se desenhando por cima -->
  <div class="card stream" style:--depth="14">
    <div class="game">
      <span class="sun"></span>
      <span class="hills"></span>
      <span class="road"></span>
    </div>
    <svg class="ink" viewBox="0 0 200 112" preserveAspectRatio="none">
      <path d="M92 70 C 108 42, 132 38, 146 60 S 172 90, 186 54" />
    </svg>
    <span class="ink-tag">{t.people[2]}</span>
    <div class="stream-bar">
      <Badge tone="live">{m.app.liveBadge}</Badge>
      <span class="stream-name">{t.stream}</span>
      <span class="quality">{t.quality}</span>
    </div>
  </div>

  <!-- A call: o anel de quem fala passa de um pro outro -->
  <div class="card call" style:--depth="26">
    <div class="head">
      <Icon name="volume" size={15} />
      <strong>{t.channel}</strong>
      <span class="count">{t.inCall}</span>
    </div>
    <ul>
      {#each t.people as person, i (person)}
        <li class:talking={speaker === i}>
          <Avatar id="showcase-{person}-{i}" name={person} size={30} speaking={speaker === i} cutout="var(--card-bg)" />
          <span class="who">
            {person}
            {#if i === 1}<small>{t.sharing}</small>{/if}
          </span>
          {#if speaker === i}
            <span class="voice"><i></i><i></i><i></i><i></i></span>
          {:else if i === 1}
            <span class="live-dot"></span>
          {/if}
        </li>
      {/each}
    </ul>
  </div>

  <!-- O chat: as mensagens chegam uma a uma, com o "digitando" antes -->
  <div class="card chat" style:--depth="20">
    <div class="head">
      <strong>{t.chat}</strong>
    </div>
    <div class="messages">
      {#each t.messages.slice(0, shown) as text, i (`${round}-${i}`)}
        {@const who = t.people[AUTHORS[i]]}
        <div class="message">
          <Avatar id="showcase-{who}-{AUTHORS[i]}" name={who} size={22} />
          <div>
            <b>{who}</b>
            <p>{text}</p>
          </div>
        </div>
      {/each}
      {#if typing >= 0}
        <div class="typing">
          <span class="dots"><i></i><i></i><i></i></span>
          {t.typing(t.people[AUTHORS[typing]])}
        </div>
      {/if}
    </div>
  </div>

  <!-- O bot do Spotify tocando na call -->
  <div class="card music" style:--depth="34">
    <span class="cover"><Icon name="music" size={16} /></span>
    <span class="song">
      <small>{t.music}</small>
      <b>{t.song}</b>
      <span>{t.artist}</span>
    </span>
    <span class="eq"><i></i><i></i><i></i><i></i></span>
  </div>
</div>

<style>
  .stage {
    --px: 0;
    --py: 0;
    --card-bg: #18181c;
    position: relative;
    width: min(100%, 560px);
    height: 380px;
    margin-top: 28px;
  }

  .card {
    position: absolute;
    border-radius: var(--r-xl);
    background: var(--card-bg);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      0 30px 60px -24px rgb(0 0 0 / 0.85);
    translate: calc(var(--px) * var(--depth) * 1px) calc(var(--py) * var(--depth) * 1px);
    transition: translate 600ms var(--ease);
    animation: float 8s ease-in-out infinite;
  }

  @keyframes float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }

  /* ---------- Transmissão ---------- */

  .stream {
    top: 0;
    left: 30%;
    width: 64%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    rotate: 2.5deg;
    animation-delay: -2s;
  }

  .game {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: linear-gradient(180deg, #0d2340 0%, #1d4b80 46%, #f08a4b 100%);
  }

  .sun {
    position: absolute;
    top: 30%;
    left: 58%;
    width: 22%;
    aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(circle, #ffd27a 0 45%, rgb(255 190 110 / 0) 70%);
  }

  .hills {
    position: absolute;
    left: -10%;
    right: -10%;
    bottom: 22%;
    height: 34%;
    background:
      radial-gradient(60% 100% at 25% 100%, #13305a 99%, transparent 100%),
      radial-gradient(55% 90% at 78% 100%, #0f2747 99%, transparent 100%);
  }

  /* Uma estrada andando: dá vida à "tela" sem custar nada. */
  .road {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 24%;
    background:
      repeating-linear-gradient(90deg, #f6d38a 0 16px, transparent 16px 40px) center 46% / 100% 3px no-repeat,
      #10141c;
    animation: road 1.2s linear infinite;
  }

  @keyframes road {
    to {
      background-position:
        -40px 46%,
        0 0;
    }
  }

  .ink {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: none;
    stroke: #4f8cff;
    stroke-width: 3.5;
    stroke-linecap: round;
    stroke-dasharray: 260;
    stroke-dashoffset: 260;
    filter: drop-shadow(0 0 1px #0b0b0f) drop-shadow(0 0 6px rgb(79 140 255 / 0.6));
    animation: draw 6.6s var(--ease) infinite;
  }

  @keyframes draw {
    0%,
    8% {
      stroke-dashoffset: 260;
      opacity: 1;
    }
    45%,
    80% {
      stroke-dashoffset: 0;
      opacity: 1;
    }
    95%,
    100% {
      stroke-dashoffset: 0;
      opacity: 0;
    }
  }

  /* A etiqueta com o nome fica parada no começo do traço, como na de verdade. */
  .ink-tag {
    position: absolute;
    top: 50%;
    left: 36%;
    padding: 2px 7px;
    border-radius: var(--r-full);
    background: #4f8cff;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    animation: tag 6.6s var(--ease) infinite;
  }

  @keyframes tag {
    0%,
    6% {
      opacity: 0;
      transform: scale(0.8);
    }
    12%,
    80% {
      opacity: 1;
      transform: scale(1);
    }
    95%,
    100% {
      opacity: 0;
    }
  }

  /* A barra fica em cima: embaixo os outros cartões cobrem a tela. */
  .stream-bar {
    position: absolute;
    left: 10px;
    right: 10px;
    top: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--r-full);
    background: rgb(10 10 14 / 0.62);
    backdrop-filter: blur(8px);
    color: var(--glass-fg);
    font-size: 11.5px;
    font-weight: 600;
  }

  .stream-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quality {
    color: rgb(255 255 255 / 0.65);
    font-variant-numeric: tabular-nums;
  }

  /* ---------- Call ---------- */

  .call {
    top: 96px;
    left: 0;
    width: 46%;
    padding: 12px;
    rotate: -2deg;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 4px 9px;
    border-bottom: 1px solid var(--line);
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .head strong {
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .count {
    margin-left: auto;
  }

  .call ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }

  .call li {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 42px;
    padding: 0 6px;
    border-radius: var(--r-lg);
    transition: background-color 400ms var(--ease);
  }

  .call li.talking {
    background: var(--hover);
  }

  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.2;
  }

  .who small {
    overflow: hidden;
    color: var(--fg-3);
    font-size: 11px;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .voice {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 16px;
    margin-right: 4px;
  }

  .voice i {
    width: 3px;
    height: 100%;
    border-radius: 2px;
    background: var(--green);
    animation: bar 0.9s ease-in-out infinite;
  }

  .voice i:nth-child(2) {
    animation-delay: -0.3s;
  }

  .voice i:nth-child(3) {
    animation-delay: -0.6s;
  }

  .voice i:nth-child(4) {
    animation-delay: -0.15s;
  }

  @keyframes bar {
    0%,
    100% {
      transform: scaleY(0.3);
    }
    50% {
      transform: scaleY(1);
    }
  }

  .live-dot {
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--red);
    box-shadow: 0 0 0 3px var(--red-soft);
    animation: rs-pulse 1.6s ease-in-out infinite;
  }

  /* ---------- Chat ---------- */

  .chat {
    top: 150px;
    left: 50%;
    width: 46%;
    min-height: 168px;
    padding: 12px;
    rotate: 1.5deg;
    animation-delay: -4s;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 2px 0;
  }

  .message {
    display: flex;
    gap: 9px;
    animation: rs-pop-in var(--t-slow) var(--ease);
  }

  .message b {
    display: block;
    color: var(--fg);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
  }

  .message p {
    color: #e4e4e8;
    font-size: 12.5px;
    line-height: 1.35;
  }

  .typing {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--fg-3);
    font-size: 11.5px;
    animation: rs-fade-in var(--t) var(--ease);
  }

  .dots {
    display: inline-flex;
    gap: 3px;
  }

  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--fg-2);
    animation: dot 1.2s ease-in-out infinite;
  }

  .dots i:nth-child(2) {
    animation-delay: 0.15s;
  }

  .dots i:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes dot {
    0%,
    60%,
    100% {
      opacity: 0.3;
      transform: translateY(0);
    }
    30% {
      opacity: 1;
      transform: translateY(-2px);
    }
  }

  /* ---------- Spotify ---------- */

  .music {
    left: 8%;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 11px;
    width: 52%;
    padding: 10px 14px 10px 10px;
    border-radius: var(--r-full);
    rotate: -1deg;
    animation-delay: -1s;
  }

  .cover {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--spotify);
    color: var(--spotify-ink);
  }

  .song {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  .song small {
    color: var(--spotify);
    font-size: 10.5px;
    font-weight: 600;
  }

  .song b {
    overflow: hidden;
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .song span {
    overflow: hidden;
    color: var(--fg-3);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .eq {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 16px;
  }

  .eq i {
    width: 3px;
    height: 100%;
    border-radius: 2px;
    background: var(--spotify);
    transform-origin: bottom;
    animation: bar 1.1s ease-in-out infinite;
  }

  .eq i:nth-child(2) {
    animation-delay: -0.4s;
  }

  .eq i:nth-child(3) {
    animation-delay: -0.7s;
  }

  .eq i:nth-child(4) {
    animation-delay: -0.2s;
  }
</style>
