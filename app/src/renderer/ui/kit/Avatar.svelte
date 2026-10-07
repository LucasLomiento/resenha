<script lang="ts">
  import type { Decoration } from '../../../../../shared/protocol'
  import { initials, userGradient } from '../../lib/format'
  import AvatarDecoration from './AvatarDecoration.svelte'
  import StatusDot, { type Status } from './StatusDot.svelte'

  let {
    id,
    name,
    size = 32,
    src = null,
    animated = null,
    decoration = null,
    play = false,
    status = null,
    speaking = false,
    cutout = 'var(--bg-canvas)',
    square = false,
    class: className,
  }: {
    id: string
    name: string
    size?: number
    /** Foto de perfil (parada); sem ela, degradê com as iniciais. */
    src?: string | null
    /** Versão animada da foto (GIF/WebP): só aparece com `play`. */
    animated?: string | null
    /** Moldura do perfil, por cima do avatar. */
    decoration?: Decoration | null
    /** Anima a foto e a moldura (no cartão sempre; nas listas, no hover). */
    play?: boolean
    status?: Status | null
    /** Anel verde de quem está falando. */
    speaking?: boolean
    /** Cor do fundo atrás do avatar (recorte do ponto de status e do anel). */
    cutout?: string
    /** Cantos arredondados em vez de círculo (ícone de servidor). */
    square?: boolean
    class?: string
  } = $props()

  const dot = $derived(Math.max(8, Math.round(size * 0.3)))
</script>

<span
  class={['avatar', className, { speaking, square }]}
  style:--size="{size}px"
  style:--cut={cutout}
  role="img"
  aria-label={name}
>
  {#if src}
    <img src={src} alt="" draggable="false" />
    <!-- A animada entra por cima da parada: enquanto carrega, a parada continua ali. -->
    {#if play && animated}<img class="animated" src={animated} alt="" draggable="false" />{/if}
  {:else}
    <span class="face" style:background={userGradient(id)} style:font-size="{Math.round(size * 0.38)}px">{initials(name)}</span>
  {/if}
  {#if decoration && !square}
    <AvatarDecoration kind={decoration} {play} />
  {/if}
  {#if status}
    <StatusDot {status} size={dot} {cutout} class="avatar-status" />
  {/if}
</span>

<style>
  .avatar {
    position: relative;
    /* A moldura e o status ficam por cima só aqui dentro (não passam de cabeçalhos fixos). */
    isolation: isolate;
    display: inline-block;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .square,
  .square .face,
  .square img {
    border-radius: 30%;
  }

  .face,
  img {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .animated {
    position: absolute;
    inset: 0;
  }

  .face {
    color: rgb(12 10 24 / 0.78);
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .speaking {
    box-shadow:
      0 0 0 2px var(--cut),
      0 0 0 4px var(--green);
  }

  .avatar :global(.avatar-status) {
    position: absolute;
    right: -1px;
    bottom: -1px;
    z-index: 2;
  }
</style>
