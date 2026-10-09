<script lang="ts">
  import { client } from '../lib/client.svelte'
  import { m } from '../lib/i18n.svelte'
  import { settings } from '../lib/settings.svelte'
  import { Button, Icon, IconButton } from './kit'

  /**
   * Aviso de versão nova, no canto: aparece quando a atualização está pronta (o app
   * baixa sozinho fora de call) ou quando ela saiu e está esperando a call acabar.
   * "Depois" esconde até a próxima versão; o botão no pé do trilho continua lá.
   */
  const RELEASES = 'https://lucaslomiento.github.io/resenha/#v'

  const update = $derived(client.update)
  const t = $derived(m.app.update)
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
    new Notification(t.title, { body: t.ready(update.version), silent: true }).onclick = () => window.resenha.showWindow()
  })
</script>

{#if visible && version}
  <div class="notice" role="status" aria-label={t.title}>
    <span class="badge"><Icon name="download" size={18} /></span>
    <div class="body">
      <strong>{t.arrived(version)}</strong>
      <p>
        {#if update.status === 'available'}
          {t.afterCall}
        {:else if update.status === 'downloading'}
          {t.downloading(update.percent)}
        {:else if update.status === 'installing'}
          {t.installing}
        {:else if inCall}
          {t.leavesCall}
        {:else}
          {t.restart}
        {/if}
      </p>
      <div class="actions">
        <a class="notes" href="{RELEASES}{version}" target="_blank" rel="noreferrer">{t.notes}<Icon name="arrow-up-right" size={13} /></a>
        {#if update.status === 'available'}
          <Button size="sm" variant="primary" icon="download" onclick={() => window.resenha.update.download()}>{t.download}</Button>
        {:else if update.status === 'ready'}
          <Button size="sm" variant="primary" icon="restart" onclick={() => client.installUpdate()}>{t.install}</Button>
        {:else}
          <Button size="sm" variant="primary" loading>{t.wait}</Button>
        {/if}
      </div>
    </div>
    {#if update.status !== 'installing'}
      <IconButton icon="x" label={t.later} size="sm" onclick={() => (settings.updateDismissed = version)} />
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
