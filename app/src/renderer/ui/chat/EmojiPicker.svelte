<script lang="ts">
  import { CATEGORIES, recentEmoji, rememberEmoji, searchEmoji } from '../../lib/emoji'
  import { Icon, Popover } from '../kit'
  import type { Placement } from '../kit/position'

  let {
    anchor,
    placement = 'top-end',
    onpick,
    onclose,
  }: {
    anchor: HTMLElement | { x: number; y: number }
    placement?: Placement
    onpick: (emoji: string) => void
    onclose: () => void
  } = $props()

  let query = $state('')
  let section = $state('recent')
  const recent = recentEmoji()
  const results = $derived(searchEmoji(query))
  let grid = $state<HTMLDivElement>()

  function pick(emoji: string) {
    rememberEmoji(emoji)
    onpick(emoji)
  }

  function jump(id: string) {
    section = id
    grid?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ block: 'start' })
  }

  function autofocus(node: HTMLInputElement) {
    requestAnimationFrame(() => node.focus())
  }
</script>

<Popover {anchor} {placement} {onclose} width={344} label="Emojis">
  <div class="picker">
    <label class="search">
      <Icon name="search" size={15} />
      <input
        bind:value={query}
        placeholder="Procurar emoji"
        aria-label="Procurar emoji"
        use:autofocus
        onkeydown={(e) => {
          if (e.key === 'Enter' && results[0]) {
            e.preventDefault()
            pick(results[0].e)
          }
        }}
      />
    </label>

    {#if !query}
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={section === 'recent'} aria-label="Recentes" class:on={section === 'recent'} onclick={() => jump('recent')}>
          <Icon name="clock" size={16} />
        </button>
        {#each CATEGORIES as category (category.id)}
          <button role="tab" aria-selected={section === category.id} aria-label={category.label} class:on={section === category.id} onclick={() => jump(category.id)}>
            {category.icon}
          </button>
        {/each}
      </div>
    {/if}

    <div class="grid" bind:this={grid}>
      {#if query}
        {#if results.length}
          <div class="emojis">
            {#each results as entry (entry.e)}
              <button class="emoji" aria-label={entry.k.split(' ')[0]} title={entry.k} onclick={() => pick(entry.e)}>{entry.e}</button>
            {/each}
          </div>
        {:else}
          <p class="empty">Nenhum emoji com “{query}”.</p>
        {/if}
      {:else}
        <div class="label" data-section="recent">Recentes</div>
        <div class="emojis">
          {#each recent as emoji (emoji)}
            <button class="emoji" aria-label={emoji} onclick={() => pick(emoji)}>{emoji}</button>
          {/each}
        </div>
        {#each CATEGORIES as category (category.id)}
          <div class="label" data-section={category.id}>{category.label}</div>
          <div class="emojis">
            {#each category.list as entry (entry.e)}
              <button class="emoji" aria-label={entry.k.split(' ')[0]} title={entry.k} onclick={() => pick(entry.e)}>{entry.e}</button>
            {/each}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</Popover>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    height: 380px;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: 34px;
    margin: 10px 10px 6px;
    padding: 0 10px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-3);
  }

  .search:focus-within {
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .tabs {
    display: flex;
    gap: 2px;
    flex: none;
    padding: 0 8px 6px;
    border-bottom: 1px solid var(--line);
  }

  .tabs button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 30px;
    border-radius: var(--r-md);
    color: var(--fg-3);
    font-size: 17px;
    filter: grayscale(0.6);
    opacity: 0.75;
    transition:
      background-color var(--t-fast) var(--ease),
      opacity var(--t-fast) var(--ease);
  }

  .tabs button:hover,
  .tabs button.on {
    background: var(--hover);
    filter: none;
    opacity: 1;
  }

  .grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 8px 10px;
    scrollbar-width: thin;
  }

  .label {
    padding: 10px 4px 4px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
    scroll-margin-top: 4px;
  }

  .emojis {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
  }

  .emoji {
    display: grid;
    place-items: center;
    height: 36px;
    border-radius: var(--r-md);
    font-size: 22px;
    line-height: 1;
    transition:
      background-color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }

  .emoji:hover {
    background: var(--hover);
    transform: scale(1.12);
  }

  .empty {
    padding: 24px 8px;
    color: var(--fg-3);
    font-size: var(--text-sm);
    text-align: center;
  }
</style>
