<script lang="ts">
  import { tooltip } from './tooltip'

  /**
   * Selo do dono do Resenha: medalhão nas cores do app, borda dourada e o
   * balãozinho da marca. Só existe um no Resenha inteiro (quem decide é o
   * servidor). O brilho passa só com o mouse em cima, pra não pintar a tela à toa.
   */
  let { size = 16 }: { size?: number } = $props()

  const uid = $props.id()
</script>

<span class="founder-badge" style:--size="{size}px" role="img" aria-label="Fundador do Resenha" use:tooltip={'Fundador do Resenha'}>
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <defs>
      <linearGradient id="{uid}-a" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8f84ff" />
        <stop offset="0.55" stop-color="#6a5cf6" />
        <stop offset="1" stop-color="#ff7ab6" />
      </linearGradient>
      <linearGradient id="{uid}-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff3c4" />
        <stop offset="0.5" stop-color="#ffd36b" />
        <stop offset="1" stop-color="#e59a12" />
      </linearGradient>
      <clipPath id="{uid}-c"><circle cx="10" cy="10" r="8" /></clipPath>
    </defs>
    <circle cx="10" cy="10" r="9.4" fill="url(#{uid}-g)" />
    <circle cx="10" cy="10" r="8" fill="url(#{uid}-a)" />
    <!-- O balão da marca, rindo. -->
    <path d="M7.4 12.3A4.2 4.2 0 1 1 9.2 13.4L6.3 14.3Z" fill="#fff" />
    <path d="M9.1 9.8Q10.6 11.4 12.1 9.8" fill="none" stroke="#6a5cf6" stroke-width="1.1" stroke-linecap="round" />
    <g clip-path="url(#{uid}-c)">
      <rect class="shine" x="-7" y="-4" width="3.5" height="28" fill="#fff" opacity="0.6" transform="rotate(25 10 10)" />
    </g>
  </svg>
</span>

<style>
  .founder-badge {
    display: inline-flex;
    flex: none;
    width: var(--size);
    height: var(--size);
    vertical-align: -0.2em;
    filter: drop-shadow(0 0 3px rgb(106 92 246 / 0.45));
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .shine {
    opacity: 0;
  }

  .founder-badge:hover .shine {
    animation: founder-shine 1.1s var(--ease, ease-out);
  }

  @keyframes founder-shine {
    from {
      opacity: 0.6;
      translate: 0 0;
    }
    to {
      opacity: 0.6;
      translate: 30px 0;
    }
  }
</style>
