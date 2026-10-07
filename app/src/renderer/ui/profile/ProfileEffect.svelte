<script lang="ts">
  import type { ProfileEffect } from '../../../../../shared/protocol'

  /**
   * Efeito do perfil: partículas leves (só CSS) por cima do cartão. Cada
   * partícula é uma "faixa" da altura do cartão que desce ou sobe inteira,
   * então o movimento acompanha o tamanho do cartão sem medir nada.
   * Some com `prefers-reduced-motion`.
   */
  let {
    kind,
    colors = null,
    paused = false,
  }: {
    kind: ProfileEffect
    colors?: [string, string] | null
    /** Parado num quadro (miniatura nas configurações; o hover solta). */
    paused?: boolean
  } = $props()

  const COUNT: Record<ProfileEffect, number> = { confetti: 22, snow: 28, sparkles: 12, hearts: 9, bubbles: 11, fireflies: 12 }
  const PALETTE: Record<ProfileEffect, string[]> = {
    confetti: ['#ff5c72', '#ffc34d', '#4fc3ff', '#34d399', '#ada4ff', '#ff8fd0'],
    snow: ['#ffffff'],
    sparkles: ['#fff6d6', '#ffe08a', '#ffffff'],
    hearts: ['#ff5c8a', '#ff8fb3', '#ff3d6e'],
    bubbles: ['#ffffff'],
    fireflies: ['#e8ff8a', '#fff3a0'],
  }

  /** Sorteio com semente: as partículas ficam iguais a cada vez que o cartão abre. */
  function seeded(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const particles = $derived.by(() => {
    const random = seeded([...kind].reduce((a, c) => a * 31 + c.charCodeAt(0), 7))
    // Confete e corações ganham as cores do perfil no meio.
    const palette = colors && (kind === 'confetti' || kind === 'hearts') ? [...PALETTE[kind], ...colors] : PALETTE[kind]
    return Array.from({ length: COUNT[kind] }, (_, i) => ({
      x: ((i + random()) / COUNT[kind]) * 100,
      y: random() * 100,
      s: random(),
      t: random(),
      d: random(),
      c: palette[Math.floor(random() * palette.length)],
    }))
  })
</script>

<div class={['effect', kind, { paused }]} aria-hidden="true">
  {#each particles as p, i (i)}
    <span class="lane" style="--x: {p.x}%; --y: {p.y}%; --s: {p.s}; --t: {p.t}; --d: {p.d}; --c: {p.c}">
      <i class="piece">
        {#if kind === 'hearts'}
          <svg viewBox="0 0 24 22"><path d="M12 21.5C5 16 0 11.6 0 6.6 0 2.9 2.9 0 6.5 0c2.2 0 4.2 1.1 5.5 2.9C13.3 1.1 15.3 0 17.5 0 21.1 0 24 2.9 24 6.6c0 5-5 9.4-12 14.9z" /></svg>
        {:else if kind === 'sparkles'}
          <svg viewBox="-10 -10 20 20"><path d="M0 -10C1.2 -2.6 2.6 -1.2 10 0C2.6 1.2 1.2 2.6 0 10C-1.2 2.6 -2.6 1.2 -10 0C-2.6 -1.2 -1.2 -2.6 0 -10Z" /></svg>
        {/if}
      </i>
    </span>
  {/each}
</div>

<style>
  .effect {
    position: absolute;
    inset: 0;
    z-index: 3;
    overflow: hidden;
    border-radius: inherit;
    pointer-events: none;
  }

  .paused :global(*) {
    animation-play-state: paused !important;
  }

  .lane {
    position: absolute;
    top: 0;
    left: var(--x);
    width: 0;
    height: 100%;
  }

  .piece {
    position: absolute;
    top: 0;
    left: 0;
    display: block;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: var(--c);
  }

  /* ---------- Caindo: confete e neve ---------- */
  .confetti .lane,
  .snow .lane {
    animation: fall linear infinite;
  }

  @keyframes fall {
    from {
      translate: 0 -8%;
    }
    to {
      translate: 0 104%;
    }
  }

  .confetti .lane {
    animation-duration: calc(4.5s + var(--t) * 3.5s);
    animation-delay: calc(var(--d) * -8s);
  }

  .confetti .piece {
    width: calc(4px + var(--s) * 3px);
    height: calc(7px + var(--s) * 4px);
    border-radius: 1px;
    background: var(--c);
    opacity: 0.85;
    animation: flip calc(1s + var(--t) * 1.4s) linear infinite;
  }

  @keyframes flip {
    from {
      transform: rotate3d(1, 0.6, 0.2, 0deg);
    }
    to {
      transform: rotate3d(1, 0.6, 0.2, 360deg);
    }
  }

  .snow .lane {
    animation-duration: calc(8s + var(--t) * 7s);
    animation-delay: calc(var(--d) * -15s);
  }

  .snow .piece {
    width: calc(2px + var(--s) * 3.5px);
    height: calc(2px + var(--s) * 3.5px);
    border-radius: 50%;
    background: #fff;
    opacity: calc(0.35 + var(--s) * 0.5);
    filter: blur(0.4px);
    animation: drift calc(2.4s + var(--t) * 2s) ease-in-out infinite alternate;
  }

  @keyframes drift {
    from {
      translate: -7px 0;
    }
    to {
      translate: 7px 0;
    }
  }

  /* ---------- Subindo: corações e bolhas ---------- */
  .hearts .lane,
  .bubbles .lane {
    animation:
      rise linear infinite,
      fade linear infinite;
    animation-duration: calc(6s + var(--t) * 5s);
    animation-delay: calc(var(--d) * -11s);
  }

  @keyframes rise {
    from {
      translate: 0 102%;
    }
    to {
      translate: 0 -10%;
    }
  }

  @keyframes fade {
    0%,
    100% {
      opacity: 0;
    }
    12%,
    70% {
      opacity: 0.8;
    }
  }

  .hearts .piece {
    width: calc(9px + var(--s) * 7px);
    height: calc(8px + var(--s) * 6.5px);
    filter: drop-shadow(0 0 4px color-mix(in srgb, var(--c) 60%, transparent));
    animation: drift calc(1.8s + var(--t) * 1.4s) ease-in-out infinite alternate;
  }

  .bubbles .piece {
    width: calc(6px + var(--s) * 12px);
    height: calc(6px + var(--s) * 12px);
    border-radius: 50%;
    background: radial-gradient(circle at 32% 30%, rgb(255 255 255 / 0.7) 0 12%, rgb(255 255 255 / 0.06) 30%, rgb(160 220 255 / 0.12) 100%);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.45);
    animation: drift calc(1.6s + var(--t) * 1.6s) ease-in-out infinite alternate;
  }

  /* ---------- No lugar: brilhos e vaga-lumes ---------- */
  .sparkles .lane,
  .fireflies .lane {
    top: var(--y);
    height: 0;
  }

  .sparkles .piece {
    width: calc(7px + var(--s) * 9px);
    height: calc(7px + var(--s) * 9px);
    translate: -50% -50%;
    filter: drop-shadow(0 0 3px rgb(255 230 150 / 0.9));
    animation: twinkle calc(1.8s + var(--t) * 1.8s) calc(var(--d) * -4s) ease-in-out infinite;
  }

  @keyframes twinkle {
    0%,
    100% {
      opacity: 0;
      scale: 0.2;
      rotate: 0deg;
    }
    50% {
      opacity: 0.95;
      scale: 1;
      rotate: 90deg;
    }
  }

  .fireflies .lane {
    animation: wander calc(7s + var(--t) * 6s) calc(var(--d) * -13s) ease-in-out infinite;
  }

  @keyframes wander {
    0%,
    100% {
      translate: 0 0;
    }
    25% {
      translate: 14px -10px;
    }
    50% {
      translate: -4px -20px;
    }
    75% {
      translate: -14px -4px;
    }
  }

  .fireflies .piece {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 6px 2px rgb(214 255 110 / 0.65);
    animation: glow calc(1.6s + var(--s) * 2s) calc(var(--d) * -3s) ease-in-out infinite;
  }

  @keyframes glow {
    0%,
    100% {
      opacity: 0.15;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .effect {
      display: none;
    }
  }
</style>
