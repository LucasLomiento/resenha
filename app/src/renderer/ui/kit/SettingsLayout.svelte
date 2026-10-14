<script lang="ts" module>
  import type { IconName } from './Icon.svelte'

  export type SettingsNavEntry =
    | { id: string; label: string; icon: IconName; tone?: 'default' | 'danger' }
    /** `name`: o título é um nome (servidor, canal) e fica como foi escrito, sem caixa alta. */
    | { heading: string; name?: boolean }
    | { separator: true }
</script>

<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import { m } from '../../lib/i18n.svelte'
  import { ui } from '../../lib/ui.svelte'
  import Icon from './Icon.svelte'
  import { layer } from './layers'
  import NavItem from './NavItem.svelte'
  import { tooltip } from './tooltip'

  let {
    title,
    nav,
    active,
    onselect,
    onclose,
    inline = false,
    search,
    results,
    footer,
    children,
  }: {
    /** Nome da tela, pra leitor de tela. */
    title: string
    nav: SettingsNavEntry[]
    active: string
    onselect: (id: string) => void
    onclose: () => void
    /** Protótipos: sem a camada do Esc. */
    inline?: boolean
    /** Campo de busca no topo da navegação. */
    search?: Snippet
    /** Resultados da busca: aparecem no lugar da navegação. */
    results?: Snippet
    /** Rodapé da navegação (versão do app, por exemplo). */
    footer?: Snippet
    children: Snippet
  } = $props()

  let content = $state<HTMLElement>()
  /** Celular: a lista de páginas e a página aparecem uma de cada vez; abre na lista. */
  let showPage = $state(false)
  let shownActive = untrack(() => active)

  // Trocou de página: começa do topo (no celular, mostra a página).
  $effect(() => {
    if (active !== shownActive) showPage = true
    shownActive = active
    content?.scrollTo({ top: 0 })
  })

  function select(id: string) {
    onselect(id)
    showPage = true
  }

  /** Esc (ou o voltar do celular): da página volta pra lista; da lista, fecha. */
  function back() {
    if (ui.compact && showPage) showPage = false
    else onclose()
  }

  const closeLayer = (node: HTMLElement) => (inline ? undefined : layer(node, back))
</script>

<!-- Configurações em tela cheia, com a cara do app: navegação direto no fundo à esquerda e a
     página num painel solto que ocupa o resto da janela; fechar no canto do painel (Esc). -->
<!-- data-portal-root: modais e menus abertos daqui entram nesta camada (senão ficariam atrás dela). -->
<div
  class="settings"
  class:compact={ui.compact}
  class:show-page={showPage}
  role="dialog"
  aria-modal="true"
  aria-label={title}
  data-portal-root={inline ? undefined : ''}
  use:closeLayer
>
    <nav class="settings-nav" aria-label={title}>
      {#if ui.compact}
        <div class="nav-head">
          <span>{title}</span>
          <button type="button" class="close" aria-label={m.common.close} onclick={onclose}><Icon name="x" size={18} /></button>
        </div>
      {/if}
      {#if search}<div class="search">{@render search()}</div>{/if}
      {#if results}
        {@render results()}
      {:else}
      {#each nav as entry, i (i)}
        {#if 'separator' in entry}
          <div class="separator" role="separator"></div>
        {:else if 'heading' in entry}
          <div class="heading" class:name={entry.name}>{entry.heading}</div>
        {:else}
          <NavItem
            label={entry.label}
            icon={entry.icon}
            tone={entry.tone}
            active={entry.id === active}
            onclick={() => select(entry.id)}
          />
        {/if}
      {/each}
      {/if}
      {#if footer}<div class="nav-footer">{@render footer()}</div>{/if}
    </nav>

    <div class="panel">
      <main class="settings-content" bind:this={content}>
        <div class="page">
          {@render children()}
        </div>
      </main>

      {#if ui.compact}
        <button type="button" class="close back" aria-label={m.common.back} onclick={back}>
          <Icon name="arrow-left" size={18} />
        </button>
      {:else}
        <button
          type="button"
          class="close"
          aria-label={m.common.close}
          use:tooltip={{ text: m.common.close, shortcut: 'Esc', placement: 'left' }}
          onclick={onclose}
        >
          <Icon name="x" size={18} />
        </button>
      {/if}
    </div>
</div>

<style>
  .settings {
    position: fixed;
    inset: 0;
    /* Abaixo de menus e modais: o que abre de dentro das configurações (confirmar, excluir conta,
       menu de ações) aparece por cima. */
    z-index: var(--z-settings);
    display: grid;
    grid-template-columns: clamp(232px, 20vw, 292px) minmax(0, 1fr);
    background:
      radial-gradient(900px 520px at 0% 0%, rgb(var(--accent-rgb) / 0.045), transparent 70%),
      var(--bg-canvas);
    animation: settings-in var(--t-slow) var(--ease);
  }

  @keyframes settings-in {
    from {
      opacity: 0;
      transform: scale(1.012);
    }
  }

  .settings-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    padding: 24px 12px 20px 16px;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .search {
    margin-bottom: 14px;
  }

  .heading {
    padding: 16px 10px 6px;
    color: var(--fg-3);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .heading.name {
    overflow: hidden;
    color: var(--fg-2);
    font-size: var(--text-sm);
    letter-spacing: 0;
    text-overflow: ellipsis;
    text-transform: none;
    white-space: nowrap;
  }

  .heading:first-child {
    padding-top: 0;
  }

  .separator {
    height: 1px;
    margin: 10px 10px;
    background: var(--line);
  }

  .nav-footer {
    margin-top: auto;
    padding: 16px 10px 0;
    color: var(--fg-4);
    font-size: var(--text-xs);
  }

  /* O painel da página, igual ao painel principal do app: solto, com 8 px do fundo em volta. */
  .panel {
    position: relative;
    min-width: 0;
    min-height: 0;
    margin: 8px 8px 8px 0;
    border-radius: var(--r-panel);
    background: var(--bg-panel);
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight),
      0 18px 50px -24px rgb(0 0 0 / 0.8);
    overflow: hidden;
  }

  .settings-content {
    height: 100%;
    /* Exposto pra quem gruda embaixo (barra de salvar): o sticky conta a partir do padding. */
    --settings-pad-bottom: 72px;
    padding-bottom: var(--settings-pad-bottom);
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  /* A página no meio do painel. O conteúdo fica numa largura boa de ler (880), e a do perfil
     (formulário e prévia lado a lado) usa a largura toda (1160): todas começam no mesmo ponto,
     então o título não pula de lugar ao trocar de página. */
  .page {
    max-width: 1160px;
    margin: 0 auto;
    padding: 40px 64px 0;
  }

  .page > :global(:not(.wide-page)) {
    max-width: 880px;
  }

  @media (max-width: 1100px) {
    .page {
      padding: 32px 40px 0;
    }
  }

  .close {
    position: absolute;
    top: 16px;
    right: 18px;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--bg-panel);
    color: var(--fg-2);
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  .close:hover {
    background: var(--selected);
    color: var(--fg);
  }

  /* Celular: primeiro a lista de páginas (com o fechar no topo); tocar numa abre a página
     inteira, com o voltar no canto. */
  .settings.compact {
    grid-template-columns: minmax(0, 1fr);
  }

  .compact .settings-nav {
    padding: 12px 12px 20px;
  }

  .compact .panel {
    display: none;
    margin: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .compact.show-page .settings-nav {
    display: none;
  }

  .compact.show-page .panel {
    display: block;
  }

  .compact .page {
    padding: 64px 16px 0;
  }

  .compact .back {
    top: 12px;
    right: auto;
    left: 12px;
  }

  .nav-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    padding-left: 6px;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .nav-head .close {
    position: static;
    flex: none;
  }
</style>
