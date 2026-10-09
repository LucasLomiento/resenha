<script lang="ts">
  import { client } from '../../lib/client.svelte'
  import { i18n, LOCALES, m } from '../../lib/i18n.svelte'
  import { settings } from '../../lib/settings.svelte'
  import { Button, IconButton, PageHeader, Row, Section, Select, Switch } from '../kit'

  const desktop = $derived(client.desktop)
  const update = $derived(client.update)
  const t = $derived(m.settings.app)

  /** Automático primeiro (com o idioma do sistema entre parênteses), depois cada idioma no próprio nome. */
  const languages = $derived([
    { value: 'auto' as const, label: t.language.auto(LOCALES.find((l) => l.id === i18n.system)!.name) },
    ...LOCALES.map((l) => ({ value: l.id, label: l.name })),
  ])

  const updateText = $derived.by(() => {
    switch (update.status) {
      case 'none':
        return t.updates.none
      case 'checking':
        return t.updates.checking
      case 'available':
        return t.updates.available(update.version)
      case 'downloading':
        return t.updates.downloading(update.version, update.percent)
      case 'ready':
        return t.updates.ready(update.version)
      case 'installing':
        return t.updates.installing
      case 'unsupported':
        return t.updates.unsupported
      case 'error':
        return t.updates.error(update.message)
      default:
        return undefined
    }
  })

  function zoom(delta: number) {
    if (!desktop) return
    client.setDesktop({ zoom: Math.round((desktop.zoom + delta) * 10) / 10 })
  }
</script>

<PageHeader title={t.title} />

<Section title={t.language.section} setting="app.language">
  <Row label={t.language.label} description={t.language.description}>
    <Select label={t.language.label} options={languages} bind:value={settings.language} />
  </Row>
</Section>

{#if desktop}
  <Section title={t.startup.section}>
    <Row label={t.startup.open} for="app-autostart" setting="app.autostart">
      <Switch id="app-autostart" checked={desktop.autostart} onchange={(e) => client.setDesktop({ autostart: e.currentTarget.checked })} />
    </Row>
    <Row label={t.startup.hidden} setting="app.hidden" for="app-hidden" indent disabled={!desktop.autostart}>
      <Switch
        id="app-hidden"
        checked={desktop.startHidden}
        disabled={!desktop.autostart}
        onchange={(e) => client.setDesktop({ startHidden: e.currentTarget.checked })}
      />
    </Row>
  </Section>

  <Section title={t.window.section}>
    <Row label={t.window.tray} setting="app.tray" for="app-tray" description={t.window.trayDescription}>
      <Switch id="app-tray" checked={desktop.tray} onchange={(e) => client.setDesktop({ tray: e.currentTarget.checked })} />
    </Row>
    <Row label={t.window.close} setting="app.close" for="app-close" description={t.window.closeDescription} indent disabled={!desktop.tray}>
      <Switch
        id="app-close"
        checked={desktop.closeToTray}
        disabled={!desktop.tray}
        onchange={(e) => client.setDesktop({ closeToTray: e.currentTarget.checked })}
      />
    </Row>
    <Row label={t.window.zoom} setting="app.zoom">
      <div class="zoom">
        <IconButton icon="minus" label={t.window.zoomOut} shortcut="Ctrl −" size="sm" onclick={() => zoom(-0.1)} />
        <span class="tabular">{Math.round(desktop.zoom * 100)}%</span>
        <IconButton icon="plus" label={t.window.zoomIn} shortcut="Ctrl +" size="sm" onclick={() => zoom(0.1)} />
        <Button size="sm" variant="ghost" disabled={desktop.zoom === 1} onclick={() => client.setDesktop({ zoom: 1 })}>{t.window.zoomReset}</Button>
      </div>
    </Row>
  </Section>
{/if}

<Section title={t.updates.section} setting="app.update">
  <Row label="Resenha {client.platform?.version ?? ''}" description={updateText}>
    {#if update.status === 'available'}
      <Button variant="primary" icon="download" onclick={() => window.resenha.update.download()}>{t.updates.download}</Button>
    {:else if update.status === 'ready'}
      <Button variant="primary" icon="restart" onclick={() => client.installUpdate()}>{t.updates.install}</Button>
    {:else if update.status !== 'unsupported'}
      <Button
        loading={update.status === 'checking' || update.status === 'downloading' || update.status === 'installing'}
        onclick={() => window.resenha.update.check()}>{t.updates.check}</Button
      >
    {/if}
  </Row>
</Section>

<style>
  .zoom {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .zoom span {
    min-width: 48px;
    text-align: center;
    font-size: var(--text-sm);
    font-weight: 500;
  }
</style>
