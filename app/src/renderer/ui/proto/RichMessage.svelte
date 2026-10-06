<script lang="ts">
  import logo from '../../../../build/icon.svg?url'
  import { Avatar, Icon, IconButton, tooltip } from '../kit'
  import { channels, clock, displayName, roleColor, stamp, type PMessage } from './data'

  let {
    message,
    grouped = false,
    hovered = false,
    plain = false,
  }: {
    message: PMessage
    grouped?: boolean
    /** Protótipo: mostra a barra de ações como se o mouse estivesse em cima. */
    hovered?: boolean
    /** Sem cor de cargo nos nomes (conversa privada não tem cargo). */
    plain?: boolean
  } = $props()

  type Token =
    | { k: 'text'; t: string }
    | { k: 'user'; id: string }
    | { k: 'channel'; id: string }
    | { k: 'everyone' }
    | { k: 'bold'; t: string }
    | { k: 'code'; t: string }
    | { k: 'link'; t: string }

  /** Menções (<@id>, <#id>, @everyone), **negrito**, `código` e links. */
  function tokenize(content: string): Token[] {
    const out: Token[] = []
    const re = /<@([\w-]+)>|<#([\w-]+)>|@everyone|\*\*([^*]+)\*\*|`([^`]+)`|https?:\/\/\S+/g
    let last = 0
    for (const m of content.matchAll(re)) {
      if (m.index! > last) out.push({ k: 'text', t: content.slice(last, m.index) })
      if (m[1]) out.push({ k: 'user', id: m[1] })
      else if (m[2]) out.push({ k: 'channel', id: m[2] })
      else if (m[3]) out.push({ k: 'bold', t: m[3] })
      else if (m[4]) out.push({ k: 'code', t: m[4] })
      else if (m[0] === '@everyone') out.push({ k: 'everyone' })
      else out.push({ k: 'link', t: m[0] })
      last = m.index! + m[0].length
    }
    if (last < content.length) out.push({ k: 'text', t: content.slice(last) })
    return out
  }

  const tokens = $derived(tokenize(message.content))
  const color = $derived(plain ? null : roleColor(message.authorId))
</script>

<article class:grouped class:hovered class:mentioned={message.mentionsMe} class:has-reply={!!message.replyTo}>
  {#if message.replyTo}
    <div class="reply">
      <span class="spine" aria-hidden="true"></span>
      <Avatar id={message.replyTo.authorId} name={displayName(message.replyTo.authorId)} size={16} />
      <span class="reply-name" style:color={roleColor(message.replyTo.authorId)}>{displayName(message.replyTo.authorId)}</span>
      <span class="reply-text">{message.replyTo.content}</span>
    </div>
  {/if}

  <div class="line">
    <div class="gutter">
      {#if grouped}
        <time class="time-hover">{clock(message.createdAt)}</time>
      {:else}
        <Avatar id={message.authorId} name={displayName(message.authorId)} size={36} />
      {/if}
    </div>

    <div class="body">
      {#if !grouped}
        <div class="head">
          <span class="author" style:color>{displayName(message.authorId)}</span>
          <time class="stamp">{stamp(message.createdAt)}</time>
          {#if message.pinned}<span class="pin" use:tooltip={'Fixada'}><Icon name="pin" size={12} /></span>{/if}
        </div>
      {/if}

      <div class="content">
        {#each tokens as token, i (i)}
          {#if token.k === 'user'}<span class="mention">@{displayName(token.id)}</span>
          {:else if token.k === 'channel'}{@const channel = channels.find((c) => c.id === token.id)}<span class="mention"
              ><Icon name={channel?.kind === 'voice' ? 'volume' : 'hash'} size={13} />{channel?.name}</span
            >
          {:else if token.k === 'everyone'}<span class="mention">@everyone</span>
          {:else if token.k === 'bold'}<strong>{token.t}</strong>
          {:else if token.k === 'code'}<code>{token.t}</code>
          {:else if token.k === 'link'}<a href={token.t}>{token.t}</a>
          {:else}{token.t}{/if}
        {/each}
        {#if message.editedAt}<span class="edited">editada</span>{/if}
      </div>

      {#each message.attachments ?? [] as attachment (attachment.name)}
        {#if attachment.kind === 'image'}
          <div class="image" aria-label={attachment.name}>
            <img src={logo} alt="" width="120" height="120" />
          </div>
        {/if}
      {/each}

      {#each message.embeds ?? [] as embed (embed.url)}
        <div class="embed">
          <span class="site">{embed.siteName}</span>
          <a class="embed-title" href={embed.url}>{embed.title}</a>
          <p>{embed.description}</p>
          {#if embed.image}
            <div class="embed-image"><span class="play"><Icon name="play" size={22} /></span></div>
          {/if}
        </div>
      {/each}

      {#if message.reactions?.length}
        <div class="reactions">
          {#each message.reactions as reaction (reaction.emoji)}
            <button class="reaction" class:me={reaction.me} aria-pressed={reaction.me}>
              <span class="emoji">{reaction.emoji}</span>
              <span class="count">{reaction.count}</span>
            </button>
          {/each}
          <button class="reaction add" aria-label="Reagir"><Icon name="emoji-plus" size={16} /></button>
        </div>
      {/if}
    </div>
  </div>

  <div class="actions">
    <IconButton icon="emoji-plus" label="Reagir" size="sm" />
    <IconButton icon="reply" label="Responder" size="sm" />
    <IconButton icon="pin" label="Fixar" size="sm" />
    <IconButton icon="ellipsis" label="Mais" size="sm" />
  </div>
</article>

<style>
  article {
    position: relative;
    margin-top: 14px;
    padding: 3px 20px;
  }

  article.grouped {
    margin-top: 0;
    padding-top: 1px;
    padding-bottom: 1px;
  }

  article:hover,
  article.hovered {
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

  .reply {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    margin: 0 0 2px 50px;
    color: var(--fg-3);
    font-size: var(--text-sm);
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

  .time-hover {
    visibility: hidden;
    color: var(--fg-3);
    font-size: 10.5px;
    line-height: 22px;
    font-variant-numeric: tabular-nums;
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
    font-weight: 600;
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

  .content {
    color: #dedee6;
    font-size: var(--text-lg);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .mention {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    border-radius: var(--r-xs);
    background: rgb(122 108 255 / 0.18);
    color: #c9c2ff;
    font-weight: 550;
    vertical-align: baseline;
  }

  .mention :global(svg) {
    align-self: center;
  }

  strong {
    color: var(--fg);
    font-weight: 650;
  }

  code {
    padding: 1px 5px;
    border-radius: var(--r-xs);
    background: rgb(255 255 255 / 0.07);
    font-family: var(--mono);
    font-size: 0.86em;
  }

  .edited {
    margin-left: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .image {
    display: grid;
    place-items: center;
    width: 320px;
    height: 200px;
    margin-top: 6px;
    border-radius: var(--r-lg);
    background:
      radial-gradient(60% 70% at 30% 20%, rgb(111 125 255 / 0.35), transparent 70%),
      radial-gradient(60% 70% at 80% 90%, rgb(255 90 122 / 0.28), transparent 70%),
      #15151d;
    box-shadow: 0 0 0 1px var(--line);
  }

  .image img {
    filter: drop-shadow(0 12px 24px rgb(0 0 0 / 0.45));
  }

  .embed {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 420px;
    margin-top: 8px;
    padding: 12px 14px 14px;
    border-radius: var(--r-lg);
    background: var(--bg-raised);
    box-shadow:
      inset 3px 0 0 #ff4e45,
      0 0 0 1px var(--line);
  }

  .site {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .embed-title {
    color: var(--accent-fg);
    font-weight: 600;
  }

  .embed p {
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .embed-image {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    margin-top: 8px;
    border-radius: var(--r-md);
    background:
      linear-gradient(160deg, rgb(54 214 173 / 0.5), transparent 60%),
      linear-gradient(20deg, rgb(255 195 90 / 0.45), transparent 60%),
      #1d2a27;
  }

  .play {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: rgb(8 8 12 / 0.65);
    backdrop-filter: blur(6px);
    color: #fff;
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

  .reaction:hover {
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
  article.hovered .reaction.add {
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
  article.hovered .actions {
    display: flex;
  }
</style>
