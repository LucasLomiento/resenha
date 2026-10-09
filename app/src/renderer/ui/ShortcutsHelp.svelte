<script lang="ts">
  import { client } from '../lib/client.svelte'
  import { m } from '../lib/i18n.svelte'
  import { ACTIONS, describeAccelerator } from '../lib/shortcuts'
  import { ui } from '../lib/ui.svelte'
  import { Kbd, Modal } from './kit'

  type Item = [keys: string, label: string]

  const t = $derived(m.app.shortcuts)
  const groups = $derived.by((): { title: string; items: Item[] }[] => {
    const { navigate: nav, messages: msg, window: win } = t
    return [
      {
        title: nav.title,
        items: [
          ['Ctrl + K', nav.switcher],
          ['Ctrl + F', nav.searchSettings],
          ['Alt + ↑', nav.channelUp],
          ['Alt + ↓', nav.channelDown],
          ['Esc', nav.close],
          ['Ctrl + /', nav.help],
        ],
      },
      {
        title: msg.title,
        items: [
          ['Enter', msg.send],
          ['Shift + Enter', msg.newline],
          ['↑', msg.editLast],
          ['Ctrl + V', msg.paste],
          ['@', msg.mention],
          ['#', msg.channel],
          [':', msg.emoji],
        ],
      },
      {
        title: win.title,
        items: [
          ['Ctrl + =', win.zoomIn],
          ['Ctrl + -', win.zoomOut],
          ['Ctrl + 0', win.zoomReset],
        ],
      },
    ]
  })

  const platform = $derived(client.platform?.platform ?? '')
  const call = $derived(
    ACTIONS.map(({ id, label }) => [client.desktop?.shortcuts[id] ?? null, label] as const).filter(([value]) => !!value),
  )

  function openSettings() {
    ui.shortcutsHelp = false
    ui.settings = 'shortcuts'
  }
</script>

<Modal title={t.title} size="xl" onclose={() => (ui.shortcutsHelp = false)}>
  <div class="groups">
    {#each groups as group (group.title)}
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
      <h3>{t.call} <span class="hint">{t.callHint}</span></h3>
      {#each call as [value, label] (label)}
        <div class="item">
          <span>{label}</span>
          <Kbd keys={describeAccelerator(value, platform)} />
        </div>
      {:else}
        <p class="empty">{t.none}</p>
      {/each}
      <button class="link" onclick={openSettings}>{t.change}</button>
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
