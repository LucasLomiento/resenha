<script lang="ts">
  import type { Status } from '../../../../shared/protocol'
  import { client } from '../lib/client.svelte'
  import { m } from '../lib/i18n.svelte'
  import { ui } from '../lib/ui.svelte'
  import { Icon, Popover, StatusDot } from './kit'

  let { anchor, onclose }: { anchor: HTMLElement; onclose: () => void } = $props()

  const t = $derived(m.app.statusMenu)
  const options = $derived(
    (['online', 'idle', 'dnd', 'invisible'] as const).map((status): { status: Status; label: string; hint?: string } => ({
      status,
      label: m.common.presence[status],
      hint: status === 'online' ? undefined : t.hints[status],
    })),
  )

  let editing = $state(false)
  let text = $state(client.statusText ?? '')

  function choose(status: Status) {
    client.setStatus(status)
    onclose()
  }

  function saveText() {
    const value = text.trim().slice(0, 128)
    client.setStatus(client.status, value || null)
    editing = false
  }

  function autofocus(node: HTMLInputElement) {
    requestAnimationFrame(() => node.focus())
  }
</script>

<!-- Abre ao clicar no seu avatar no dock. -->
<Popover {anchor} placement="top-start" width={272} label={t.label} {onclose}>
  <div class="menu" role="menu">
    {#if editing}
      <div class="custom-edit">
        <input
          bind:value={text}
          maxlength={128}
          placeholder={t.placeholder}
          aria-label={t.custom}
          data-own-escape
          use:autofocus
          onkeydown={(e) => {
            if (e.key === 'Enter') saveText()
            if (e.key === 'Escape') {
              e.preventDefault()
              editing = false
            }
          }}
        />
        <button class="save" onclick={saveText}>{m.common.save}</button>
      </div>
    {:else}
      <div class="custom-row">
        <button class="custom" role="menuitem" onclick={() => ((text = client.statusText ?? ''), (editing = true))}>
          <span class="bubble" class:empty={!client.statusText}>
            <Icon name="emoji" size={16} />
            {client.statusText ?? t.set}
          </span>
          <Icon name="pencil" size={14} />
        </button>
        {#if client.statusText}
          <button class="clear" aria-label={t.clear} onclick={() => client.setStatus(client.status, null)}><Icon name="x" size={14} /></button>
        {/if}
      </div>
    {/if}
    <div class="sep"></div>
    {#each options as option (option.status)}
      {@const on = client.status === option.status}
      <button class="option" class:on role="menuitemradio" aria-checked={on} onclick={() => choose(option.status)}>
        <StatusDot status={option.status === 'invisible' ? 'offline' : option.status} size={10} cutout="var(--bg-raised)" />
        <span class="text">
          <span class="label">{option.label}</span>
          {#if option.hint}<span class="hint">{option.hint}</span>{/if}
        </span>
        {#if on}<Icon name="check" size={16} />{/if}
      </button>
    {/each}
    <div class="sep"></div>
    <button
      class="option"
      role="menuitem"
      onclick={() => {
        ui.settings = 'profile'
        onclose()
      }}
    >
      <Icon name="user" size={16} />
      <span class="text"><span class="label">{t.editProfile}</span></span>
    </button>
  </div>
</Popover>

<style>
  .menu {
    padding: 6px;
  }

  .custom-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .custom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border-radius: var(--r-md);
    color: var(--fg-3);
  }

  .custom:hover {
    background: var(--selected);
  }

  .bubble {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 6px 10px;
    overflow: hidden;
    border-radius: 12px 12px 12px 4px;
    background: rgb(255 255 255 / 0.06);
    color: var(--fg);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bubble.empty {
    color: var(--fg-3);
  }

  .clear {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: var(--r-md);
    color: var(--fg-3);
  }

  .clear:hover {
    background: var(--selected);
    color: var(--fg);
  }

  .custom-edit {
    display: flex;
    gap: 6px;
    padding: 4px;
  }

  .custom-edit input {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--r-md);
    outline: none;
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--accent-line);
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .save {
    padding: 0 10px;
    border-radius: var(--r-md);
    background: var(--accent);
    color: #fff;
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .sep {
    height: 1px;
    margin: 6px;
    background: var(--line);
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    border-radius: var(--r-md);
    color: var(--fg-2);
    text-align: left;
  }

  .option:hover {
    background: var(--selected);
  }

  .option :global(.status-dot) {
    margin-top: 5px;
  }

  .option > :global(svg:last-child) {
    margin-top: 2px;
    color: var(--accent-fg);
  }

  .option > :global(svg:first-child) {
    margin-top: 2px;
  }

  .text {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .label {
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .hint {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }
</style>
