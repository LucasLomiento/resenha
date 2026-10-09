<script lang="ts">
  import type { Decoration } from '../../../../../shared/protocol'

  /**
   * Moldura do avatar (decoração do perfil). Desenhada por cima do avatar,
   * 25% maior que ele: no SVG (120 × 120) o avatar é o círculo de raio 48 no
   * centro. Anima só com `play` (no cartão sempre; nas listas, no hover).
   */
  let { kind, play = false }: { kind: Decoration; play?: boolean } = $props()

  // Ids únicos: o mesmo gradiente aparece em vários avatares na tela.
  const uid = $props.id()

  const SPARKLE = 'M0 -10C1.2 -2.6 2.6 -1.2 10 0C2.6 1.2 1.2 2.6 0 10C-1.2 2.6 -2.6 1.2 -10 0C-2.6 -1.2 -1.2 -2.6 0 -10Z'
  const FLAME = 'M0 0C-6.5 0 -9 -6 -6 -11.5C-4.2 -14.8 -2 -17 -0.6 -22C1.6 -17.4 5.4 -14.6 6.8 -9.6C8.2 -4.4 5.6 0 0 0Z'
  const PETAL = 'M0 0C-2.6 -2.4 -2.4 -6.6 0 -8C2.4 -6.6 2.6 -2.4 0 0Z'
  /** Coração com chifrinhos do Pioneiro, o mesmo do selo (caixa 20 × 20). */
  const HEART =
    'M10 15.4C10 15.4 5.3 12.5 5.3 9.4C5.3 7.9 6.5 6.8 7.9 6.8C8.9 6.8 9.6 7.3 10 8.1C10.4 7.3 11.1 6.8 12.1 6.8C13.5 6.8 14.7 7.9 14.7 9.4C14.7 12.5 10 15.4 10 15.4Z'
  const HORNS = ['M6.1 7.8C4.5 6.6 4.6 4.6 6.3 3.4C5.8 4.9 6.6 6.2 8.5 6.9Z', 'M13.9 7.8C15.5 6.6 15.4 4.6 13.7 3.4C14.2 4.9 13.4 6.2 11.5 6.9Z']

  /** Chamas dos dois lados: [x, y, inclinação, tamanho, atraso]. */
  const FLAMES: [number, number, number, number, number][] = [
    [60, 110, 0, 0.75, 0],
    [72, 108, 6, 0.6, -0.45],
    [48, 108, -6, 0.6, -0.25],
    [85, 103, 12, 1.15, -0.35],
    [101, 88, 20, 1.25, -0.7],
    [109, 66, 24, 1, -0.2],
    [106, 44, 28, 0.7, -0.5],
    [35, 103, -12, 1.15, -0.55],
    [19, 88, -20, 1.25, -0.15],
    [11, 66, -24, 1, -0.8],
    [14, 44, -28, 0.7, -0.4],
  ]

  /** Folhas da guirlanda (ângulo no círculo, raio, lado). */
  const LEAVES = [26, 40, 54, 68, 84, 100, 114, 128, 142, 156].map((a, i) => ({ a, r: i % 2 ? 49 : 52, flip: i % 2 ? 1 : -1 }))
  const at = (deg: number, r: number): [number, number] => [60 + r * Math.cos((deg * Math.PI) / 180), 60 + r * Math.sin((deg * Math.PI) / 180)]
  /** Flores: [posição, tamanho, cor]. */
  const FLOWERS: [[number, number], number, string][] = [
    [at(150, 51), 1, '#ff9fc6'],
    [at(34, 51), 0.85, '#ffffff'],
    [at(92, 52), 0.75, '#ffb4d4'],
    [at(-130, 51), 0.8, '#ff9fc6'],
  ]
  /** Louros do Fundador: folhas dos dois lados, do medalhão (embaixo) subindo pelo anel. */
  const LAURELS = [-1, 1].flatMap((side) =>
    [102, 113, 124, 135, 146, 157].map((a, i) => ({ a: 90 + side * (a - 90), r: i % 2 ? 54.5 : 52.5, side, size: 1 - i * 0.07 })),
  )

  /** Estrelinhas: [x, y, tamanho, atraso]. */
  const STARS: [number, number, number, number][] = [
    [101, 17, 1.15, 0],
    [15, 30, 0.6, -0.9],
    [110, 82, 0.55, -1.6],
    [22, 101, 0.85, -0.5],
    [62, 3, 0.45, -1.2],
    [88, 112, 0.4, -2],
  ]
</script>

<span class={['deco', kind, { play }]} aria-hidden="true">
  {#if kind === 'aurora'}
    <span class="aurora-glow"></span>
    <span class="aurora-ring"></span>
  {:else}
    <svg viewBox="0 0 120 120" overflow="visible">
      {#if kind === 'neon'}
        <defs>
          <linearGradient id="{uid}-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#4ff3ff" />
            <stop offset="0.5" stop-color="#8f84ff" />
            <stop offset="1" stop-color="#ff4fd8" />
          </linearGradient>
          <filter id="{uid}-g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        <g class="neon-spin">
          <circle cx="60" cy="60" r="52" fill="none" stroke="url(#{uid}-a)" stroke-width="6" filter="url(#{uid}-g)" class="neon-glow" />
          <circle cx="60" cy="60" r="52" fill="none" stroke="url(#{uid}-a)" stroke-width="3" />
        </g>
        <circle cx="60" cy="60" r="52" fill="none" stroke="#fff" stroke-width="0.9" opacity="0.75" />
      {:else if kind === 'headset'}
        <defs>
          <linearGradient id="{uid}-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#b3abff" />
            <stop offset="0.55" stop-color="#6a5cf6" />
            <stop offset="1" stop-color="#4436d0" />
          </linearGradient>
        </defs>
        <!-- Arco por cima da cabeça: fora da foto (raio 48), entrando nas conchas dos lados. -->
        <path d="M7 66V60A53 53 0 0 1 113 60V66" fill="none" stroke="#1b1730" stroke-width="10" stroke-linecap="round" />
        <path d="M7 66V60A53 53 0 0 1 113 60V66" fill="none" stroke="url(#{uid}-a)" stroke-width="6.5" stroke-linecap="round" />
        <path d="M24 21.1A53 53 0 0 1 96 21.1" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity="0.45" />
        <path d="M14 82C16 100 30 108 46 106" fill="none" stroke="#1b1730" stroke-width="5" stroke-linecap="round" />
        <path d="M14 82C16 100 30 108 46 106" fill="none" stroke="#8f84ff" stroke-width="2.6" stroke-linecap="round" />
        <circle cx="49" cy="105.5" r="5" fill="#1b1730" />
        <circle cx="49" cy="105.5" r="3.4" fill="#34d399" class="mic-light" />
        {#each [-1, 1] as side (side)}
          <g transform="translate({60 + side * 50} 70)">
            <rect x="-9" y="-15" width="18" height="30" rx="8" fill="#1b1730" />
            <rect x="-7" y="-13" width="14" height="26" rx="6.5" fill="url(#{uid}-a)" />
            <rect x={side < 0 ? 1.5 : -4.5} y="-9" width="3" height="18" rx="1.5" fill="#fff" opacity="0.35" />
          </g>
          <g transform="translate({60 + side * 64} 70) scale({side} 1)">
            <g class="wave" style:--d="{side < 0 ? 0 : -0.6}s">
              <path d="M0 -6C3 -3 3 3 0 6" fill="none" stroke="#b3abff" stroke-width="2" stroke-linecap="round" />
              <path d="M4 -10C9 -4 9 4 4 10" fill="none" stroke="#b3abff" stroke-width="2" stroke-linecap="round" opacity="0.6" />
            </g>
          </g>
        {/each}
      {:else if kind === 'stars'}
        <defs>
          <filter id="{uid}-g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" /></filter>
        </defs>
        <circle cx="60" cy="60" r="53" fill="none" stroke="#ffe7a3" stroke-width="1.1" stroke-dasharray="0.1 7" stroke-linecap="round" opacity="0.7" class="orbit" />
        {#each STARS as [x, y, s, d], i (i)}
          <g transform="translate({x} {y}) scale({s})">
            <g class="twinkle" style:--d="{d}s">
              <path d={SPARKLE} fill="#ffd66b" filter="url(#{uid}-g)" opacity="0.8" />
              <path d={SPARKLE} fill="#fff6d6" />
            </g>
          </g>
        {/each}
      {:else if kind === 'flames'}
        <defs>
          <linearGradient id="{uid}-a" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#ff3d1f" />
            <stop offset="0.5" stop-color="#ff8a1f" />
            <stop offset="1" stop-color="#ffe066" />
          </linearGradient>
          <filter id="{uid}-g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" /></filter>
        </defs>
        <circle cx="60" cy="60" r="50" fill="none" stroke="#ff6a1f" stroke-width="4" filter="url(#{uid}-g)" opacity="0.8" />
        {#each FLAMES as [x, y, tilt, s, d], i (i)}
          <g transform="translate({x} {y}) rotate({tilt}) scale({s})">
            <g class="flicker" style:--d="{d}s">
              <path d={FLAME} fill="url(#{uid}-a)" />
              <path d={FLAME} fill="#fff3b0" transform="translate(0 -1) scale(0.45)" opacity="0.9" />
            </g>
          </g>
        {/each}
      {:else if kind === 'flowers'}
        <g class="sway">
          <path d="M{at(20, 51).join(' ')}A51 51 0 0 1 {at(160, 51).join(' ')}" fill="none" stroke="#2f7d4a" stroke-width="2" stroke-linecap="round" />
          {#each LEAVES as leaf, i (i)}
            {@const [x, y] = at(leaf.a, leaf.r)}
            <ellipse cx={x} cy={y} rx="7" ry="3" transform="rotate({leaf.a + 90 + leaf.flip * 28} {x} {y})" fill={i % 3 ? '#5cc46e' : '#3e9a55'} />
          {/each}
          {#each FLOWERS as [[x, y], s, c], i (i)}
            <g transform="translate({x} {y}) scale({s})">
              <g class="bloom" style:--d="{-i * 0.8}s">
                {#each [0, 72, 144, 216, 288] as r (r)}
                  <path d={PETAL} transform="rotate({r})" fill={c} stroke="#d9608f" stroke-width="0.5" />
                {/each}
                <circle r="2.4" fill="#ffd84d" />
              </g>
            </g>
          {/each}
          {#each [at(-110, 52), at(-150, 52)] as [x, y], i (i)}
            <ellipse cx={x} cy={y} rx="6" ry="2.6" transform="rotate({(i ? -150 : -110) + 90 + (i ? 30 : -30)} {x} {y})" fill="#5cc46e" />
          {/each}
        </g>
      {:else if kind === 'crown'}
        <defs>
          <linearGradient id="{uid}-a" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff0a8" />
            <stop offset="0.5" stop-color="#ffcf4a" />
            <stop offset="1" stop-color="#e59a12" />
          </linearGradient>
        </defs>
        <g transform="translate(40 13) rotate(-16)">
          <g class="bob">
            <path d="M-17 8L-20 -9L-9 -1L0 -14L9 -1L20 -9L17 8Z" fill="url(#{uid}-a)" stroke="#8a5600" stroke-width="1.6" stroke-linejoin="round" />
            <rect x="-17" y="5" width="34" height="6" rx="2" fill="url(#{uid}-a)" stroke="#8a5600" stroke-width="1.6" />
            <circle cx="-20" cy="-9" r="2.6" fill="#ff5c72" stroke="#8a5600" stroke-width="1" />
            <circle cx="0" cy="-14" r="2.8" fill="#4fc3ff" stroke="#8a5600" stroke-width="1" />
            <circle cx="20" cy="-9" r="2.6" fill="#34d399" stroke="#8a5600" stroke-width="1" />
            <circle cx="0" cy="8" r="2" fill="#ff5c72" />
            <circle cx="-9" cy="8" r="1.4" fill="#4fc3ff" />
            <circle cx="9" cy="8" r="1.4" fill="#4fc3ff" />
            <g class="twinkle" style:--d="-0.4s" transform="translate(12 -16) scale(0.4)"><path d={SPARKLE} fill="#fff" /></g>
          </g>
        </g>
      {:else if kind === 'founder'}
        <!-- Só do dono do Resenha: anel nas cores do app, órbita dourada, brilhos e o medalhão da marca. -->
        <defs>
          <linearGradient id="{uid}-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#8f84ff" />
            <stop offset="0.5" stop-color="#6a5cf6" />
            <stop offset="1" stop-color="#ff7ab6" />
          </linearGradient>
          <linearGradient id="{uid}-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff3c4" />
            <stop offset="0.5" stop-color="#ffd36b" />
            <stop offset="1" stop-color="#e59a12" />
          </linearGradient>
          <filter id="{uid}-b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.6" /></filter>
        </defs>
        <g class="founder-spin">
          <circle cx="60" cy="60" r="52" fill="none" stroke="url(#{uid}-a)" stroke-width="6" filter="url(#{uid}-b)" opacity="0.75" />
          <circle cx="60" cy="60" r="52" fill="none" stroke="url(#{uid}-a)" stroke-width="3.4" />
        </g>
        <circle cx="60" cy="60" r="49.4" fill="none" stroke="url(#{uid}-g)" stroke-width="0.9" opacity="0.85" />
        {#each LAURELS as leaf, i (i)}
          {@const [x, y] = at(leaf.a, leaf.r)}
          <ellipse
            cx={x}
            cy={y}
            rx={6 * leaf.size}
            ry={2.5 * leaf.size}
            transform="rotate({leaf.a + 90 + leaf.side * (i % 2 ? 32 : -32)} {x} {y})"
            fill="url(#{uid}-g)"
            stroke="#8a5600"
            stroke-width="0.6"
          />
        {/each}
        <circle cx="60" cy="60" r="56.5" fill="none" stroke="url(#{uid}-g)" stroke-width="1.3" stroke-dasharray="0.1 6.5" stroke-linecap="round" class="founder-orbit" />
        <g class="founder-orbit">
          {#each [-60, 60, 180] as angle, i (angle)}
            {@const [x, y] = at(angle, 56.5)}
            <g transform="translate({x} {y}) scale(0.55)">
              <g class="twinkle" style:--d="{-i * 0.7}s">
                <path d={SPARKLE} fill="#ffd36b" filter="url(#{uid}-b)" opacity="0.8" />
                <path d={SPARKLE} fill="#fff6d6" />
              </g>
            </g>
          {/each}
        </g>
        <g transform="translate(60 109)">
          <circle r="11.2" fill="#1b1730" />
          <circle r="9.8" fill="url(#{uid}-g)" />
          <circle r="8.2" fill="url(#{uid}-a)" />
          <path d="M-2.6 2.3A4.2 4.2 0 1 1 -0.8 3.4L-3.7 4.3Z" fill="#fff" />
          <path d="M-0.9 -0.2Q0.6 1.4 2.1 -0.2" fill="none" stroke="#6a5cf6" stroke-width="1.1" stroke-linecap="round" />
        </g>
      {:else if kind === 'pioneer'}
        <!-- Só do Pioneiro (o melhor amigo do dono): anel do mar, um cometa em volta e o coração com chifrinhos do selo. -->
        <defs>
          <linearGradient id="{uid}-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#5ab8ff" />
            <stop offset="0.5" stop-color="#2e8bff" />
            <stop offset="1" stop-color="#2ad4b0" />
          </linearGradient>
          <linearGradient id="{uid}-s" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="1" stop-color="#b8c7d9" />
          </linearGradient>
          <linearGradient id="{uid}-h" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ff8a7a" />
            <stop offset="1" stop-color="#e8243f" />
          </linearGradient>
          <filter id="{uid}-b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" /></filter>
        </defs>
        <circle cx="60" cy="60" r="52" fill="none" stroke="url(#{uid}-a)" stroke-width="6" filter="url(#{uid}-b)" opacity="0.7" />
        <circle cx="60" cy="60" r="52" fill="none" stroke="url(#{uid}-a)" stroke-width="3.4" />
        <circle cx="60" cy="60" r="49.4" fill="none" stroke="url(#{uid}-s)" stroke-width="0.8" opacity="0.7" />
        <g class="comet">
          {#each [0, 1, 2, 3, 4, 5, 6] as k (k)}
            {@const [x, y] = at(-90 - k * 5.5, 56)}
            <circle cx={x} cy={y} r={3.2 - k * 0.42} fill={k ? '#9fd4ff' : '#ffffff'} opacity={1 - k * 0.13} />
          {/each}
          <circle cx="60" cy="4" r="5" fill="#5ab8ff" filter="url(#{uid}-b)" opacity="0.9" />
        </g>
        {#each [[22, 98, 0.6, 0], [12, 50, 0.45, -0.8], [104, 92, 0.5, -1.5]] as [x, y, s, d], i (i)}
          <g transform="translate({x} {y}) scale({s})">
            <g class="twinkle" style:--d="{d}s"><path d={SPARKLE} fill="#d6ecff" /></g>
          </g>
        {/each}
        <!-- O coração com chifrinhos (o mesmo desenho do selo), preso no alto do anel à direita, batendo. -->
        <g transform="translate(98 20) rotate(14) scale(2.6) translate(-10 -10.5)">
          <g class="beat">
            <path d={HEART} fill="#ff5c8a" filter="url(#{uid}-b)" opacity="0.55" transform="translate(10 11) scale(1.15) translate(-10 -11)" />
            {#each HORNS as horn (horn)}
              <path d={horn} fill="url(#{uid}-h)" stroke="#1b1730" stroke-width="0.7" stroke-linejoin="round" />
            {/each}
            <path d={HEART} fill="url(#{uid}-s)" stroke="#1b1730" stroke-width="0.7" stroke-linejoin="round" />
          </g>
        </g>
      {:else if kind === 'cat'}
        {#each [-1, 1] as side (side)}
          <g transform="translate({60 + side * 30} 22) scale({side} 1)">
            <g class={side > 0 ? 'twitch' : ''}>
              <path d="M-12 8C-12 -4 -6 -16 4 -24C10 -14 14 -4 13 6Z" fill="#26222f" stroke="#15131c" stroke-width="2" stroke-linejoin="round" />
              <path d="M-6 5C-6 -3 -2 -11 4 -16C7 -9 9 -2 8 4Z" fill="#ff9fc0" />
            </g>
          </g>
        {/each}
      {/if}
    </svg>
  {/if}
</span>

<style>
  .deco {
    position: absolute;
    inset: -12.5%;
    z-index: 1;
    pointer-events: none;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* Parado até `play` (nas listas, o hover liga). */
  .deco:not(.play) :global(*) {
    animation-play-state: paused !important;
  }

  /* ---------- Fundador ---------- */
  .founder-spin {
    transform-origin: 60px 60px;
    animation: deco-spin 10s linear infinite;
  }

  .founder-orbit {
    transform-origin: 60px 60px;
    animation: deco-spin 24s linear infinite reverse;
  }

  /* ---------- Pioneiro ---------- */
  .comet {
    transform-origin: 60px 60px;
    animation: deco-spin 7s linear infinite;
  }

  .beat {
    transform-box: fill-box;
    transform-origin: 50% 60%;
    animation: heart-beat 1.4s ease-in-out infinite;
  }

  /* Tum-tum e uma pausa. */
  @keyframes heart-beat {
    0%,
    28%,
    70%,
    100% {
      transform: scale(1);
    }
    14% {
      transform: scale(1.12);
    }
    42% {
      transform: scale(1.07);
    }
  }

  /* ---------- Neon ---------- */
  .neon-spin {
    transform-origin: 60px 60px;
    animation: deco-spin 8s linear infinite;
  }

  .neon-glow {
    animation: neon-flicker 4s steps(1) infinite;
  }

  @keyframes neon-flicker {
    0%,
    100% {
      opacity: 0.95;
    }
    46% {
      opacity: 0.55;
    }
    48% {
      opacity: 0.95;
    }
    50% {
      opacity: 0.6;
    }
    52% {
      opacity: 0.95;
    }
  }

  /* ---------- Aurora: anel em degradê girando ---------- */
  .aurora-ring,
  .aurora-glow {
    position: absolute;
    inset: 6%;
    border-radius: 50%;
    background: conic-gradient(from 0deg, #6ff7d0, #4f9dff, #a46bff, #ff6fb5, #ffd36b, #6ff7d0);
    mask: radial-gradient(farthest-side, transparent calc(100% - 9%), #000 calc(100% - 8%));
    animation: deco-spin 6s linear infinite;
  }

  .aurora-glow {
    filter: blur(3px);
    opacity: 0.8;
  }

  /* ---------- Fones ---------- */
  .mic-light {
    animation: mic 1.6s ease-in-out infinite;
  }

  @keyframes mic {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  .wave {
    opacity: 0;
    animation: wave 1.2s var(--d, 0s) ease-out infinite;
  }

  /* Parado, as ondas ficam desenhadas (pausadas no meio sumiriam). */
  .deco:not(.play) .wave {
    animation: none;
    opacity: 0.5;
  }

  @keyframes wave {
    0% {
      opacity: 0;
      translate: -3px 0;
    }
    40% {
      opacity: 0.9;
    }
    100% {
      opacity: 0;
      translate: 3px 0;
    }
  }

  /* ---------- Estrelinhas ---------- */
  .twinkle {
    animation: twinkle 2.2s var(--d, 0s) ease-in-out infinite;
  }

  @keyframes twinkle {
    0%,
    100% {
      opacity: 1;
      scale: 1;
      rotate: 0deg;
    }
    50% {
      opacity: 0.35;
      scale: 0.55;
      rotate: 45deg;
    }
  }

  .orbit {
    transform-origin: 60px 60px;
    animation: deco-spin 30s linear infinite;
  }

  /* ---------- Chamas ---------- */
  .flicker {
    transform-origin: 0 0;
    animation: flicker 0.9s var(--d, 0s) ease-in-out infinite alternate;
  }

  @keyframes flicker {
    0% {
      scale: 1 0.86;
      skew: -4deg 0deg;
    }
    50% {
      scale: 0.96 1.06;
    }
    100% {
      scale: 1.02 0.94;
      skew: 5deg 0deg;
    }
  }

  /* ---------- Flores ---------- */
  .sway {
    transform-origin: 60px 60px;
    animation: sway 5s ease-in-out infinite;
  }

  @keyframes sway {
    0%,
    100% {
      rotate: -3deg;
    }
    50% {
      rotate: 3deg;
    }
  }

  .bloom {
    animation: bloom 4s var(--d, 0s) ease-in-out infinite;
  }

  @keyframes bloom {
    0%,
    100% {
      rotate: 0deg;
      scale: 1;
    }
    50% {
      rotate: 36deg;
      scale: 1.12;
    }
  }

  /* ---------- Coroa ---------- */
  .bob {
    animation: bob 2.8s ease-in-out infinite;
  }

  @keyframes bob {
    0%,
    100% {
      translate: 0 0;
    }
    50% {
      translate: 0 -2px;
    }
  }

  /* ---------- Gatinho ---------- */
  .twitch {
    transform-origin: 0 6px;
    animation: twitch 3.2s ease-in-out infinite;
  }

  @keyframes twitch {
    0%,
    86%,
    100% {
      rotate: 0deg;
    }
    90% {
      rotate: -14deg;
    }
    94% {
      rotate: 4deg;
    }
  }

  @keyframes deco-spin {
    to {
      rotate: 360deg;
    }
  }
</style>
