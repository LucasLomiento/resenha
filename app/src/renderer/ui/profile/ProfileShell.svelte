<script lang="ts">
  import type { Snippet } from 'svelte'
  import { bannerFill, cardTheme, profileColors, type Styled } from '../../lib/profile'
  import ProfileEffect from './ProfileEffect.svelte'

  /**
   * Moldura do cartão de perfil: fundo (tema em degradê), banner (imagem ou
   * cor) e o efeito por cima. O conteúdo vem de fora (cartão, painel da
   * conversa privada, prévia nas configurações). `--card-cut` é a cor atrás
   * do avatar, pro recorte acompanhar o tema.
   */
  let {
    user,
    banner = null,
    variant = 'card',
    label,
    children,
  }: {
    user: Styled
    /** URL do banner, se tiver. */
    banner?: string | null
    /** card: popover · flat: painel da conversa privada · preview: prévia com sombra. */
    variant?: 'card' | 'flat' | 'preview'
    label?: string
    children: Snippet
  } = $props()

  const theme = $derived(cardTheme(user))
  const effect = $derived(user.deleted ? null : (user.style?.effect ?? null))
  const fill = $derived(bannerFill(user))
</script>

<div class={['shell', variant, { themed: !!theme }]} style={theme} role={label ? 'group' : undefined} aria-label={label}>
  <div class="banner" class:image={!!banner} style:background={banner ? null : fill}>
    {#if banner}<img src={banner} alt="" draggable="false" />{/if}
  </div>
  {@render children()}
  {#if effect}<ProfileEffect kind={effect} colors={profileColors(user)} />{/if}
</div>

<style>
  .shell {
    --card-cut: var(--bg-raised);
    position: relative;
    /* O efeito e a moldura ficam por cima só aqui dentro. */
    isolation: isolate;
    width: 320px;
    border-radius: var(--r-2xl);
    background: var(--bg-raised);
    overflow: hidden;
  }

  .preview {
    width: 100%;
    max-width: 320px;
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
  }

  .flat {
    --card-cut: var(--bg-panel);
    width: 100%;
    height: 100%;
    border-radius: 0;
    background: transparent;
    overflow-y: auto;
  }

  /*
   * Tema: as duas cores escurecidas (o texto continua branco e legível), a
   * principal em cima até o avatar e a de destaque embaixo.
   */
  .themed {
    --card-top: color-mix(in oklab, var(--theme-a) 40%, #0b0b10);
    --card-bottom: color-mix(in oklab, var(--theme-b) 40%, #0b0b10);
    --card-cut: var(--card-top);
    background: linear-gradient(180deg, var(--card-top) 0, var(--card-top) 150px, var(--card-bottom) 100%);
  }

  .themed::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--theme-a) 45%, transparent);
    pointer-events: none;
  }

  .themed.preview {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--theme-a) 50%, transparent),
      var(--highlight),
      var(--shadow-lg);
  }

  .themed.flat::after {
    display: none;
  }

  .banner {
    height: 96px;
    opacity: 0.75;
  }

  .banner.image {
    height: 120px;
    opacity: 1;
  }

  .banner img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
