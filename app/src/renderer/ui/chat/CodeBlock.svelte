<script lang="ts" module>
  import type { CodeNode } from '../../lib/highlight'

  // O highlight.js chega quando aparece o primeiro bloco com linguagem (fica fora do
  // pacote principal). Até lá, ou se não carregar, o bloco aparece sem cor.
  let highlighter = $state.raw<typeof import('../../lib/highlight') | null>(null)
  let loading = false

  function load() {
    if (loading) return
    loading = true
    import('../../lib/highlight')
      .then((mod) => (highlighter = mod))
      .catch((err) => {
        // Não carregou (pacote pela metade): o próximo bloco tenta de novo.
        loading = false
        console.error('cores do código não carregaram', err)
      })
  }
</script>

<script lang="ts">
  import { m } from '../../lib/i18n.svelte'
  import { IconButton } from '../kit'

  let { lang, text }: { lang: string; text: string } = $props()

  // Árvore de dados (texto + classes do highlight.js): o texto entra como texto, nunca como HTML.
  const tree = $derived(lang && highlighter ? highlighter.highlight(lang, text) : null)

  $effect(() => {
    if (lang) load()
  })

  let copied = $state(false)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    copied = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied = false), 1600)
  }

  $effect(() => () => clearTimeout(copiedTimer))
</script>

{#snippet nodes(list: CodeNode[])}{#each list as node, i (i)}{#if typeof node === 'string'}{node}{:else}<span class={node.cls}
        >{@render nodes(node.children)}</span
      >{/if}{/each}{/snippet}

<div class="code-block" class:copied>
  <pre class="selectable" data-lang={lang || null}><code>{#if tree}{@render nodes(tree)}{:else}{text}{/if}</code></pre>
  <span class="copy">
    <IconButton
      icon={copied ? 'check' : 'copy'}
      label={copied ? m.common.copied : m.common.copy}
      size="sm"
      variant="subtle"
      tone={copied ? 'success' : 'neutral'}
      active={copied}
      onclick={copy}
    />
  </span>
</div>

<style>
  .code-block {
    position: relative;
    margin: 6px 0;
    /* O texto da mensagem guarda os espaços (pre-wrap); aqui dentro só o <pre> guarda. */
    white-space: normal;
  }

  pre {
    margin: 0;
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

  code {
    font: inherit;
  }

  /* Copiar: aparece com o mouse em cima do bloco (ou com o foco do teclado nele). */
  .copy {
    position: absolute;
    top: 6px;
    right: 6px;
    border-radius: var(--r-full);
    background: var(--bg-input);
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  .code-block:hover .copy,
  .code-block.copied .copy,
  .copy:focus-within {
    opacity: 1;
  }

  /* Sem mouse (celular): o botão fica sempre lá, mais apagado. */
  @media (hover: none) {
    .copy {
      opacity: 0.7;
    }
  }

  /* Cores do highlight.js (tokens --code-* do app.css). O que não está aqui fica na cor do texto. */
  .hljs-keyword,
  .hljs-selector-tag,
  .hljs-name,
  .hljs-section,
  .hljs-doctag {
    color: var(--code-keyword);
  }

  .hljs-string,
  .hljs-regexp,
  .hljs-char,
  .hljs-selector-attr,
  .hljs-code {
    color: var(--code-string);
  }

  .hljs-number,
  .hljs-literal,
  .hljs-symbol,
  .hljs-bullet,
  .hljs-selector-pseudo {
    color: var(--code-number);
  }

  .hljs-title,
  .hljs-attr,
  .hljs-attribute,
  .hljs-property,
  .hljs-selector-id,
  .hljs-selector-class,
  .hljs-link {
    color: var(--code-title);
  }

  .hljs-type,
  .hljs-built_in,
  .hljs-title.class_ {
    color: var(--code-type);
  }

  .hljs-comment,
  .hljs-quote {
    color: var(--code-comment);
    font-style: italic;
  }

  .hljs-meta,
  .hljs-tag,
  .hljs-punctuation {
    color: var(--fg-2);
  }

  /* Código dentro de string (`${x}` no JS, "$(cmd)" no bash) volta pra cor do texto. */
  .hljs-subst {
    color: var(--fg);
  }

  .hljs-addition {
    background: var(--green-soft);
    color: var(--code-string);
  }

  .hljs-deletion {
    background: var(--red-soft);
    color: var(--red);
  }

  .hljs-strong {
    font-weight: 650;
  }

  .hljs-emphasis {
    font-style: italic;
  }
</style>
