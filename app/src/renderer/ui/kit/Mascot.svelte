<script lang="ts" module>
  let seq = 0
</script>

<script lang="ts">
  // O mascote do Resenha: o balão rindo de headset do ícone (mesmo desenho do app/build/icon.svg),
  // solto (sem o quadrado do ícone) e vivo: flutua devagar e ri (pula, a boca mexe e saem
  // ondinhas do microfone) quando pedem ou com o mouse em cima de quem o contém.

  let {
    size = 88,
    laughing = false,
    float = true,
    class: className,
  }: {
    size?: number
    /** Rindo agora (no login: de vez em quando e enquanto entra). */
    laughing?: boolean
    /** Flutua devagar (no trilho fica parado). */
    float?: boolean
    class?: string
  } = $props()

  const id = `mascot-${++seq}`
</script>

<span class={['mascot', className, { laughing, floating: float }]} style:--size="{size}px" aria-hidden="true">
  <svg viewBox="88 96 336 336" width={size} height={size}>
    <defs>
      <linearGradient id="{id}-phone" x1="0" y1="140" x2="0" y2="410" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#8cbcff" />
        <stop offset="1" stop-color="#2f74ff" />
      </linearGradient>
    </defs>

    <g class="float">
      <g transform="translate(0 -16)">
        <!-- sombra -->
        <g fill="#000" opacity=".35" transform="translate(0 14)">
          <path d="M164.6 349.4A116 116 0 1 1 239.9 392.9Q200 414 116 424Q164 400 164.6 349.4Z" />
          <rect x="102" y="226" width="58" height="106" rx="27" />
          <rect x="352" y="226" width="58" height="106" rx="27" />
        </g>

        <g class="body">
          <!-- arco do headset -->
          <path d="M126 270A130 130 0 0 1 386 270" fill="none" stroke="url(#{id}-phone)" stroke-width="28" stroke-linecap="round" />

          <!-- balão: base (rabinho e lado da sombra) + luz -->
          <path fill="#d5d8e2" d="M164.6 349.4A116 116 0 1 1 239.9 392.9Q200 414 116 424Q164 400 164.6 349.4Z" />
          <path fill="#ffffff" d="M155.4 335.7A116 116 0 0 1 328.4 187.4A114 114 0 1 1 155.4 335.7Z" />

          <!-- conchas do fone -->
          <g fill="url(#{id}-phone)">
            <rect x="102" y="226" width="58" height="106" rx="27" />
            <rect x="352" y="226" width="58" height="106" rx="27" />
          </g>
          <g fill="#fff" opacity=".28">
            <rect x="114" y="244" width="12" height="70" rx="6" />
            <rect x="386" y="244" width="12" height="70" rx="6" />
          </g>

          <!-- olhos > < e a boca rindo, como no ícone -->
          <g fill="none" stroke="#121318" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">
            <path d="M194 224L227 245L194 266" />
            <path d="M318 224L285 245L318 266" />
          </g>
          <g class="mouth">
            <path fill="#121318" d="M196 292H316A60 60 0 0 1 196 292Z" />
            <path fill="#ff7a93" d="M228.05 345.09A30 30 0 0 1 283.95 345.09A60 60 0 0 1 228.05 345.09Z" />
          </g>

          <!-- microfone do headset, e as ondinhas quando ri -->
          <path d="M384 328Q384 388 326 392" fill="none" stroke="#2f74ff" stroke-width="16" stroke-linecap="round" />
          <rect x="296" y="377" width="44" height="30" rx="15" fill="#2f74ff" />
          <g class="waves" fill="none" stroke="#8cbcff" stroke-width="9" stroke-linecap="round">
            <path class="w1" d="M302 420Q318 432 334 420" />
            <path class="w2" d="M292 442Q318 462 344 442" />
          </g>
        </g>
      </g>
    </g>
  </svg>
</span>

<style>
  .mascot {
    display: inline-grid;
    flex: none;
    width: var(--size);
    height: var(--size);
  }

  svg {
    overflow: visible;
  }

  /* Flutua devagar. */
  .floating .float {
    animation: mascot-float 4.2s ease-in-out infinite;
  }

  @keyframes mascot-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-10px);
    }
  }

  .body {
    transform-box: fill-box;
    transform-origin: 50% 100%;
  }

  .mouth {
    transform-box: fill-box;
    transform-origin: 50% 0%;
  }

  /* Rindo (pedido ou com o mouse em cima de quem contém): o corpo pula, a boca mexe e o microfone solta ondinhas. */
  .laughing .body,
  :global(:hover) > .mascot .body {
    animation: mascot-laugh 1.4s var(--ease) infinite;
  }

  .laughing .mouth,
  :global(:hover) > .mascot .mouth {
    animation: mascot-mouth 0.35s ease-in-out infinite alternate;
  }

  .laughing .waves .w1,
  :global(:hover) > .mascot .waves .w1 {
    animation: mascot-wave 1.1s ease-out infinite;
  }

  .laughing .waves .w2,
  :global(:hover) > .mascot .waves .w2 {
    animation: mascot-wave 1.1s ease-out 0.25s infinite;
  }

  @keyframes mascot-laugh {
    0%,
    100% {
      transform: scale(1, 1);
    }
    12% {
      transform: scale(1.04, 0.95);
    }
    24% {
      transform: scale(0.98, 1.04) translateY(-6px);
    }
    36% {
      transform: scale(1.04, 0.95);
    }
    48% {
      transform: scale(0.98, 1.04) translateY(-6px);
    }
    60% {
      transform: scale(1.03, 0.97);
    }
    72% {
      transform: scale(1, 1);
    }
  }

  @keyframes mascot-mouth {
    to {
      transform: scaleY(0.78);
    }
  }

  .waves path {
    opacity: 0;
  }

  @keyframes mascot-wave {
    0% {
      opacity: 0;
    }
    30% {
      opacity: 0.9;
    }
    100% {
      opacity: 0;
    }
  }
</style>
