<script lang="ts">
  import { client } from '../lib/client.svelte'
  import { settings } from '../lib/settings.svelte'
  import { Button, Icon, IconButton } from './kit'

  /**
   * Aviso de versão nova, no canto: aparece quando a atualização está pronta (o app
   * baixa sozinho fora de call) ou quando ela saiu e está esperando a call acabar.
   * "Depois" esconde até a próxima versão; o botão no pé do trilho continua lá.
   */
  const RELEASES = 'https://github.com/LucasLomiento/resenha/releases/tag/v'

  const update = $derived(client.update)
  const version = $derived('version' in update ? update.version : null)
  const inCall = $derived(!!client.call.channelId)
  const visible = $derived(
    !!version && settings.updateDismissed !== version && ['available', 'downloading', 'ready', 'installing'].includes(update.status),
  )

  // Fora do app: um aviso do sistema por versão, quando ela fica pronta.
  let notified: string | null = null
  $effect(() => {
    if (update.status !== 'ready' || notified === update.version || settings.updateDismissed === update.version) return
    notified = update.version
    if (document.hasFocus()) return
    new Notification('Atualização do Resenha', { body: `A versão ${update.version} está pronta pra instalar.`, silent: true }).onclick = () =>
      window.resenha.attention()
  })
</script>

{#if visible && version}
  <div class="notice" role="status" aria-label="Atualização do Resenha">
    <span class="badge"><Icon name="download" size={18} /></span>
    <div class="body">
      <strong>Resenha {version} chegou</strong>
      <p>
        {#if update.status === 'available'}
          Baixa sozinha quando você sair da call.
        {:else if update.status === 'downloading'}
          Baixando… {update.percent}%
        {:else if update.status === 'installing'}
          Instalando. Se pedir senha, é pra isso.
        {:else if inCall}
          Reiniciar agora tira você da call.
        {:else}
          Reinicie pra usar a versão nova.
        {/if}
      </p>
      <div class="actions">
        <a class="notes" href="{RELEASES}{version}" target="_blank" rel="noreferrer">Novidades<Icon name="arrow-up-right" size={13} /></a>
        {#if update.status === 'available'}
          <Button size="sm" variant="primary" icon="download" onclick={() => window.resenha.update.download()}>Baixar agora</Button>
        {:else if update.status === 'ready'}
          <Button size="sm" variant="primary" icon="restart" onclick={() => window.resenha.update.install()}>Reiniciar e atualizar</Button>
        {:else}
          <Button size="sm" variant="primary" loading>Aguarde</Button>
        {/if}
      </div>
    </div>
    {#if update.status !== 'installing'}
      <IconButton icon="x" label="Depois" size="sm" onclick={() => (settings.updateDismissed = version)} />
    {/if}
  </div>
{/if}

<style>
  .notice {
    position: fixed;
    right: 20px;
    /* Acima do campo de mensagem, pra não tampar quem está digitando. */
    bottom: 84px;
    z-index: var(--z-toast);
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 340px;
    padding: 14px 10px 14px 14px;
    border-radius: var(--r-2xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    animation: rs-pop-in var(--t-slow) var(--ease);
  }

  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  strong {
    display: block;
    font-size: var(--text-md);
    font-weight: 600;
  }

  p {
    margin-top: 2px;
    color: var(--fg-3);
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 12px;
  }

  .notes {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 500;
    text-decoration: none;
  }

  .notes:hover {
    color: var(--fg);
  }
</style>
