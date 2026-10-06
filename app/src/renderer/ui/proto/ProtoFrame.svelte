<script lang="ts">
  import type { Snippet } from 'svelte'
  import ServerRail from './ServerRail.svelte'

  let {
    rail,
    sidebar,
    children,
    overlay,
  }: {
    /** 'home' ou id do servidor aberto no trilho. */
    rail: string
    sidebar: Snippet
    children: Snippet
    /** Popovers, menus e modais por cima de tudo. */
    overlay?: Snippet
  } = $props()
</script>

<!-- A janela da arquitetura nova: trilho (72) + barra lateral (248) + painel solto. -->
<div class="frame">
  <ServerRail active={rail} />
  {@render sidebar()}
  <main class="panel">
    {@render children()}
  </main>
  {@render overlay?.()}
</div>

<style>
  .frame {
    position: relative;
    display: grid;
    grid-template-columns: 72px 248px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    background:
      radial-gradient(520px 360px at 0% 0%, rgb(111 125 255 / 0.07), transparent 70%),
      var(--bg-canvas);
  }

  .panel {
    position: relative;
    min-width: 0;
    min-height: 0;
    margin: 8px 8px 8px 0;
    border-radius: var(--r-xl);
    background: var(--bg-panel);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-sm);
    overflow: hidden;
  }
</style>
