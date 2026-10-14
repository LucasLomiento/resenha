<script lang="ts">
  import { tick } from 'svelte'
  import type { Message } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { formatDay } from '../../lib/format'
  import { around, m } from '../../lib/i18n.svelte'
  import { toggleMembers, ui } from '../../lib/ui.svelte'
  import BackButton from '../BackButton.svelte'
  import MemberList from '../guild/MemberList.svelte'
  import { Avatar, Button, EmptyState, Icon, IconButton, layer, Spinner } from '../kit'
  import ProfileBody from '../profile/ProfileBody.svelte'
  import Composer from './Composer.svelte'
  import MessageItem from './Message.svelte'
  import PinsPopover from './PinsPopover.svelte'
  import SearchPanel from './SearchPanel.svelte'
  import { channelTarget, dmTarget, type ChatTarget } from './target.svelte'

  // Canal de servidor ou conversa privada, conforme a rota.
  const target = $derived.by((): ChatTarget | null => {
    const route = client.route
    if (route.kind === 'guild') {
      const guild = client.guilds[route.guildId]
      const channel = guild?.channel(route.channelId)
      return guild && channel && channel.kind === 'text' ? channelTarget(guild, channel) : null
    }
    if (route.kind === 'dm' && client.home) {
      const dm = client.home.dm(route.channelId)
      return dm ? dmTarget(client.home, dm) : null
    }
    return null
  })

  const guild = $derived(target?.guild ?? null)
  const messages = $derived(target?.messages ?? [])
  const typing = $derived(target ? target.typing(client.now) : [])
  const peer = $derived(target?.dm?.user ?? null)
  const peerPresence = $derived(peer ? client.presenceOf(peer.id) : null)
  const t = $derived(m.chat.view)

  let scroller = $state<HTMLDivElement>()
  let composer = $state<{ addFiles(files: File[]): void; focus(): void }>()
  let dragging = $state(false)
  let replyTo = $state<Message | null>(null)
  let highlighted = $state<string | null>(null)
  let pinsButton = $state<HTMLElement>()
  let pinsOpen = $state(false)
  let searchText = $state('')
  let searchQuery = $state('')
  /** Celular: membros (ou o perfil, na conversa privada) numa gaveta por cima do chat. */
  let drawer = $state(false)
  let refs: Record<string, { startEdit(): void } | undefined> = {}

  // Trocou de conversa: fecha o que era da anterior.
  let lastTargetId = ''
  $effect.pre(() => {
    const id = target?.id ?? ''
    if (id === lastTargetId) return
    lastTargetId = id
    replyTo = null
    pinsOpen = false
    drawer = false
    highlighted = null
  })

  const aside = $derived.by((): 'members' | 'search' | 'profile' | null => {
    if (!target) return null
    if (guild && searchQuery) return 'search'
    if (ui.compact ? drawer : ui.members) return guild ? 'members' : 'profile'
    return null
  })

  function toggleAside() {
    if (ui.compact) drawer = !drawer
    else toggleMembers()
  }

  // ---------- Agrupamento e divisórias ----------

  function sameDay(a: Message, b: Message) {
    return new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString()
  }

  /** Mesmo autor em sequência (até 7 min, sem resposta) não repete o cabeçalho. */
  function isGrouped(prev: Message | undefined, m: Message) {
    return !!prev && prev.authorId === m.authorId && !m.replyTo && m.createdAt - prev.createdAt < 7 * 60_000 && sameDay(prev, m)
  }

  /** Primeira mensagem nova (dos outros) desde que abri: ganha a linha "Novas". */
  const firstNew = $derived.by(() => {
    if (!target?.lastReadId) return null
    const me = client.me?.id
    return messages.find((m) => m.id > target.lastReadId! && m.authorId !== me)?.id ?? null
  })

  // ---------- Rolagem: grudar no fim; manter a posição ao carregar as antigas ----------

  let lastTarget: string | undefined
  let lastFirstId: string | undefined
  let lastCount = 0
  let atBottom = true
  let anchor = 0

  $effect.pre(() => {
    void messages.length
    if (!scroller) return
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
    anchor = scroller.scrollHeight - scroller.scrollTop
  })

  $effect(() => {
    const id = target?.id
    const firstId = messages[0]?.id
    const count = messages.length
    const newer = target?.hasNewer
    tick().then(() => {
      if (!scroller) return
      if (id !== lastTarget) {
        // Abriu a conversa: vai pra linha de "novas" (se tiver), senão pro fim.
        const divider = scroller.querySelector('.new-divider') as HTMLElement | null
        if (divider) divider.scrollIntoView({ block: 'center' })
        else scroller.scrollTop = scroller.scrollHeight
      } else if (firstId !== lastFirstId && count > lastCount && lastFirstId) {
        scroller.scrollTop = scroller.scrollHeight - anchor
      } else if (atBottom && !newer && !highlighted) {
        scroller.scrollTop = scroller.scrollHeight
      }
      lastTarget = id
      lastFirstId = firstId
      lastCount = count
    })
  })

  function onScroll() {
    if (!scroller || !target) return
    if (scroller.scrollTop < 300 && target.hasMore && !target.loading && messages[0]) target.loadMore()
    const bottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
    if (bottom && target.hasNewer && !target.loading) target.loadNewer()
  }

  // ---------- Pular pra uma mensagem (resposta, fixadas, busca) ----------

  let pendingJump: { channelId: string; messageId: string } | null = null

  async function jumpTo(messageId: string) {
    if (!target) return
    pinsOpen = false
    await target.jumpTo(messageId)
    await tick()
    const el = scroller?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`) as HTMLElement | null
    if (!el) return client.toast(m.chat.view.messageGone)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    highlighted = messageId
    setTimeout(() => {
      if (highlighted === messageId) highlighted = null
    }, 1800)
  }

  /** Resultado da busca pode ser de outro canal: troca primeiro, pula depois. */
  function jumpFromSearch(channelId: string, messageId: string) {
    if (!guild) return
    if (target?.id === channelId) return jumpTo(messageId)
    pendingJump = { channelId, messageId }
    client.openChannel(guild.id, channelId)
  }

  $effect(() => {
    const id = target?.id
    if (!pendingJump || pendingJump.channelId !== id) return
    const { messageId } = pendingJump
    pendingJump = null
    tick().then(() => jumpTo(messageId))
  })

  /** Seta pra cima no campo vazio: edita a última mensagem minha que está na tela. */
  function editLast() {
    const me = client.me?.id
    const last = [...messages].reverse().find((m) => m.authorId === me && m.content)
    if (!last) return
    refs[last.id]?.startEdit()
    tick().then(() => scroller?.querySelector(`[data-message-id="${CSS.escape(last.id)}"]`)?.scrollIntoView({ block: 'nearest' }))
  }

  // ---------- Chamada privada ----------

  const dmCall = $derived(target?.dm && client.home ? (client.home.calls[target.dm.id] ?? null) : null)
  const inThisCall = $derived(!!target?.dm && client.call.dmId === target.dm.id)

  // ---------- Arrastar arquivo ----------

  function onDrop(event: DragEvent) {
    event.preventDefault()
    dragging = false
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length && target?.canAttach && target.canSend) composer?.addFiles(files)
  }

  function submitSearch(event: KeyboardEvent) {
    if (event.key === 'Enter') searchQuery = searchText.trim()
    if (event.key === 'Escape') {
      event.preventDefault()
      searchText = ''
      searchQuery = ''
      ;(event.currentTarget as HTMLInputElement).blur()
    }
  }
</script>

{#if target}
  <div class="pane" class:with-aside={!!aside}>
    <section
      class="chat"
      aria-label={t.label}
      ondragover={(e) => {
        if (e.dataTransfer?.types.includes('Files') && target.canAttach && target.canSend) {
          e.preventDefault()
          dragging = true
        }
      }}
      ondragleave={(e) => {
        if (e.currentTarget === e.target) dragging = false
      }}
      ondrop={onDrop}
    >
      <header>
        <BackButton />
        {#if peer}
          <Avatar id={peer.id} name={peer.name} size={24} src={client.avatarOf(peer.id)} status={peerPresence?.status ?? null} cutout="var(--bg-panel)" />
          <h1>{peer.name}</h1>
          <span class="topic">{peerPresence?.text ?? m.common.presence[peerPresence?.status ?? 'offline']}</span>
        {:else}
          <Icon name="hash" size={20} class="header-icon" />
          <h1>{target.title}</h1>
          {#if target.channel?.topic}<span class="divider"></span><span class="topic" title={target.channel.topic}>{target.channel.topic}</span>{/if}
        {/if}

        <div class="tools">
          {#if peer}
            <IconButton icon="phone" label={t.call} tip="bottom" disabled={inThisCall || !target.canSend} onclick={() => client.startDmCall(target.id)} />
            <IconButton icon="camera" label={t.videoCall} tip="bottom" disabled={inThisCall || !target.canSend} onclick={() => client.startDmCall(target.id, true)} />
            <IconButton icon="user" label={t.profile} tip="bottom" active={aside === 'profile'} onclick={toggleAside} />
          {:else}
            <span bind:this={pinsButton}>
              <IconButton icon="pin" label={m.chat.pins.label} tip="bottom" active={pinsOpen} onclick={() => (pinsOpen = !pinsOpen)} />
            </span>
            <IconButton icon="users" label={t.members} tip="bottom" active={aside === 'members'} onclick={() => (searchQuery ? (searchQuery = '') : toggleAside())} />
            <label class="search" class:filled={!!searchText}>
              <Icon name="search" size={15} />
              <input placeholder={m.common.search} bind:value={searchText} aria-label={t.searchLabel} onkeydown={submitSearch} data-own-escape />
              {#if searchText}
                <button class="clear" aria-label={t.clearSearch} onclick={() => ((searchText = ''), (searchQuery = ''))}><Icon name="x" size={14} /></button>
              {/if}
            </label>
          {/if}
        </div>
      </header>

      {#if dmCall && !inThisCall && dmCall.members.length}
        <div class="call-banner">
          <Icon name="phone" size={16} />
          <span>{t.callOngoing}</span>
          <Button size="sm" variant="primary" onclick={() => client.startDmCall(target.id)}>{t.join}</Button>
        </div>
      {:else if inThisCall && dmCall?.ringing.length}
        <div class="call-banner calling">
          <span class="pulse" aria-hidden="true"></span>
          <span>{t.calling(peer?.name ?? '')}</span>
          <Button size="sm" variant="danger-soft" onclick={() => client.leaveCall()}>{m.common.cancel}</Button>
        </div>
      {/if}

      <div class="scroller" bind:this={scroller} onscroll={onScroll}>
        {#if target.hasMore === false}
          <div class="start">
            {#if peer}
              <Avatar id={peer.id} name={peer.name} size={64} src={client.avatarOf(peer.id)} />
              <h2>{peer.name}</h2>
              <p>{t.dmStart(peer.username)}</p>
            {:else}
              <h2>{t.channelWelcome(target.title)}</h2>
              <p>{t.channelStart}</p>
            {/if}
          </div>
        {:else if target.loading && !messages.length}
          <div class="loading"><Spinner size={18} /></div>
        {:else if target.hasMore}
          <div class="loading top"><Spinner size={16} /></div>
        {/if}

        {#each messages as message, i (message.id)}
          {#if i === 0 || !sameDay(messages[i - 1], message)}
            <div class="day" role="separator"><span>{formatDay(message.createdAt)}</span></div>
          {/if}
          {#if message.id === firstNew}
            <div class="new-divider" role="separator"><span>{t.newMessages}</span></div>
          {/if}
          <MessageItem
            bind:this={refs[message.id]}
            {message}
            {target}
            grouped={isGrouped(messages[i - 1], message) && message.id !== firstNew}
            highlighted={highlighted === message.id}
            onreply={(m) => (replyTo = m)}
            onjump={jumpTo}
          />
        {/each}
      </div>

      {#if target.hasNewer}
        <button class="present" onclick={() => target.jumpToPresent()}>
          {t.oldMessages}
          <span>{t.toPresent} <Icon name="chevron-down" size={14} /></span>
        </button>
      {/if}

      <Composer bind:this={composer} {target} bind:replyTo oneditlast={editLast} />
      <div class="typing" aria-live="polite">
        {#if typing.length}
          <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
          {#if typing.length === 1}{@const [before, after] = around(t.typingOne, '{name}')}{before}<b>{target.displayName(typing[0])}</b>{after}
          {:else if typing.length <= 3}{@const [before, after] = around(t.typingSome, '{names}')}{before}<b
              >{typing.map((id) => target.displayName(id)).join(', ')}</b
            >{after}
          {:else}{t.typingMany}{/if}
        {/if}
      </div>

      {#if dragging}
        <div class="drop">
          <div class="drop-card">
            <Icon name="upload" size={28} />
            <span>{peer ? t.dropDm(peer.name) : t.dropChannel(target.title)}</span>
          </div>
        </div>
      {/if}
    </section>

    {#if ui.compact && drawer && (aside === 'members' || aside === 'profile')}
      <!-- Celular: a gaveta fecha com o voltar do Android (é uma camada, como um menu). -->
      <div class="aside drawer" use:layer={() => (drawer = false)}>
        {#if aside === 'members' && guild}
          <MemberList {guild} />
        {:else if peer}
          <ProfileBody userId={peer.id} guildId={null} flat />
        {/if}
      </div>
    {:else if aside === 'members' && guild}
      <div class="aside"><MemberList {guild} /></div>
    {:else if aside === 'search' && guild}
      <div class="aside search-aside">
        <SearchPanel {guild} query={searchQuery} onjump={jumpFromSearch} onclose={() => ((searchQuery = ''), (searchText = ''))} />
      </div>
    {:else if aside === 'profile' && peer}
      <div class="aside"><ProfileBody userId={peer.id} guildId={null} flat /></div>
    {/if}
  </div>

  {#if pinsOpen && pinsButton}
    <PinsPopover {target} anchor={pinsButton} onjump={jumpTo} onclose={() => (pinsOpen = false)} />
  {/if}
{:else}
  <div class="nothing">
    {#if client.route.kind === 'guild' && !client.guilds[client.route.guildId]?.loaded}
      <Spinner size={20} />
    {:else}
      <EmptyState icon="hash" title={t.noChannel} description={t.noChannelHint} />
    {/if}
  </div>
{/if}

<style>
  .pane {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
  }

  .pane.with-aside {
    grid-template-columns: minmax(0, 1fr) 248px;
  }

  /* Painel estreito (janela pequena): a coluna da direita sai e o tópico some do cabeçalho. */
  @container panel (max-width: 780px) {
    .pane.with-aside {
      grid-template-columns: minmax(0, 1fr);
    }

    .aside,
    .divider,
    .topic {
      display: none;
    }

    /* A busca não some: os resultados abrem numa gaveta por cima do chat (no celular, os
       membros também). */
    .aside.search-aside,
    .aside.drawer {
      display: block;
      position: absolute;
      top: var(--header-h);
      right: 0;
      bottom: 0;
      z-index: 6;
      width: min(320px, 88%);
      background: var(--bg-panel);
      box-shadow:
        -1px 0 0 var(--line),
        var(--shadow-lg);
      animation: rs-fade-in var(--t) var(--ease);
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
    padding: 0 14px 0 22px;
    border-bottom: 1px solid var(--line);
  }

  header :global(.header-icon) {
    flex: none;
    color: var(--fg-3);
  }

  h1 {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .divider {
    flex: none;
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
    flex: none;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 168px;
    height: 32px;
    margin-left: 6px;
    padding: 0 10px 0 12px;
    border-radius: var(--r-full);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-3);
    transition:
      width var(--t) var(--ease),
      box-shadow var(--t-fast) var(--ease);
  }

  .search:focus-within,
  .search.filled {
    width: 220px;
    box-shadow: var(--focus-ring);
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

  .clear:hover {
    color: var(--fg);
  }

  .call-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    margin: 10px 16px 0;
    padding: 8px 8px 8px 14px;
    border-radius: var(--r-lg);
    background: var(--bg-raised);
    box-shadow:
      inset 0 0 0 1px var(--line),
      var(--highlight);
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 550;
  }

  .call-banner span {
    flex: 1;
  }

  .call-banner.calling {
    color: var(--fg-2);
  }

  /* Só o pulso fica verde: o resto da faixa é neutro. */
  .call-banner .pulse {
    color: var(--green);
  }

  .pulse {
    flex: none !important;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }

  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 0 12px;
    overflow-anchor: none;
  }

  .start {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 32px 20px 16px;
  }

  .start :global(.avatar) {
    margin-bottom: 8px;
  }

  .start h2 {
    font-family: var(--font-display);
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: -0.035em;
    line-height: 1.1;
  }

  .start p {
    color: var(--fg-2);
  }

  .loading {
    display: grid;
    place-items: center;
    padding: 20px;
    color: var(--fg-3);
  }

  .loading.top {
    padding: 12px;
  }

  .day {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 20px 20px 8px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .day::before,
  .day::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .new-divider {
    position: relative;
    height: 1px;
    margin: 12px 20px 4px;
    background: rgb(255 90 107 / 0.55);
  }

  .new-divider span {
    position: absolute;
    top: 50%;
    right: 0;
    padding: 1px 7px;
    border-radius: var(--r-full);
    background: var(--red-fill);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    translate: 0 -50%;
  }

  .present {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    margin: 0 16px 8px;
    padding: 8px 14px;
    border-radius: var(--r-lg);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent-line);
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .present span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--accent-fg);
    font-weight: 600;
  }

  .typing {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 26px;
    padding: 0 20px 2px;
    overflow: hidden;
    color: var(--fg-3);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .typing b {
    color: var(--fg-2);
    font-weight: 600;
  }

  .dots {
    display: inline-flex;
    gap: 3px;
    margin-right: 2px;
  }

  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--fg-2);
    animation: typing 1.2s ease-in-out infinite;
  }

  .dots i:nth-child(2) {
    animation-delay: 0.15s;
  }

  .dots i:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes typing {
    0%,
    60%,
    100% {
      opacity: 0.3;
      transform: translateY(0);
    }
    30% {
      opacity: 1;
      transform: translateY(-2px);
    }
  }

  .drop {
    position: absolute;
    inset: 0;
    z-index: 15;
    display: grid;
    place-items: center;
    padding: 16px;
    background: var(--scrim);
    backdrop-filter: blur(4px);
    pointer-events: none;
    animation: rs-fade-in var(--t) var(--ease);
  }

  .drop-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 32px 40px;
    border: 1.5px dashed var(--accent-line);
    border-radius: var(--r-2xl);
    background: var(--accent-soft);
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .aside {
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--line);
    overflow: hidden;
  }

  .nothing {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--fg-3);
  }

  /* Celular: a busca vira só a lupa e, ao tocar, ocupa o cabeçalho inteiro. */
  @container panel (max-width: 520px) {
    header {
      position: relative;
      gap: 6px;
      padding: 0 8px 0 6px;
    }

    h1 {
      flex: 1;
      max-width: none;
      min-width: 0;
    }

    .search {
      width: 32px;
      margin-left: 0;
      padding: 0 0 0 8px;
      background: transparent;
      box-shadow: none;
      cursor: pointer;
    }

    /* O campo continua lá (fino e invisível) pra receber o toque na lupa. */
    .search input {
      opacity: 0;
    }

    .search:focus-within,
    .search.filled {
      position: absolute;
      inset: 8px 8px;
      z-index: 2;
      width: auto;
      height: auto;
      padding: 0 10px 0 12px;
      background: var(--bg-input);
    }

    .search:focus-within input,
    .search.filled input {
      opacity: 1;
    }

    .aside.search-aside,
    .aside.drawer {
      width: 100%;
    }
  }
</style>
