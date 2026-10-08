<script lang="ts">
  import { client } from '../lib/client.svelte'
  import { Button, Icon, IconButton } from './kit'

  /**
   * Depois de atualizar no meio de uma call: uma pílula em cima perguntando se a
   * pessoa quer voltar pra ela. Some ao reconectar, ao dispensar ou ao entrar em
   * outra call.
   */
  const offer = $derived(client.rejoinOffer)
</script>

{#if offer}
  <div class="rejoin" role="alertdialog" aria-label="Voltar pra call">
    <span class="icon"><Icon name={offer.kind === 'dm' ? 'phone' : 'volume'} size={16} /></span>
    <p>
      Você estava em <strong>{offer.label}</strong>
      <span class="place">· {offer.place}</span> antes de atualizar.
    </p>
    <Button size="sm" variant="primary" icon="phone" onclick={() => client.acceptRejoin()}>Reconectar</Button>
    <IconButton size="sm" icon="x" label="Agora não" onclick={() => client.dismissRejoin()} />
  </div>
{/if}

<style>
  .rejoin {
    position: absolute;
    top: 12px;
    left: 50%;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: calc(100% - 32px);
    padding: 6px 6px 6px 8px;
    border-radius: var(--r-full);
    background: color-mix(in srgb, var(--bg-overlay) 88%, transparent);
    backdrop-filter: blur(14px);
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 12px 32px rgb(0 0 0 / 0.45);
    translate: -50% 0;
    animation: rejoin-in 320ms var(--ease) both;
  }

  .icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  p {
    min-width: 0;
    overflow: hidden;
    color: var(--fg-2);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--fg);
    font-weight: 600;
  }

  .place {
    color: var(--fg-3);
  }

  @keyframes rejoin-in {
    from {
      opacity: 0;
      translate: -50% -10px;
    }
  }
</style>
