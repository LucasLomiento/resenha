<script lang="ts">
  import type { Attachment, Message } from '../../../../shared/protocol'
  import { formatSize, formatStamp, formatTime, parseMessage, userColor } from '../lib/format'
  import { store } from '../lib/store.svelte'
  import { ui } from '../lib/ui.svelte'
  import Avatar from './Avatar.svelte'
  import Icon from './Icon.svelte'

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

  function remove() {
    store.send({ t: 'chat.delete', id: message.id })
  }

  function open(a: Attachment) {
    ui.lightbox = { url: store.server + a.url, name: a.name }
  }

  function autofocus(node: HTMLTextAreaElement) {
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }
</script>

<article class:grouped>
  <div class="gutter">
    {#if grouped}
      <span class="time-hover">{formatTime(message.createdAt)}</span>
    {:else}
      <Avatar id={message.authorId} name={author?.name ?? '?'} size={38} />
    {/if}
  </div>

  <div class="body">
    {#if !grouped}
      <div class="head">
        <span class="author" style:color={userColor(message.authorId)}>{author?.name ?? 'Alguém'}</span>
        <span class="stamp">{formatStamp(message.createdAt)}</span>
      </div>
    {/if}

    {#if editing}
      <textarea class="field edit" bind:value={draft} onkeydown={editKey} use:autofocus rows="2"></textarea>
      <div class="edit-hint">Enter salva · Esc cancela</div>
    {:else if message.content}
      <div class="content selectable">
        {#each segments as seg, i (i)}
          {#if seg.kind === 'link'}<a href={seg.text} target="_blank" rel="noreferrer">{seg.text}</a>
          {:else if seg.kind === 'code'}<code>{seg.text}</code>
          {:else if seg.kind === 'block'}<pre>{seg.text}</pre>
          {:else}{seg.text}{/if}
        {/each}
        {#if message.editedAt}<span class="edited">(editada)</span>{/if}
      </div>
    {/if}

    {#each message.attachments as a (a.id)}
      {#if IMAGE.test(a.type)}
        <button class="image" onclick={() => open(a)}>
          <img src={store.server + a.url} alt={a.name} loading="lazy" />
        </button>
      {:else if VIDEO.test(a.type)}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="video" src={store.server + a.url} controls preload="metadata"></video>
      {:else}
        <div class="file">
          <Icon name="file" size={28} stroke={1.5} />
          <div class="file-info">
            <span class="file-name">{a.name}</span>
            <span class="file-size">{formatSize(a.size)}</span>
          </div>
          <button class="icon-btn" title="Baixar" onclick={() => window.resenha.download(store.server + a.url)}>
            <Icon name="download" />
          </button>
        </div>
      {/if}
    {/each}
  </div>

  {#if !editing && (mine || store.me?.admin)}
    <div class="actions">
      {#if mine && message.content}
        <button class="icon-btn" title="Editar" onclick={startEdit}><Icon name="pencil" size={16} /></button>
      {/if}
      <button class="icon-btn" title="Apagar" onclick={remove}><Icon name="trash" size={16} /></button>
    </div>
  {/if}
</article>

<style>
  article {
    position: relative;
    display: flex;
    gap: 14px;
    padding: 6px 18px 2px;
    margin-top: 10px;
  }

  article.grouped {
    margin-top: 0;
    padding-top: 1px;
  }

  article:hover {
    background: rgb(255 255 255 / 0.025);
  }

  .gutter {
    width: 38px;
    flex: none;
    display: flex;
    justify-content: center;
  }

  .time-hover {
    visibility: hidden;
    font-size: 10px;
    color: var(--text-faint);
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
  }

  .author {
    font-weight: 700;
  }

  .stamp {
    font-size: 11px;
    color: var(--text-faint);
  }

  .content {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: #dcdde3;
  }

  code {
    font-family: var(--mono);
    font-size: 12.5px;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--bg-deep);
  }

  pre {
    margin: 4px 0;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--bg-deep);
    border: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 12.5px;
    white-space: pre-wrap;
  }

  .edited {
    margin-left: 4px;
    font-size: 11px;
    color: var(--text-faint);
  }

  .edit {
    margin-top: 2px;
    resize: none;
  }

  .edit-hint {
    font-size: 11px;
    color: var(--text-faint);
  }

  .image {
    display: block;
    margin-top: 6px;
    border-radius: 8px;
    overflow: hidden;
    max-width: min(420px, 100%);
  }

  .image img {
    display: block;
    max-width: 100%;
    max-height: 320px;
    object-fit: contain;
    background: var(--bg-deep);
  }

  .video {
    display: block;
    margin-top: 6px;
    max-width: min(480px, 100%);
    max-height: 320px;
    border-radius: 8px;
    background: black;
  }

  .file {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
    padding: 10px 10px 10px 12px;
    max-width: 420px;
    border-radius: 8px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    color: var(--text-dim);
  }

  .file-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .file-name {
    color: var(--accent);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-size {
    font-size: 12px;
    color: var(--text-faint);
  }

  .actions {
    position: absolute;
    top: -12px;
    right: 18px;
    display: none;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.3);
  }

  article:hover .actions {
    display: flex;
  }
</style>
