<script lang="ts">
  import { store } from '../lib/store.svelte'
</script>

<div class="toasts" aria-live="polite">
  {#each store.toasts as toast (toast.id)}
    <div class="toast" class:info={toast.kind === 'info'}>{toast.text}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    z-index: 100;
    pointer-events: none;
  }

  .toast {
    max-width: 520px;
    padding: 10px 14px;
    border-radius: var(--radius);
    background: #3a1f24;
    border: 1px solid #6b2b33;
    color: #ffd9dd;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
  }

  .toast.info {
    background: #1f2440;
    border-color: #3a4380;
    color: #dfe3ff;
  }
</style>
