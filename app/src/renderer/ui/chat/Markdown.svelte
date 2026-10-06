<script lang="ts" module>
  /** Como mostrar menções: quem resolve os nomes é quem usa (servidor ou conversa). */
  export interface MentionNames {
    user(id: string): string
    role(id: string): { name: string; color: number | null } | null
    channel(id: string): { name: string; kind: 'text' | 'voice' | 'category' } | null
    /** Clique numa menção de pessoa (abre o perfil). */
    openUser?(id: string, anchor: HTMLElement): void
    /** Clique numa menção de canal. */
    openChannel?(id: string): void
  }
</script>

<script lang="ts">
  import { isJumbo, parseMarkdown, type Block, type Inline } from '../../lib/markdown'
  import { Icon } from '../kit'
  import Spoiler from './Spoiler.svelte'

  let { content, names }: { content: string; names: MentionNames } = $props()

  const blocks = $derived(parseMarkdown(content))
  const jumbo = $derived(isJumbo(content))

  const hex = (color: number | null) => (color === null ? null : `#${color.toString(16).padStart(6, '0')}`)

  /** Link só abre se for http(s); o resto vira texto. */
  function safeHref(url: string): string | null {
    return /^https?:\/\//i.test(url) ? url : null
  }
</script>

{#snippet inline(nodes: Inline[])}
  {#each nodes as node, i (i)}
    {#if node.t === 'text'}{node.text}{:else if node.t === 'br'}<br />{:else if node.t === 'code'}<code>{node.text}</code
      >{:else if node.t === 'bold'}<strong>{@render inline(node.children)}</strong>{:else if node.t === 'italic'}<em
        >{@render inline(node.children)}</em
      >{:else if node.t === 'underline'}<u>{@render inline(node.children)}</u>{:else if node.t === 'strike'}<s
        >{@render inline(node.children)}</s
      >{:else if node.t === 'spoiler'}<Spoiler>{@render inline(node.children)}</Spoiler>{:else if node.t === 'link'}{@const href = safeHref(node.url)}{#if href}<a {href} target="_blank" rel="noreferrer noopener"
          >{node.url}</a
        >{:else}{node.url}{/if}{:else if node.t === 'user'}<button
        class="mention"
        onclick={(e) => names.openUser?.(node.id, e.currentTarget)}>@{names.user(node.id)}</button
      >{:else if node.t === 'role'}{@const role = names.role(node.id)}<span
        class="mention"
        style:color={hex(role?.color ?? null)}
        style:background={role?.color != null ? `${hex(role.color)}26` : null}>@{role?.name ?? 'cargo excluído'}</span
      >{:else if node.t === 'channel'}{@const channel = names.channel(node.id)}<button
        class="mention"
        disabled={!channel}
        onclick={() => names.openChannel?.(node.id)}
        ><Icon name={channel?.kind === 'voice' ? 'volume' : 'hash'} size={13} />{channel?.name ?? 'canal desconhecido'}</button
      >{:else if node.t === 'everyone'}<span class="mention">{node.text}</span>{/if}
  {/each}
{/snippet}

{#snippet block(node: Block)}
  {#if node.t === 'paragraph'}
    <p>{@render inline(node.children)}</p>
  {:else if node.t === 'code'}
    <pre class="selectable" data-lang={node.lang || null}><code>{node.text}</code></pre>
  {:else if node.t === 'quote'}
    <blockquote>
      {#each node.children as child, i (i)}{@render block(child)}{/each}
    </blockquote>
  {:else if node.t === 'heading'}
    <svelte:element this={`h${node.level}`} class="heading">{@render inline(node.children)}</svelte:element>
  {:else if node.t === 'list'}
    <svelte:element this={node.ordered ? 'ol' : 'ul'} start={node.ordered ? node.start : undefined}>
      {#each node.items as item, i (i)}<li>{@render inline(item)}</li>{/each}
    </svelte:element>
  {/if}
{/snippet}

<div class="md selectable" class:jumbo>
  {#each blocks as node, i (i)}{@render block(node)}{/each}
</div>

<style>
  .md {
    color: #dedee6;
    font-size: var(--text-lg);
    line-height: 1.5;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .md.jumbo {
    font-size: 44px;
    line-height: 1.15;
  }

  p {
    margin: 0;
  }

  strong {
    color: var(--fg);
    font-weight: 650;
  }

  a {
    color: var(--accent-fg);
  }

  a:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  code {
    padding: 1px 5px;
    border-radius: var(--r-xs);
    background: rgb(255 255 255 / 0.07);
    font-family: var(--mono);
    font-size: 0.86em;
  }

  pre {
    margin: 6px 0;
    padding: 12px 14px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-x: auto;
  }

  pre code {
    padding: 0;
    background: none;
    font-size: inherit;
  }

  blockquote {
    margin: 2px 0;
    padding-left: 12px;
    border-left: 3px solid var(--line-strong);
    color: var(--fg-2);
  }

  .heading {
    margin: 6px 0 2px;
    color: var(--fg);
    font-weight: 650;
    line-height: 1.3;
  }

  h1.heading {
    font-size: 22px;
  }

  h2.heading {
    font-size: 19px;
  }

  h3.heading {
    font-size: 16.5px;
  }

  ul,
  ol {
    margin: 2px 0;
    padding-left: 22px;
    white-space: normal;
  }

  .mention {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    border-radius: var(--r-xs);
    background: rgb(122 108 255 / 0.18);
    color: #c9c2ff;
    font: inherit;
    font-weight: 550;
    vertical-align: baseline;
    transition: background-color var(--t-fast) var(--ease);
  }

  button.mention:hover:not(:disabled) {
    background: rgb(122 108 255 / 0.32);
  }

  .mention :global(svg) {
    align-self: center;
  }

</style>
