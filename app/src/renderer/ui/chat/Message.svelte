<script lang="ts">
  import type { Attachment, Embed, Message } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { formatFull, formatSize, formatStamp, formatTime } from '../../lib/format'
  import { plainText } from '../../lib/markdown'
  import { badgeOf, nameStyle } from '../../lib/profile'
  import { confirmAction, openProfile, ui } from '../../lib/ui.svelte'
  import { memberMenu } from '../guild/memberMenu'
  import { Avatar, UserBadge, Icon, IconButton, Kbd, Menu, tooltip, type MenuItem } from '../kit'
  import EmojiPicker from './EmojiPicker.svelte'
  import Markdown from './Markdown.svelte'
  import VoicePlayer from './VoicePlayer.svelte'
  import { toEditable, toRaw } from './mentions'
  import type { ChatTarget } from './target.svelte'

  let {
    message,
    target,
    grouped,
    highlighted = false,
    onreply,
    onjump,
  }: {
    message: Message
    target: ChatTarget
    grouped: boolean
    /** Acabou de pular pra ela (busca, fixadas, resposta). */
    highlighted?: boolean
    onreply: (message: Message) => void
    onjump: (messageId: string) => void
  } = $props()

  const meId = $derived(client.me?.id ?? '')
  const mine = $derived(message.authorId === meId)
  const name = $derived(target.displayName(message.authorId))
  const color = $derived(target.color(message.authorId))
  const author = $derived(target.profile(message.authorId))
  const authorName = $derived(nameStyle(author))
  /** Mouse em cima: a foto animada e a moldura se mexem (paradas no resto do tempo). */
  let hovered = $state(false)
  const mentioned = $derived(!mine && target.mentionsMe(message))
  const canDelete = $derived(mine || target.canManage)

  const IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/
  const VIDEO = /^video\/(mp4|webm|ogg)$/
  const AUDIO = /^audio\//

  /** Imagens que não abriram (arquivo estragado, link vencido): viram cartão de arquivo, ou somem na prévia de link. */
  let broken = $state<Record<string, boolean>>({})

  // ---------- Editar ----------

  let editing = $state(false)
  let draft = $state('')
  let draftTokens = new Map<string, string>()

  export function startEdit() {
    const editable = toEditable(message.content, target.names)
    draft = editable.text
    draftTokens = editable.tokens
    editing = true
  }

  function saveEdit() {
    const content = toRaw(draft.trim(), draftTokens)
    if (content !== message.content && (content || message.attachments.length)) target.edit(message.id, content)
    editing = false
  }

  function editKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      saveEdit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      editing = false
    }
  }

  function autofocus(node: HTMLTextAreaElement) {
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
    node.style.height = `${Math.min(node.scrollHeight, 320)}px`
  }

  // ---------- Ações ----------

  /** Shift + clique apaga direto, sem perguntar. */
  function remove(event?: MouseEvent) {
    const run = () => target.remove(message.id)
    if (event?.shiftKey) return run()
    confirmAction({ title: 'Apagar mensagem?', description: 'Não dá pra desfazer.', confirm: 'Apagar', onconfirm: run })
  }

  function toggleReaction(emoji: string) {
    const on = !message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(meId)
    target.react(message.id, emoji, on)
  }

  let pickerAnchor = $state<HTMLElement | { x: number; y: number } | null>(null)
  let menu = $state<{ items: MenuItem[]; anchor: HTMLElement | { x: number; y: number } } | null>(null)

  function moreItems(): MenuItem[] {
    const items: MenuItem[] = []
    if (target.canReact) items.push({ label: 'Reagir', icon: 'emoji-plus', onselect: () => (pickerAnchor = menu?.anchor ?? null) })
    if (target.canSend) items.push({ label: 'Responder', icon: 'reply', onselect: () => onreply(message) })
    if (mine && message.content) items.push({ label: 'Editar', icon: 'pencil', onselect: startEdit })
    if (target.canPin) {
      items.push({ label: message.pinned ? 'Desafixar' : 'Fixar', icon: message.pinned ? 'pin-off' : 'pin', onselect: () => target.pin(message.id, !message.pinned) })
    }
    if (message.content) {
      items.push({
        label: 'Copiar texto',
        icon: 'copy',
        onselect: () => navigator.clipboard.writeText(plainText(message.content, { user: target.names.user, role: (id) => target.names.role(id)?.name ?? 'cargo', channel: (id) => target.names.channel(id)?.name ?? 'canal' })),
      })
    }
    if (canDelete) {
      items.push({ kind: 'separator' })
      items.push({ label: 'Apagar mensagem', icon: 'trash', danger: true, onselect: () => remove() })
    }
    return items
  }

  function openAuthor(anchor: HTMLElement) {
    openProfile(message.authorId, target.guild?.id ?? null, anchor)
  }

  function authorMenu(event: MouseEvent) {
    if (!target.guild) return
    event.preventDefault()
    menu = { items: memberMenu(target.guild, message.authorId, { x: event.clientX, y: event.clientY }), anchor: { x: event.clientX, y: event.clientY } }
  }

  function messageMenu(event: MouseEvent) {
    // Texto selecionado ou link: deixa o menu do sistema (copiar, abrir).
    if (window.getSelection()?.toString() || (event.target as HTMLElement).closest('a, textarea')) return
    event.preventDefault()
    const anchor = { x: event.clientX, y: event.clientY }
    menu = { items: moreItems(), anchor }
  }

  const url = (path: string) => client.api?.url(path) ?? path

  /** Com o tamanho conhecido, o espaço fica reservado antes de a imagem chegar. */
  function ratio(a: Attachment): string | null {
    return a.width && a.height ? `${a.width} / ${a.height}` : null
  }

  function fitWidth(a: Attachment, maxWidth: number, maxHeight: number): string | null {
    if (!a.width || !a.height) return null
    const scale = Math.min(1, maxWidth / a.width, maxHeight / a.height)
    return `${Math.max(1, Math.round(a.width * scale))}px`
  }

  function openImage(a: Attachment) {
    ui.lightbox = { url: url(a.url), name: a.name }
  }

  function embedImage(embed: Embed): string | null {
    return embed.image ? url(embed.image) : null
  }

  /** Nome de quem escreveu a mensagem respondida (ou "alguém" se ela foi apagada). */
  const replyName = $derived(message.replyTo?.authorId ? target.displayName(message.replyTo.authorId) : null)
</script>

<article
  class:grouped
  class:editing
  class:mentioned
  class:highlighted
  class:has-reply={!!message.replyTo}
  data-message-id={message.id}
  oncontextmenu={messageMenu}
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
>
  {#if message.replyTo}
    {@const ref = message.replyTo}
    <button class="reply" onclick={() => ref.authorId && onjump(ref.id)} disabled={!ref.authorId}>
      <span class="spine" aria-hidden="true"></span>
      {#if ref.authorId}
        <Avatar id={ref.authorId} name={replyName ?? '?'} size={16} src={target.avatar(ref.authorId)} />
        <span class="reply-name" style:color={target.color(ref.authorId)}>{replyName}</span>
        <span class="reply-text">
          {ref.content ? plainText(ref.content, { user: target.names.user, role: (id) => target.names.role(id)?.name ?? 'cargo', channel: (id) => target.names.channel(id)?.name ?? 'canal' }) : 'Clique pra ver o anexo'}
        </span>
      {:else}
        <span class="reply-text gone">A mensagem original foi apagada</span>
      {/if}
    </button>
  {/if}

  <div class="line">
    <div class="gutter">
      {#if grouped}
        <time class="time-hover tabular" use:tooltip={formatFull(message.createdAt)}>{formatTime(message.createdAt)}</time>
      {:else}
        <button class="avatar-button" aria-label="Perfil de {name}" onclick={(e) => openAuthor(e.currentTarget)} oncontextmenu={authorMenu}>
          <Avatar
            id={message.authorId}
            {name}
            size={36}
            src={target.avatar(message.authorId)}
            animated={target.animatedAvatar(message.authorId)}
            decoration={author?.deleted ? null : author?.style?.decoration}
            play={hovered}
            cutout="var(--bg-panel)"
          />
        </button>
      {/if}
    </div>

    <div class="body">
      {#if !grouped}
        <div class="head">
          <button class="author" style:color onclick={(e) => openAuthor(e.currentTarget)} oncontextmenu={authorMenu}
            ><span class={authorName.class} style={authorName.style}>{name}</span></button
          >
          <UserBadge badge={badgeOf(author)} size={15} />
          <time class="stamp" use:tooltip={formatFull(message.createdAt)}>{formatStamp(message.createdAt)}</time>
          {#if message.pinned}<span class="pin" use:tooltip={'Fixada'}><Icon name="pin" size={12} /></span>{/if}
        </div>
      {/if}

      {#if editing}
        <textarea class="edit" bind:value={draft} onkeydown={editKey} use:autofocus rows="1" aria-label="Editar mensagem" data-own-escape
          oninput={(e) => {
            e.currentTarget.style.height = 'auto'
            e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 320)}px`
          }}
        ></textarea>
        <div class="edit-hint">
          <span><Kbd keys="Enter" /> salva</span>
          <span><Kbd keys="Esc" /> cancela</span>
        </div>
      {:else if message.content}
        <div class="content">
          <Markdown content={message.content} names={{ ...target.names, openUser: (id, anchor) => openProfile(id, target.guild?.id ?? null, anchor) }} />
          {#if message.editedAt}<span class="edited" use:tooltip={formatFull(message.editedAt)}>editada</span>{/if}
          {#if grouped && message.pinned}<span class="pin inline" use:tooltip={'Fixada'}><Icon name="pin" size={12} /></span>{/if}
        </div>
      {/if}

      {#each message.attachments as a (a.id)}
        {#if IMAGE.test(a.type) && !broken[a.id]}
          <button class="image" aria-label="Abrir {a.name}" onclick={() => openImage(a)} style:aspect-ratio={ratio(a)} style:width={fitWidth(a, 420, 320)}>
            <img src={url(a.url)} alt={a.name} loading="lazy" draggable="false" onerror={() => (broken[a.id] = true)} />
          </button>
        {:else if AUDIO.test(a.type)}
          <VoicePlayer id={a.id} name={a.name} size={a.size} src={url(a.url)} />
        {:else if VIDEO.test(a.type)}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video class="video" src={url(a.url)} controls preload="metadata" style:aspect-ratio={ratio(a)} style:width={fitWidth(a, 480, 320)}></video>
        {:else}
          <div class="file">
            <span class="file-icon"><Icon name="file" size={20} /></span>
            <div class="file-info">
              <span class="file-name" title={a.name}>{a.name}</span>
              <span class="file-size">{formatSize(a.size)}</span>
            </div>
            <IconButton icon="download" label="Baixar" onclick={() => window.resenha.download(url(a.url))} />
          </div>
        {/if}
      {/each}

      {#each message.embeds as embed (embed.url)}
        {@const image = broken[embed.url] ? null : embedImage(embed)}
        {#if image || embed.title || embed.description}
          <div class="embed" class:only-image={!embed.title && !embed.description}>
            {#if embed.title || embed.description}
              <span class="site">{embed.siteName}</span>
              {#if embed.title}<a class="embed-title" href={embed.url} target="_blank" rel="noreferrer noopener">{embed.title}</a>{/if}
              {#if embed.description}<p>{embed.description}</p>{/if}
            {/if}
            {#if image}
              <a class="embed-image" href={embed.url} target="_blank" rel="noreferrer noopener" aria-label={embed.title || embed.siteName}>
                <img src={image} alt="" loading="lazy" draggable="false" onerror={() => (broken[embed.url] = true)} />
              </a>
            {/if}
          </div>
        {/if}
      {/each}

      {#if message.reactions.length}
        <div class="reactions">
          {#each message.reactions as reaction (reaction.emoji)}
            {@const me = reaction.userIds.includes(meId)}
            <button
              class="reaction"
              class:me
              aria-pressed={me}
              aria-label="{reaction.emoji} {reaction.userIds.length}"
              use:tooltip={reaction.userIds.slice(0, 8).map((id) => target.displayName(id)).join(', ') + (reaction.userIds.length > 8 ? ` e mais ${reaction.userIds.length - 8}` : '')}
              disabled={!me && !target.canReact && !target.canSend}
              onclick={() => toggleReaction(reaction.emoji)}
            >
              <span class="emoji">{reaction.emoji}</span>
              <span class="count">{reaction.userIds.length}</span>
            </button>
          {/each}
          {#if target.canReact}
            <button class="reaction add" aria-label="Reagir" onclick={(e) => (pickerAnchor = e.currentTarget)}><Icon name="emoji-plus" size={16} /></button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  {#if !editing}
    <div class="actions" class:open={!!pickerAnchor || !!menu}>
      {#if target.canReact}
        <IconButton icon="emoji-plus" label="Reagir" size="sm" onclick={(e) => (pickerAnchor = e.currentTarget)} />
      {/if}
      {#if target.canSend}
        <IconButton icon="reply" label="Responder" size="sm" onclick={() => onreply(message)} />
      {/if}
      {#if mine && message.content}
        <IconButton icon="pencil" label="Editar" size="sm" onclick={startEdit} />
      {:else if target.canPin}
        <IconButton icon={message.pinned ? 'pin-off' : 'pin'} label={message.pinned ? 'Desafixar' : 'Fixar'} size="sm" onclick={() => target.pin(message.id, !message.pinned)} />
      {/if}
      <IconButton icon="ellipsis" label="Mais" size="sm" onclick={(e) => (menu = { items: moreItems(), anchor: e.currentTarget })} />
    </div>
  {/if}
</article>

{#if pickerAnchor}
  <EmojiPicker
    anchor={pickerAnchor}
    placement="left-start"
    onpick={(emoji) => {
      pickerAnchor = null
      if (!message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(meId)) target.react(message.id, emoji, true)
    }}
    onclose={() => (pickerAnchor = null)}
  />
{/if}

{#if menu}
  <Menu items={menu.items} anchor={menu.anchor} placement="bottom-end" width={220} onclose={() => (menu = null)} />
{/if}

<style>
  article {
    position: relative;
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

  /* Me mencionaram: a linha ganha a cor do acento e uma barra na borda. */
  article.mentioned {
    background: rgb(122 108 255 / 0.075);
    box-shadow: inset 2px 0 0 var(--accent-fg);
  }

  article.mentioned:hover {
    background: rgb(122 108 255 / 0.1);
  }

  /* Pulou pra ela: pisca o fundo uma vez. */
  article.highlighted {
    animation: flash 1.6s var(--ease);
  }

  @keyframes flash {
    0%,
    40% {
      background: rgb(251 191 36 / 0.14);
    }
    100% {
      background: transparent;
    }
  }

  .reply {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    max-width: calc(100% - 50px);
    margin: 0 0 2px 50px;
    color: var(--fg-3);
    font-size: var(--text-sm);
    text-align: left;
  }

  .reply:not(:disabled):hover .reply-text {
    color: var(--fg-2);
  }

  .spine {
    position: absolute;
    left: -32px;
    top: 9px;
    width: 26px;
    height: 12px;
    border-top: 2px solid var(--line-strong);
    border-left: 2px solid var(--line-strong);
    border-top-left-radius: 8px;
  }

  .reply-name {
    color: var(--fg-2);
    font-weight: 600;
    white-space: nowrap;
  }

  .reply-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color var(--t-fast) var(--ease);
  }

  .reply-text.gone {
    font-style: italic;
  }

  .line {
    display: flex;
    gap: 14px;
  }

  .gutter {
    display: flex;
    justify-content: center;
    flex: none;
    width: 36px;
    padding-top: 2px;
  }

  .avatar-button {
    display: flex;
    height: fit-content;
    border-radius: 50%;
  }

  .avatar-button:active {
    transform: translateY(1px);
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

  .author:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .stamp {
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .pin {
    display: inline-flex;
    align-self: center;
    color: var(--fg-3);
  }

  .pin.inline {
    margin-left: 6px;
    vertical-align: middle;
  }

  .content {
    position: relative;
  }

  .content :global(.md) {
    display: inline;
  }

  .content :global(.md > p:last-child) {
    display: inline;
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
    width: 100%;
    height: 100%;
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

  .embed {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 432px;
    margin-top: 8px;
    padding: 12px 14px 14px;
    border-radius: var(--r-lg);
    background: var(--bg-raised);
    box-shadow:
      inset 3px 0 0 var(--line-strong),
      0 0 0 1px var(--line);
  }

  .embed.only-image {
    padding: 0;
    background: none;
    box-shadow: none;
  }

  .site {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .embed-title {
    color: var(--accent-fg);
    font-weight: 600;
  }

  .embed-title:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .embed p {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .embed-image {
    display: block;
    margin-top: 8px;
    border-radius: var(--r-md);
    overflow: hidden;
  }

  .embed.only-image .embed-image {
    margin-top: 0;
    border-radius: var(--r-lg);
    box-shadow: 0 0 0 1px var(--line);
  }

  .embed-image img {
    display: block;
    width: 100%;
    max-height: 280px;
    object-fit: cover;
    background: var(--bg-input);
  }

  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .reaction {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
    border-radius: var(--r-md);
    background: rgb(255 255 255 / 0.05);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 600;
    transition: background-color var(--t-fast) var(--ease);
  }

  .reaction:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.09);
  }

  .reaction.me {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent-line);
    color: var(--accent-fg);
  }

  .emoji {
    font-size: 15px;
    line-height: 1;
  }

  .count {
    font-variant-numeric: tabular-nums;
  }

  .reaction.add {
    padding: 0 6px;
    color: var(--fg-3);
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  article:hover .reaction.add,
  .reaction.add:focus-visible {
    opacity: 1;
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
  .actions:focus-within,
  .actions.open {
    display: flex;
  }
</style>
