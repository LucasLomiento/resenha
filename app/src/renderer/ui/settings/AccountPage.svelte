<script lang="ts">
  import { userGradient } from '../../lib/format'
  import { store } from '../../lib/store.svelte'
  import { Avatar, Badge, PageHeader } from '../kit'

  const me = $derived(store.me)
</script>

<!-- Foto, nome de usuário, bio e aparelhos chegam com as contas novas (ver ui/proto, "Conta"). -->
<PageHeader title="Minha conta" />

{#if me}
  <div class="profile">
    <div class="banner" style:background={userGradient(me.id)}></div>
    <div class="identity">
      <Avatar id={me.id} name={me.name} size={72} status={store.status === 'open' ? 'online' : 'offline'} cutout="var(--bg-raised)" />
      <div class="names">
        <span class="name">{me.name}</span>
        {#if me.admin}<Badge tone="accent">Admin</Badge>{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .profile {
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight);
    overflow: hidden;
  }

  .banner {
    position: relative;
    height: 88px;
    opacity: 0.7;
  }

  .banner::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 30%, rgb(26 26 34 / 0.55));
  }

  .identity {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    margin-top: -36px;
    padding: 0 20px 20px;
  }

  .identity :global(.avatar) {
    box-shadow: 0 0 0 5px var(--bg-raised);
  }

  .names {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding-bottom: 6px;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.015em;
  }
</style>
