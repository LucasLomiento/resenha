<script lang="ts">
  import type { Snippet } from 'svelte'
  import { Avatar, Icon, IconButton, Kbd, STATUS_LABEL } from '../kit'
  import { dayLabel, displayName, members, presences, roleColor, roles, sameDay, user, type PMessage } from './data'
  import RichMessage from './RichMessage.svelte'

  let {
    kind = 'channel',
    title,
    topic,
    dmUser,
    messages,
    hovered,
    membersOpen = false,
    pinsOpen = false,
    searchQuery,
    placeholder,
    replyTo,
    mentionPicker = false,
    typing,
    aside,
    overlay,
  }: {
    kind?: 'channel' | 'dm'
    title: string
    topic?: string
    dmUser?: string
    messages: PMessage[]
    /** Mensagem com a barra de ações à mostra. */
    hovered?: string
    membersOpen?: boolean
    pinsOpen?: boolean
    /** Texto no campo de busca do cabeçalho (com resultados à direita). */
    searchQuery?: string
    placeholder: string
    /** Respondendo a alguém (barra em cima do campo). */
    replyTo?: string
    /** Sugestões de @menção abertas. */
    mentionPicker?: boolean
    typing?: string
    aside?: Snippet
    overlay?: Snippet
  } = $props()

  function grouped(i: number) {
    const prev = messages[i - 1]
    const m = messages[i]
    return !!prev && prev.authorId === m.authorId && !m.replyTo && m.createdAt - prev.createdAt < 7 * 60_000 && sameDay(prev.createdAt, m.createdAt)
  }

  const mentionPeople = members.slice(0, 4).map((m) => user(m.userId))

  /** Como no app: a conversa abre no fim. */
  function toBottom(node: HTMLElement) {
    node.scrollTop = node.scrollHeight
    requestAnimationFrame(() => (node.scrollTop = node.scrollHeight))
  }
</script>

<div class="pane-box">
<div class="pane" class:with-aside={!!aside}>
  <section class="chat">
    <header>
      {#if kind === 'dm' && dmUser}
        <Avatar id={dmUser} name={title} size={24} status={presences[dmUser].status} cutout="var(--bg-panel)" />
        <h1>{title}</h1>
        <span class="topic">{presences[dmUser].text ?? STATUS_LABEL[presences[dmUser].status]}</span>
      {:else}
        <Icon name="hash" size={20} class="header-icon" />
        <h1>{title}</h1>
        {#if topic}<span class="divider"></span><span class="topic">{topic}</span>{/if}
      {/if}

      <div class="tools">
        {#if kind === 'dm'}
          <IconButton icon="phone" label="Ligar" tip="bottom" />
          <IconButton icon="camera" label="Chamada de vídeo" tip="bottom" />
        {/if}
        <IconButton icon="pin" label="Mensagens fixadas" tip="bottom" active={pinsOpen} />
        {#if kind === 'channel'}
          <IconButton icon="users" label="Membros" tip="bottom" active={membersOpen} />
        {:else}
          <IconButton icon="user" label="Perfil" tip="bottom" active={membersOpen} />
        {/if}
        <label class="search" class:filled={!!searchQuery}>
          <Icon name="search" size={15} />
          <input placeholder="Buscar" value={searchQuery ?? ''} aria-label="Buscar mensagens" />
          {#if searchQuery}<button class="clear" aria-label="Limpar busca"><Icon name="x" size={14} /></button>{/if}
        </label>
      </div>
    </header>

    <div class="scroller" use:toBottom>
      {#each messages as message, i (message.id)}
        {#if i === 0 || !sameDay(messages[i - 1].createdAt, message.createdAt)}
          <div class="day" role="separator"><span>{dayLabel(message.createdAt)}</span></div>
        {/if}
        <RichMessage {message} grouped={grouped(i)} hovered={hovered === message.id} plain={kind === 'dm'} />
      {/each}
    </div>

    <div class="composer">
      {#if mentionPicker}
        <div class="picker" role="listbox" aria-label="Sugestões">
          <div class="picker-label">Pessoas</div>
          {#each mentionPeople as person, i (person.id)}
            <div class="option" class:on={i === 0} role="option" aria-selected={i === 0}>
              <Avatar id={person.id} name={person.name} size={24} status={presences[person.id].status} cutout={i === 0 ? '#25252f' : 'var(--bg-raised)'} />
              <span class="option-name" style:color={roleColor(person.id)}>{displayName(person.id)}</span>
              <span class="option-sub">{person.username}</span>
            </div>
          {/each}
          <div class="picker-label">Cargos</div>
          {#each roles.filter((r) => r.mentionable) as role (role.id)}
            <div class="option" role="option" aria-selected="false">
              <span class="role-dot" style:background={role.color}></span>
              <span class="option-name" style:color={role.color}>@{role.name}</span>
              <span class="option-sub">{members.filter((m) => m.roles.includes(role.id)).length} pessoas</span>
            </div>
          {/each}
          <div class="option" role="option" aria-selected="false">
            <span class="role-dot everyone"></span>
            <span class="option-name">@everyone</span>
            <span class="option-sub">Notifica todo mundo</span>
          </div>
          <div class="picker-foot"><Kbd keys="↑" /><Kbd keys="↓" /> escolher <Kbd keys="Tab" /> completar</div>
        </div>
      {/if}

      <div class="box" class:replying={!!replyTo}>
        {#if replyTo}
          <div class="reply-bar">
            <Icon name="reply" size={14} />
            <span>Respondendo a <b>{replyTo}</b></span>
            <button class="reply-close" aria-label="Cancelar resposta"><Icon name="x" size={14} /></button>
          </div>
        {/if}
        <div class="input-row">
          <IconButton icon="paperclip" label="Anexar arquivo" />
          <div class="fake-input" class:typed={mentionPicker}>
            {#if mentionPicker}<span>Alguém pode revisar o PR?&nbsp;</span><span class="caret-mention">@</span><span class="caret"></span>
            {:else}<span class="placeholder">{placeholder}</span>{/if}
          </div>
          <IconButton icon="emoji" label="Emoji" />
        </div>
      </div>
    </div>
    <div class="typing">
      {#if typing}<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><b>{typing}</b> está digitando…{/if}
    </div>

    {@render overlay?.()}
  </section>

  {#if aside}
    <div class="aside">{@render aside()}</div>
  {/if}
</div>
</div>

<style>
  .pane-box {
    height: 100%;
    container-type: inline-size;
  }

  .pane {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
  }

  .pane.with-aside {
    grid-template-columns: minmax(0, 1fr) 248px;
  }

  /* Painel estreito (janela pequena): a coluna da direita sai e o tópico some do cabeçalho. */
  @container (max-width: 780px) {
    .pane.with-aside {
      grid-template-columns: minmax(0, 1fr);
    }

    .aside,
    .divider,
    .topic {
      display: none;
    }

    .search {
      width: 132px;
    }
  }

  .chat {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    height: var(--header-h);
    padding: 0 12px 0 20px;
    border-bottom: 1px solid var(--line);
  }

  header :global(.header-icon) {
    color: var(--fg-3);
  }

  h1 {
    flex: none;
    font-size: var(--text-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }

  .divider {
    width: 1px;
    height: 18px;
    background: var(--line-strong);
  }

  .topic {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 168px;
    height: 30px;
    margin-left: 6px;
    padding: 0 8px 0 10px;
    border-radius: var(--r-md);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-3);
    transition: width var(--t) var(--ease);
  }

  .search.filled {
    width: 220px;
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

  .search input::placeholder {
    color: var(--fg-3);
  }

  .clear {
    display: grid;
    color: var(--fg-3);
  }

  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 0 12px;
  }

  .day {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 20px 20px 8px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .day::before,
  .day::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .composer {
    position: relative;
    flex: none;
    padding: 0 16px;
  }

  .box {
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight);
  }

  .reply-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--line);
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .reply-bar span {
    flex: 1;
  }

  .reply-bar b {
    color: var(--fg);
    font-weight: 600;
  }

  .reply-close {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.08);
    color: var(--fg-2);
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 48px;
    padding: 8px;
  }

  .fake-input {
    flex: 1;
    min-width: 0;
    padding: 0 4px;
    font-size: var(--text-lg);
  }

  .placeholder {
    color: var(--fg-3);
  }

  .caret-mention {
    color: var(--accent-fg);
  }

  .caret {
    display: inline-block;
    width: 1.5px;
    height: 18px;
    margin-left: 1px;
    vertical-align: text-bottom;
    background: var(--fg);
  }

  .picker {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: calc(100% + 8px);
    z-index: 5;
    padding: 6px;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-lg);
  }

  .picker-label {
    padding: 8px 10px 4px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 10px;
    border-radius: var(--r-md);
    font-size: var(--text-sm);
  }

  .option.on {
    background: #25252f;
  }

  .option-name {
    color: var(--fg);
    font-weight: 550;
  }

  .option-sub {
    margin-left: auto;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .role-dot {
    width: 10px;
    height: 10px;
    margin: 0 7px;
    border-radius: 50%;
  }

  .role-dot.everyone {
    background: var(--fg-3);
  }

  .picker-foot {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    padding: 8px 10px 4px;
    border-top: 1px solid var(--line);
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .typing {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 26px;
    padding: 0 22px 2px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .typing b {
    color: var(--fg-2);
    font-weight: 600;
  }

  .dots {
    display: inline-flex;
    gap: 3px;
  }

  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--fg-2);
  }

  .dots i:nth-child(2) {
    opacity: 0.6;
  }

  .dots i:nth-child(3) {
    opacity: 0.3;
  }

  .aside {
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--line);
    overflow: hidden;
  }
</style>
