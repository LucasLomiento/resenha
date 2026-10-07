<script lang="ts">
  import { client } from '../../lib/client.svelte'
  import { Button, IconButton, PageHeader, Row, Section, Switch } from '../kit'

  const desktop = $derived(client.desktop)
  const update = $derived(client.update)

  const updateText = $derived.by(() => {
    switch (update.status) {
      case 'none':
        return 'Você está na versão mais nova.'
      case 'checking':
        return 'Procurando…'
      case 'available':
        return `A versão ${update.version} saiu.`
      case 'downloading':
        return `Baixando a ${update.version} (${update.percent}%).`
      case 'ready':
        return `A ${update.version} está pronta pra instalar.`
      case 'installing':
        return 'Instalando…'
      case 'unsupported':
        return 'Este jeito de instalar não se atualiza sozinho.'
      case 'error':
        return `Não deu pra atualizar: ${update.message}`
      default:
        return undefined
    }
  })

  function zoom(delta: number) {
    if (!desktop) return
    client.setDesktop({ zoom: Math.round((desktop.zoom + delta) * 10) / 10 })
  }
</script>

<PageHeader title="Aplicativo" />

{#if desktop}
  <Section title="Ao ligar o computador">
    <Row label="Abrir o Resenha" for="app-autostart" setting="app.autostart">
      <Switch id="app-autostart" checked={desktop.autostart} onchange={(e) => client.setDesktop({ autostart: e.currentTarget.checked })} />
    </Row>
    <Row label="Começar minimizado" setting="app.hidden" for="app-hidden" indent disabled={!desktop.autostart}>
      <Switch
        id="app-hidden"
        checked={desktop.startHidden}
        disabled={!desktop.autostart}
        onchange={(e) => client.setDesktop({ startHidden: e.currentTarget.checked })}
      />
    </Row>
  </Section>

  <Section title="Janela">
    <Row label="Ícone na bandeja" setting="app.tray" for="app-tray" description="Mutar, ensurdecer e sair da call pelo ícone.">
      <Switch id="app-tray" checked={desktop.tray} onchange={(e) => client.setDesktop({ tray: e.currentTarget.checked })} />
    </Row>
    <Row label="Fechar só esconde a janela" setting="app.close" for="app-close" description="A call continua." indent disabled={!desktop.tray}>
      <Switch
        id="app-close"
        checked={desktop.closeToTray}
        disabled={!desktop.tray}
        onchange={(e) => client.setDesktop({ closeToTray: e.currentTarget.checked })}
      />
    </Row>
    <Row label="Tamanho da interface" setting="app.zoom">
      <div class="zoom">
        <IconButton icon="minus" label="Diminuir" shortcut="Ctrl −" size="sm" onclick={() => zoom(-0.1)} />
        <span class="tabular">{Math.round(desktop.zoom * 100)}%</span>
        <IconButton icon="plus" label="Aumentar" shortcut="Ctrl +" size="sm" onclick={() => zoom(0.1)} />
        <Button size="sm" variant="ghost" disabled={desktop.zoom === 1} onclick={() => client.setDesktop({ zoom: 1 })}>Padrão</Button>
      </div>
    </Row>
  </Section>
{/if}

<Section title="Atualizações" setting="app.update">
  <Row label="Resenha {client.platform?.version ?? ''}" description={updateText}>
    {#if update.status === 'available'}
      <Button variant="primary" icon="download" onclick={() => window.resenha.update.download()}>Baixar</Button>
    {:else if update.status === 'ready'}
      <Button variant="primary" icon="restart" onclick={() => window.resenha.update.install()}>Reiniciar e atualizar</Button>
    {:else if update.status !== 'unsupported'}
      <Button
        loading={update.status === 'checking' || update.status === 'downloading' || update.status === 'installing'}
        onclick={() => window.resenha.update.check()}>Procurar atualização</Button
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
