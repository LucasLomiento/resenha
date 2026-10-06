<script lang="ts">
  import type { Attachment, Message } from '../../../../shared/protocol'
  import { formatFull, formatSize, formatStamp, formatTime, parseMessage } from '../lib/format'
  import { store } from '../lib/store.svelte'
  import { confirmAction, ui } from '../lib/ui.svelte'
  import { Avatar, Icon, IconButton, Kbd, tooltip } from './kit'

  let { message, grouped }: { message: Message; grouped: boolean } = $props()

  const author = $derived(store.users[message.authorId])
  const mine = $derived(message.authorId === store.me?.id)
  const segments = $derived(parseMessage(message.content))

  let editing = $state(false)
  let draft = $state('')

  const IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/
  const VIDEO = /^video\/(mp4|webm|ogg)$/

  function startEdit() {
    draft = message.content
    editing = true
  }

  function saveEdit() {
    const content = draft.trim()
    if (content !== message.content) store.send({ t: 'chat.edit', id: message.id, content })
    editing = false
  }

  function editKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      saveEdit()
    } else if (event.key === 'Escape') {
      editing = false
    }
  }

  /** Shift + clique apaga direto, sem perguntar. */
  function remove(event: MouseEvent) {
    const run = () => store.send({ t: 'chat.delete', id: message.id })
    if (event.shiftKey) return run()
    confirmAction({ title: 'Apagar mensagem?', description: 'Não dá pra desfazer.', confirm: 'Apagar', onconfirm: run })
  }

  function open(a: Attachment) {
    ui.lightbox = { url: store.server + a.url, name: a.name }
  }

  function autofocus(node: HTMLTextAreaElement) {
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }
</script>

<article class:grouped class:editing>
  <div class="gutter">
    {#if grouped}
      <time class="time-hover tabular" use:tooltip={formatFull(message.createdAt)}>{formatTime(message.createdAt)}</time>
    {:else}
      <Avatar id={message.authorId} name={author?.name ?? '?'} size={36} />
    {/if}
  </div>

  <div class="body">
    {#if !grouped}
      <div class="head">
        <span class="author">{author?.name ?? 'Alguém'}</span>
        <time class="stamp" use:tooltip={formatFull(message.createdAt)}>{formatStamp(message.createdAt)}</time>
      </div>
    {/if}

    {#if editing}
      <textarea class="edit" bind:value={draft} onkeydown={editKey} use:autofocus rows="2" aria-label="Editar mensagem" data-own-escape></textarea>
      <div class="edit-hint">
        <span><Kbd keys="Enter" /> salva</span>
        <span><Kbd keys="Esc" /> cancela</span>
      </div>
    {:else if message.content}
      <div class="content selectable">
        {#each segments as seg, i (i)}
          {#if seg.kind === 'link'}<a href={seg.text} target="_blank" rel="noreferrer">{seg.text}</a>
          {:else if seg.kind === 'code'}<code>{seg.text}</code>
          {:else if seg.kind === 'block'}<pre>{seg.text}</pre>
          {:else}{seg.text}{/if}
        {/each}
        {#if message.editedAt}<span class="edited" use:tooltip={formatFull(message.editedAt)}>editada</span>{/if}
      </div>
    {/if}

    {#each message.attachments as a (a.id)}
      {#if IMAGE.test(a.type)}
        <button class="image" aria-label="Abrir {a.name}" onclick={() => open(a)}>
          <img src={store.server + a.url} alt={a.name} loading="lazy" draggable="false" />
        </button>
      {:else if VIDEO.test(a.type)}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="video" src={store.server + a.url} controls preload="metadata"></video>
      {:else}
        <div class="file">
          <span class="file-icon"><Icon name="file" size={20} /></span>
          <div class="file-info">
            <span class="file-name" title={a.name}>{a.name}</span>
            <span class="file-size">{formatSize(a.size)}</span>
          </div>
          <IconButton icon="download" label="Baixar" onclick={() => window.resenha.download(store.server + a.url)} />
        </div>
      {/if}
    {/each}
  </div>

  {#if !editing && (mine || store.me?.admin)}
    <div class="actions">
      {#if mine && message.content}
        <IconButton icon="pencil" label="Editar" size="sm" onclick={startEdit} />
      {/if}
      <IconButton icon="trash" label="Apagar" size="sm" tone="danger" onclick={remove} />
    </div>
  {/if}
</article>

<style>
  article {
    position: relative;
    display: flex;
    gap: 14px;
    margin-top: 14px;
    padding: 3px 20px;
    transition: background-color var(--t-fast) var(--ease);
  }

  article.grouped {
    margin-top: 0;
    padding-top: 1px;
    padding-bottom: 1px;
  }

  article:hover,
  article.editing {
    background: rgb(255 255 255 / 0.022);
  }

  .gutter {
    display: flex;
    justify-content: center;
    flex: none;
    width: 36px;
    padding-top: 2px;
  }

  .time-hover {
    visibility: hidden;
    color: var(--fg-3);
    font-size: 10.5px;
    line-height: 22px;
  }

  article:hover .time-hover {
    visibility: visible;
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 1px;
  }

  .author {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }

  .stamp {
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .content {
    color: #dedee6;
    font-size: var(--text-lg);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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
  }

  .edited {
    margin-left: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .edit {
    width: 100%;
    margin-top: 2px;
    padding: 10px 12px;
    border: 0;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--accent-line);
    color: var(--fg);
    font-size: var(--text-lg);
    line-height: 1.5;
    resize: none;
    outline: none;
    user-select: text;
  }

  .edit-hint {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .edit-hint span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .image {
    display: block;
    margin-top: 6px;
    max-width: min(420px, 100%);
    border-radius: var(--r-lg);
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--line);
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .image:hover {
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .image img {
    display: block;
    max-width: 100%;
    max-height: 320px;
    object-fit: contain;
    background: var(--bg-input);
  }

  .video {
    display: block;
    margin-top: 6px;
    max-width: min(480px, 100%);
    max-height: 320px;
    border-radius: var(--r-lg);
    background: #000;
  }

  .file {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 400px;
    margin-top: 6px;
    padding: 10px 8px 10px 10px;
    border-radius: var(--r-lg);
    background: var(--bg-raised);
    box-shadow: 0 0 0 1px var(--line);
  }

  .file-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: var(--r-lg);
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  .file-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
    font-weight: 500;
  }

  .file-size {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .actions {
    position: absolute;
    top: -14px;
    right: 16px;
    z-index: 2;
    display: none;
    gap: 2px;
    padding: 2px;
    border-radius: var(--r-lg);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-md);
  }

  article:hover .actions,
  .actions:focus-within {
    display: flex;
  }
</style>
