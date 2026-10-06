<script lang="ts" module>
  import type { IconName } from './Icon.svelte'

  export type SettingsNavEntry =
    | { id: string; label: string; icon: IconName; tone?: 'default' | 'danger' }
    | { heading: string }
    | { separator: true }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'
  import { layer } from './layers'
  import NavItem from './NavItem.svelte'

  let {
    title,
    nav,
    active,
    onselect,
    onclose,
    inline = false,
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
    /** Rodapé da navegação (versão do app, por exemplo). */
    footer?: Snippet
    children: Snippet
  } = $props()

  let content = $state<HTMLElement>()

  // Trocou de página: começa do topo.
  $effect(() => {
    void active
    content?.scrollTo({ top: 0 })
  })

  const closeLayer = (node: HTMLElement) => (inline ? undefined : layer(node, () => onclose()))
</script>

<!-- Configurações em tela cheia: navegação à esquerda, página à direita, fechar no canto (Esc). -->
<!-- data-portal-root: modais e menus abertos daqui entram nesta camada (senão ficariam atrás dela). -->
<div class="settings" role="dialog" aria-modal="true" aria-label={title} data-portal-root={inline ? undefined : ''} use:closeLayer>
  <div class="frame">
    <nav class="settings-nav" aria-label={title}>
      {#each nav as entry, i (i)}
        {#if 'separator' in entry}
          <div class="separator" role="separator"></div>
        {:else if 'heading' in entry}
          <div class="heading">{entry.heading}</div>
        {:else}
          <NavItem
            label={entry.label}
            icon={entry.icon}
            tone={entry.tone}
            active={entry.id === active}
            onclick={() => onselect(entry.id)}
          />
        {/if}
      {/each}
      {#if footer}<div class="nav-footer">{@render footer()}</div>{/if}
    </nav>

    <main class="settings-content" bind:this={content}>
      <div class="page">
        {@render children()}
      </div>
    </main>

    <div class="close">
      <button type="button" aria-label="Fechar" onclick={onclose}><Icon name="x" size={18} /></button>
      <span aria-hidden="true">Esc</span>
    </div>
  </div>
</div>

<style>
  .settings {
    position: fixed;
    inset: 0;
    z-index: var(--z-settings);
    background:
      radial-gradient(900px 500px at 0% 0%, rgb(111 125 255 / 0.06), transparent 70%),
      var(--bg-canvas);
    animation: settings-in var(--t-slow) var(--ease);
  }

  @keyframes settings-in {
    from {
      opacity: 0;
      transform: scale(1.015);
    }
  }

  .frame {
    position: relative;
    display: grid;
    grid-template-columns: minmax(200px, 236px) minmax(0, 1fr);
    height: 100%;
    max-width: 1080px;
    margin: 0 auto;
  }

  .settings-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 56px 12px 24px 16px;
    overflow-y: auto;
  }

  .heading {
    padding: 14px 10px 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
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

  .settings-content {
    min-width: 0;
    padding: 56px 88px 72px 40px;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  .page {
    max-width: 660px;
  }

  .close {
    position: absolute;
    top: 48px;
    right: 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    color: var(--fg-3);
    font-size: var(--text-2xs);
    font-weight: 600;
  }

  .close button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: var(--fg-2);
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  .close button:hover {
    background: var(--hover);
    color: var(--fg);
  }
</style>
