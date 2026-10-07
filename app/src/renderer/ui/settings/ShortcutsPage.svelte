<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { ShortcutAction } from '../../../preload/api'
  import { ACTIONS, acceleratorFrom, describeAccelerator } from '../../lib/shortcuts'
  import { client } from '../../lib/client.svelte'
  import { ui } from '../../lib/ui.svelte'
  import { Button, Icon, IconButton, Kbd, PageHeader, Row, Section } from '../kit'

  /** Nomes curtos: o atalho alterna (aperta de novo, desfaz). */
  const LABELS: Record<ShortcutAction, string> = {
    'toggle-mute': 'Mutar',
    'toggle-deafen': 'Ensurdecer',
    'toggle-share': 'Compartilhar tela',
    'leave-call': 'Sair da call',
    'show-window': 'Mostrar o Resenha',
  }

  let recording = $state<ShortcutAction | null>(null)
  let failed = $state<ShortcutAction[]>([])

  // O Esc (pilha de camadas) cancela a gravação pelo ui.recordingShortcut.
  $effect(() => {
    if (!ui.recordingShortcut) recording = null
  })

  function record(action: ShortcutAction) {
    recording = action
    ui.recordingShortcut = true
  }

  function stopRecording() {
    recording = null
    ui.recordingShortcut = false
  }

  async function setShortcut(action: ShortcutAction, accelerator: string | null) {
    if (!client.desktop) return
    // O mesmo atalho não pode ficar em duas ações.
    const shortcuts = { ...client.desktop.shortcuts }
    for (const key of Object.keys(shortcuts) as ShortcutAction[]) if (accelerator && shortcuts[key] === accelerator) shortcuts[key] = null
    shortcuts[action] = accelerator
    failed = await client.setDesktop({ shortcuts })
  }

  function onRecordKey(event: KeyboardEvent) {
    if (!recording || event.key === 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    const accelerator = acceleratorFrom(event)
    if (!accelerator) return // só modificador até agora: espera a tecla de verdade
    const action = recording
    stopRecording()
    setShortcut(action, accelerator)
  }

  onDestroy(() => (ui.recordingShortcut = false))

  const platform = $derived(client.platform?.platform ?? '')
</script>

<svelte:window onkeydowncapture={onRecordKey} />

<PageHeader title="Atalhos" description="Funcionam mesmo com o Resenha minimizado.">
  {#snippet actions()}
    <Button size="sm" variant="secondary" icon="keyboard" onclick={() => (ui.shortcutsHelp = true)}>Todos os atalhos</Button>
  {/snippet}
</PageHeader>

{#if client.desktop}
  <Section>
    {#each ACTIONS as action (action.id)}
      {@const value = client.desktop.shortcuts[action.id]}
      <Row label={LABELS[action.id]}>
        <button
          class="key"
          class:recording={recording === action.id}
          aria-label="Mudar o atalho de {LABELS[action.id]}"
          onclick={() => (recording === action.id ? stopRecording() : record(action.id))}
        >
          {#if recording === action.id}
            Aperte as teclas…
          {:else if value}
            <Kbd keys={describeAccelerator(value, platform)} />
          {:else}
            <span class="none">Nenhum</span>
          {/if}
        </button>
        <IconButton icon="x" label="Remover atalho" size="sm" disabled={!value} onclick={() => setShortcut(action.id, null)} />
      </Row>
      {#if failed.includes(action.id)}
        <div class="failed">
          <Icon name="triangle-alert" size={14} />
          O sistema não deixou usar esse atalho fora do app. Com o Resenha aberto, ele funciona.
        </div>
      {/if}
    {/each}
  </Section>
{/if}

{#if client.platform?.hyprland}
  <Section title="No Hyprland" plain>
    <p class="hypr">
      Pra funcionar com o app em segundo plano, crie um bind no seu config chamando
      <code class="selectable">resenha --action=toggle-mute</code>. Também vale <code>toggle-deafen</code>,
      <code>toggle-share</code>, <code>leave-call</code> e <code>show-window</code>.
    </p>
  </Section>
{/if}

<style>
  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 200px;
    height: var(--h-md);
    padding: 0 10px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--fg-2);
    font-size: var(--text-sm);
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .key:hover {
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18);
  }

  .key.recording {
    box-shadow:
      inset 0 0 0 1px var(--accent-line),
      0 0 0 3px rgb(122 108 255 / 0.18);
    color: var(--accent-fg);
    animation: rs-pulse 1.4s ease-in-out infinite;
  }

  .none {
    color: var(--fg-3);
  }

  .failed {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px 12px;
    color: var(--yellow);
    font-size: var(--text-xs);
  }

  .hypr {
    color: var(--fg-2);
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  code {
    padding: 1px 5px;
    border-radius: var(--r-xs);
    background: rgb(255 255 255 / 0.07);
    font: 12px var(--mono);
    white-space: nowrap;
  }
</style>
