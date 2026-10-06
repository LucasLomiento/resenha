<script lang="ts">
  import { store } from '../lib/store.svelte'
  import { Icon } from './kit'
</script>

<div class="toasts" aria-live="polite">
  {#each store.toasts as toast (toast.id)}
    <div class="toast" class:info={toast.kind === 'info'} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={toast.kind === 'info' ? 'info' : 'circle-alert'} size={18} />
      <span>{toast.text}</span>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 24px;
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    translate: -50% 0;
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    max-width: 480px;
    padding: 11px 16px 11px 12px;
    border-radius: var(--r-lg);
    background: #1f1f28;
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
