<script lang="ts">
  import { Avatar, Icon, IconButton, Segmented } from '../kit'
  import { displayName, messages, roleColor, stamp } from './data'

  let { query }: { query: string } = $props()

  const hits = messages.filter((m) => m.content.toLowerCase().includes(query.toLowerCase()))
  let order = $state<'recent' | 'relevant'>('recent')

  function parts(text: string) {
    const out: { t: string; on: boolean }[] = []
    const lower = text.toLowerCase()
    const q = query.toLowerCase()
    let at = 0
    for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
      if (i > at) out.push({ t: text.slice(at, i), on: false })
      out.push({ t: text.slice(i, i + q.length), on: true })
      at = i + q.length
    }
    if (at < text.length) out.push({ t: text.slice(at), on: false })
    return out
  }

  const clean = (text: string) => text.replace(/<@[\w-]+>/g, '@Lucas').replace(/<#[\w-]+>/g, '#Resenha')
</script>

<!-- Resultado da busca: ocupa o lugar da lista de membros. Clicar leva até a mensagem. -->
<aside class="search" aria-label="Resultados da busca">
  <header>
    <span class="count">{hits.length === 1 ? '1 resultado' : `${hits.length} resultados`}</span>
    <IconButton icon="x" label="Fechar busca" size="sm" />
  </header>
  <div class="order">
    <Segmented
      size="sm"
      label="Ordem"
      bind:value={order}
      options={[
        { value: 'recent', label: 'Recentes' },
        { value: 'relevant', label: 'Relevantes' },
      ]}
    />
  </div>
  <div class="list">
    <div class="channel"><Icon name="hash" size={14} /> geral</div>
    {#each hits as hit (hit.id)}
      <button class="hit">
        <span class="hit-head">
          <Avatar id={hit.authorId} name={displayName(hit.authorId)} size={20} cutout="var(--bg-raised)" />
          <span class="hit-name" style:color={roleColor(hit.authorId)}>{displayName(hit.authorId)}</span>
          <span class="hit-time">{stamp(hit.createdAt)}</span>
        </span>
        <span class="hit-text">
          {#each parts(clean(hit.content)) as p, i (i)}{#if p.on}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}
        </span>
      </button>
    {/each}
  </div>
</aside>

<style>
  .search {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 8px 0 16px;
  }

  .count {
    font-weight: 600;
  }

  .order {
    padding: 0 12px 8px;
  }

  .list {
    flex: 1;
    min-height: 0;
    padding: 4px 8px 16px;
    overflow-y: auto;
  }

  .channel {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 8px 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .hit {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    margin-bottom: 6px;
    padding: 10px 12px;
    border-radius: var(--r-lg);
    background: var(--bg-raised);
    box-shadow: 0 0 0 1px var(--line);
    text-align: left;
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .hit:hover {
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .hit-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hit-name {
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .hit-time {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .hit-text {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--fg-2);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  mark {
    border-radius: 3px;
    background: rgb(251 191 36 / 0.22);
    color: #ffe3a3;
  }
</style>
