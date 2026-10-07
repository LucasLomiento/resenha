<script lang="ts">
  import { client } from '../lib/client.svelte'
  import { ACTIONS, describeAccelerator } from '../lib/shortcuts'
  import { ui } from '../lib/ui.svelte'
  import { Kbd, Modal } from './kit'

  type Item = [keys: string, label: string]

  const GROUPS: { title: string; items: Item[] }[] = [
    {
      title: 'Navegar',
      items: [
        ['Ctrl + K', 'Pular pra um canal, conversa ou servidor'],
        ['Alt + ↑', 'Canal de cima'],
        ['Alt + ↓', 'Canal de baixo'],
        ['Esc', 'Fechar o que estiver aberto'],
        ['Ctrl + /', 'Esta lista'],
      ],
    },
    {
      title: 'Mensagens',
      items: [
        ['Enter', 'Mandar'],
        ['Shift + Enter', 'Pular linha'],
        ['↑', 'Editar a última mensagem (com o campo vazio)'],
        ['Ctrl + V', 'Colar print ou arquivo'],
        ['@', 'Mencionar alguém'],
        ['#', 'Citar um canal'],
        [':', 'Emoji pelo nome'],
      ],
    },
    {
      title: 'Janela',
      items: [
        ['Ctrl + =', 'Aumentar a interface'],
        ['Ctrl + -', 'Diminuir a interface'],
        ['Ctrl + 0', 'Tamanho normal'],
      ],
    },
  ]

  const platform = $derived(client.platform?.platform ?? '')
  const call = $derived(
    ACTIONS.map(({ id, label }) => [client.desktop?.shortcuts[id] ?? null, label] as const).filter(([value]) => !!value),
  )

  function openSettings() {
    ui.shortcutsHelp = false
    ui.settings = 'shortcuts'
  }
</script>

<Modal title="Atalhos" size="xl" onclose={() => (ui.shortcutsHelp = false)}>
  <div class="groups">
    {#each GROUPS as group (group.title)}
      <section>
        <h3>{group.title}</h3>
        {#each group.items as [keys, label] (keys)}
          <div class="item">
            <span>{label}</span>
            <Kbd {keys} />
          </div>
        {/each}
      </section>
    {/each}
    <section>
      <h3>Call <span class="hint">(valem com o app minimizado)</span></h3>
      {#each call as [value, label] (label)}
        <div class="item">
          <span>{label}</span>
          <Kbd keys={describeAccelerator(value, platform)} />
        </div>
      {:else}
        <p class="empty">Nenhum configurado.</p>
      {/each}
      <button class="link" onclick={openSettings}>Mudar os atalhos da call</button>
    </section>
  </div>
</Modal>

<style>
  .groups {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px 28px;
  }

  h3 {
    margin-bottom: 8px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .hint {
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }

  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .empty {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .link {
    margin-top: 8px;
    color: var(--accent-fg);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .link:hover {
    text-decoration: underline;
  }
</style>
