<script lang="ts">
  import { initials, userGradient } from '../../lib/format'
  import StatusDot, { type Status } from './StatusDot.svelte'

  let {
    id,
    name,
    size = 32,
    src = null,
    status = null,
    speaking = false,
    cutout = 'var(--bg-canvas)',
    square = false,
    class: className,
  }: {
    id: string
    name: string
    size?: number
    /** Foto de perfil; sem ela, degradê com as iniciais. */
    src?: string | null
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
  {:else}
    <span class="face" style:background={userGradient(id)} style:font-size="{Math.round(size * 0.38)}px">{initials(name)}</span>
  {/if}
  {#if status}
    <StatusDot {status} size={dot} {cutout} class="avatar-status" />
  {/if}
</span>

<style>
  .avatar {
    position: relative;
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
  }
</style>
