<script lang="ts">
  import type { Badge } from '../../../../../shared/protocol'
  import { tooltip } from './tooltip'

  /**
   * Selo ao lado do nome. Só o servidor dá: Fundador (o dono do Resenha: medalhão
   * violeta e rosa, borda dourada, o balão da marca) e Pioneiro (a primeira pessoa
   * que chegou: medalhão azul e verde-água, borda prateada, uma bandeira fincada).
   * O brilho passa só com o mouse em cima, pra não pintar a tela à toa.
   */
  let { badge, size = 16 }: { badge: Badge | null | undefined; size?: number } = $props()

  const uid = $props.id()
  const LABEL: Record<Badge, string> = {
    founder: 'Fundador do Resenha',
    pioneer: 'Pioneiro do Resenha: a primeira pessoa que chegou',
  }
</script>

{#if badge}
  <span class="user-badge {badge}-badge" style:--size="{size}px" role="img" aria-label={LABEL[badge]} use:tooltip={LABEL[badge]}>
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <defs>
        <linearGradient id="{uid}-a" x1="0" y1="0" x2="1" y2="1">
          {#if badge === 'founder'}
            <stop offset="0" stop-color="#8f84ff" />
            <stop offset="0.55" stop-color="#6a5cf6" />
            <stop offset="1" stop-color="#ff7ab6" />
          {:else}
            <stop offset="0" stop-color="#5ab8ff" />
            <stop offset="0.55" stop-color="#2e8bff" />
            <stop offset="1" stop-color="#2ad4b0" />
          {/if}
        </linearGradient>
        <linearGradient id="{uid}-g" x1="0" y1="0" x2="0" y2="1">
          {#if badge === 'founder'}
            <stop offset="0" stop-color="#fff3c4" />
            <stop offset="0.5" stop-color="#ffd36b" />
            <stop offset="1" stop-color="#e59a12" />
          {:else}
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.5" stop-color="#d9e2ec" />
            <stop offset="1" stop-color="#8a9bb0" />
          {/if}
        </linearGradient>
        <clipPath id="{uid}-c"><circle cx="10" cy="10" r="8" /></clipPath>
      </defs>
      <circle cx="10" cy="10" r="9.4" fill="url(#{uid}-g)" />
      <circle cx="10" cy="10" r="8" fill="url(#{uid}-a)" />
      {#if badge === 'founder'}
        <!-- O balão da marca, rindo. -->
        <path d="M7.4 12.3A4.2 4.2 0 1 1 9.2 13.4L6.3 14.3Z" fill="#fff" />
        <path d="M9.1 9.8Q10.6 11.4 12.1 9.8" fill="none" stroke="#6a5cf6" stroke-width="1.1" stroke-linecap="round" />
      {:else}
        <!-- Bandeira fincada: quem chegou primeiro. -->
        <path d="M7.6 15V4.8" stroke="#fff" stroke-width="1.3" stroke-linecap="round" />
        <path d="M8.1 5.2Q10.6 4.2 13.6 5.6Q11.4 6.9 13.6 8.6Q10.8 7.6 8.1 8.9Z" fill="#fff" />
        <path d="M5.8 15.2H9.6" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity="0.85" />
      {/if}
      <g clip-path="url(#{uid}-c)">
        <rect class="shine" x="-7" y="-4" width="3.5" height="28" fill="#fff" opacity="0.6" transform="rotate(25 10 10)" />
      </g>
    </svg>
  </span>
{/if}

<style>
  .user-badge {
    display: inline-flex;
    flex: none;
    width: var(--size);
    height: var(--size);
    vertical-align: -0.2em;
  }

  .founder-badge {
    filter: drop-shadow(0 0 3px rgb(106 92 246 / 0.45));
  }

  .pioneer-badge {
    filter: drop-shadow(0 0 3px rgb(46 139 255 / 0.45));
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .shine {
    opacity: 0;
  }

  .user-badge:hover .shine {
    animation: badge-shine 1.1s var(--ease, ease-out);
  }

  @keyframes badge-shine {
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
