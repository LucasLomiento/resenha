<script lang="ts">
  import { client } from '../lib/client.svelte'
  import { m } from '../lib/i18n.svelte'
  import { Avatar, IconButton, layer, portal } from './kit'

  // Pode virar null no meio de um clique (atendeu ou recusou).
  const incoming = $derived(client.incomingCall)
  const caller = $derived(incoming ? (client.user(incoming.from) ?? client.home?.dm(incoming.channelId)?.user) : undefined)
  const t = $derived(m.app.incoming)
</script>

<!-- Ligação chegando: cartão no canto, por cima de tudo, até atender ou recusar. -->
{#if incoming}
<div class="ring" use:portal use:layer={() => client.declineCall()} role="alertdialog" aria-label={t.label(caller?.name)}>
  <div class="who">
    <span class="halo"><Avatar id={incoming.from} name={caller?.name ?? '?'} size={56} src={client.avatarOf(incoming.from)} cutout="var(--bg-raised)" /></span>
    <div class="text">
      <strong>{caller?.name ?? m.app.someone}</strong>
      <span>{incoming.video ? t.video : t.voice}</span>
    </div>
  </div>
  <div class="actions">
    <IconButton icon="phone-off" label={t.decline} size="xl" variant="subtle" tone="danger" active onclick={() => client.declineCall()} />
    <IconButton icon="phone" label={t.accept} size="xl" variant="subtle" tone="success" active onclick={() => client.acceptCall()} />
  </div>
</div>
{/if}

<style>
  .ring {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 80;
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 16px 16px 16px 18px;
    border-radius: var(--r-2xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    animation: rs-pop-in var(--t-slow) var(--ease);
  }

  .who {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .halo {
    border-radius: 50%;
    animation: halo 1.6s ease-out infinite;
  }

  @keyframes halo {
    0% {
      box-shadow: 0 0 0 0 rgb(52 211 153 / 0.45);
    }
    100% {
      box-shadow: 0 0 0 16px rgb(52 211 153 / 0);
    }
  }

  .text {
    display: flex;
    flex-direction: column;
  }

  strong {
    font-size: var(--text-lg);
    font-weight: 650;
  }

  .text span {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .actions {
    display: flex;
    gap: 10px;
  }
</style>
