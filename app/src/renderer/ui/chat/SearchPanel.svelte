<script lang="ts">
  import type { Message } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import type { GuildState } from '../../lib/guild.svelte'
  import { formatStamp } from '../../lib/format'
  import { plainText } from '../../lib/markdown'
  import { Avatar, Button, EmptyState, Icon, IconButton, Spinner } from '../kit'

  let {
    guild,
    query,
    onjump,
    onclose,
  }: { guild: GuildState; query: string; onjump: (channelId: string, messageId: string) => void; onclose: () => void } = $props()

  let hits = $state<Message[]>([])
  let total = $state(0)
  let loading = $state(false)
  let failed = $state(false)

  // Busca de novo quando o texto muda (com uma pausinha pra não buscar a cada letra).
  $effect(() => {
    const q = query.trim()
    hits = []
    total = 0
    failed = false
    if (!q) return
    loading = true
    const timer = setTimeout(async () => {
      try {
        const result = await guild.search(q)
        if (query.trim() !== q) return
        hits = result.messages
        total = result.total
      } catch {
        failed = true
      } finally {
        loading = false
      }
    }, 250)
    return () => clearTimeout(timer)
  })

  async function more() {
    const last = hits.at(-1)
    if (!last || loading) return
    loading = true
    try {
      const result = await guild.search(query.trim(), { before: last.id })
      hits = [...hits, ...result.messages]
    } finally {
      loading = false
    }
  }

  const terms = $derived(
    query
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/\s+/)
      .filter(Boolean),
  )

  /** Marca em amarelo as palavras buscadas (sem ligar pra acento). */
  function parts(text: string) {
    const folded = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    // A versão sem acento tem o mesmo tamanho só se cada letra virou uma: senão, sem marcação.
    if (folded.length !== text.length || terms.length === 0) return [{ t: text, on: false }]
    const marks = new Array(text.length).fill(false)
    for (const term of terms) {
      for (let i = folded.indexOf(term); i >= 0; i = folded.indexOf(term, i + term.length)) marks.fill(true, i, i + term.length)
    }
    const out: { t: string; on: boolean }[] = []
    for (let i = 0; i < text.length; i++) {
      const last = out.at(-1)
      if (last && last.on === marks[i]) last.t += text[i]
      else out.push({ t: text[i], on: marks[i] })
    }
    return out
  }

  const clean = (content: string) =>
    plainText(content, {
      user: (id) => guild.displayName(id),
      role: (id) => guild.roles.find((r) => r.id === id)?.name ?? 'cargo',
      channel: (id) => guild.channel(id)?.name ?? 'canal',
    })

  const hex = (color: number | null) => (color === null ? null : `#${color.toString(16).padStart(6, '0')}`)
</script>

<!-- Resultado da busca: ocupa o lugar da lista de membros. Clicar leva até a mensagem. -->
<aside class="search" aria-label="Resultados da busca">
  <header>
    <span class="count">
      {#if loading && !hits.length}Buscando…{:else}{total >= 1000 ? 'Mais de 1000 resultados' : total === 1 ? '1 resultado' : `${total} resultados`}{/if}
    </span>
    <IconButton icon="x" label="Fechar busca" size="sm" onclick={onclose} />
  </header>
  <div class="list">
    {#if failed}
      <p class="note">Não deu pra buscar agora.</p>
    {:else if !loading && hits.length === 0}
      <EmptyState icon="search" title="Nada encontrado" description="Tente outras palavras." />
    {/if}
    {#each hits as hit, i (hit.id)}
      {#if i === 0 || hits[i - 1].channelId !== hit.channelId}
        <div class="channel"><Icon name="hash" size={14} /> {guild.channel(hit.channelId)?.name ?? 'canal'}</div>
      {/if}
      <button class="hit" onclick={() => onjump(hit.channelId, hit.id)}>
        <span class="hit-head">
          <Avatar id={hit.authorId} name={guild.displayName(hit.authorId)} size={20} src={client.avatarOf(hit.authorId, guild.id)} cutout="var(--bg-raised)" />
          <span class="hit-name" style:color={hex(guild.colorOf(hit.authorId))}>{guild.displayName(hit.authorId)}</span>
          <span class="hit-time">{formatStamp(hit.createdAt)}</span>
        </span>
        <span class="hit-text">
          {#each parts(clean(hit.content)) as p, j (j)}{#if p.on}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}
          {#if !hit.content && hit.attachments.length}<span class="file">📎 {hit.attachments[0].name}</span>{/if}
        </span>
      </button>
    {/each}
    {#if hits.length && hits.length < total}
      <div class="more">
        {#if loading}<Spinner size={16} />{:else}<Button size="sm" variant="ghost" onclick={more}>Ver mais</Button>{/if}
      </div>
    {/if}
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
    flex: none;
    height: 48px;
    padding: 0 8px 0 16px;
  }

  .count {
    font-weight: 600;
  }

  .list {
    flex: 1;
    min-height: 0;
    padding: 4px 8px 16px;
    overflow-y: auto;
  }

  .note {
    padding: 24px 8px;
    color: var(--fg-3);
    font-size: var(--text-sm);
    text-align: center;
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
    white-space: pre-wrap;
  }

  .file {
    color: var(--accent-fg);
  }

  mark {
    border-radius: 3px;
    background: rgb(251 191 36 / 0.22);
    color: #ffe3a3;
  }

  .more {
    display: grid;
    place-items: center;
    padding: 8px;
  }
</style>
