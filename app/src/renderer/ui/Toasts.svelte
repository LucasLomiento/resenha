<script lang="ts">
  import { client } from '../lib/client.svelte'
  import { settings } from '../lib/settings.svelte'
  import { Icon } from './kit'

  /** No app, os avisos ficam no meio do painel (não em cima do dock), acima do campo de mensagem. */
  const inApp = $derived(client.phase === 'app')
  const shift = $derived(inApp ? Math.round((72 + Math.min(Math.max(settings.sidebarWidth, 216), 420)) / 2) : 0)
</script>

<div class="toasts" class:in-app={inApp} style:--shift="{shift}px" aria-live="polite">
  {#each client.toasts as toast (toast.id)}
    <div class="toast" class:info={toast.kind === 'info'} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={toast.kind === 'info' ? 'info' : 'circle-alert'} size={18} />
      <span>{toast.text}</span>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: calc(50% + var(--shift, 0px));
    bottom: 24px;
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    translate: -50% 0;
    pointer-events: none;
  }

  .toasts.in-app {
    bottom: 92px;
  }

  /* Com um diálogo aberto, os avisos vão pro alto (embaixo ficam os botões dele). */
  :global(body:has([role='dialog'])) .toasts {
    top: 20px;
    bottom: auto;
    left: 50%;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    max-width: min(480px, calc(100vw - 2 * var(--shift, 0px) - 48px));
    padding: 11px 16px 11px 13px;
    border-radius: var(--r-xl);
    background: var(--glass-strong);
    backdrop-filter: blur(16px);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    color: var(--fg);
    font-size: var(--text-sm);
    line-height: 1.4;
    animation: toast-in var(--t-slow) var(--ease);
  }

  .toast :global(svg) {
    margin-top: 0.5px;
    color: var(--red);
  }

  .toast.info :global(svg) {
    color: var(--accent-fg);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.97);
    }
  }
</style>
