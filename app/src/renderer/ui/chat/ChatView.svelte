<script lang="ts">
  import { tick } from 'svelte'
  import type { Message } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { formatDay } from '../../lib/format'
  import { toggleMembers, ui } from '../../lib/ui.svelte'
  import MemberList from '../guild/MemberList.svelte'
  import { Avatar, Button, EmptyState, Icon, IconButton, Spinner, STATUS_LABEL } from '../kit'
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

  let scroller = $state<HTMLDivElement>()
  let composer = $state<{ addFiles(files: File[]): void; focus(): void }>()
  let dragging = $state(false)
  let replyTo = $state<Message | null>(null)
  let highlighted = $state<string | null>(null)
  let pinsButton = $state<HTMLElement>()
  let pinsOpen = $state(false)
  let searchText = $state('')
  let searchQuery = $state('')
  let refs: Record<string, { startEdit(): void } | undefined> = {}

  // Trocou de conversa: fecha o que era da anterior.
  let lastTargetId = ''
  $effect.pre(() => {
    const id = target?.id ?? ''
    if (id === lastTargetId) return
    lastTargetId = id
    replyTo = null
    pinsOpen = false
    highlighted = null
  })

  const aside = $derived.by((): 'members' | 'search' | 'profile' | null => {
    if (!target) return null
    if (guild && searchQuery) return 'search'
    if (ui.members) return guild ? 'members' : 'profile'
    return null
  })

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
    if (!el) return client.toast('Essa mensagem não existe mais.')
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
      aria-label="Chat"
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
        {#if peer}
          <Avatar id={peer.id} name={peer.name} size={24} src={client.avatarOf(peer.id)} status={peerPresence?.status ?? null} cutout="var(--bg-panel)" />
          <h1>{peer.name}</h1>
          <span class="topic">{peerPresence?.text ?? STATUS_LABEL[peerPresence?.status ?? 'offline']}</span>
        {:else}
          <Icon name="hash" size={20} class="header-icon" />
          <h1>{target.title}</h1>
          {#if target.channel?.topic}<span class="divider"></span><span class="topic" title={target.channel.topic}>{target.channel.topic}</span>{/if}
        {/if}

        <div class="tools">
          {#if peer}
            <IconButton icon="phone" label="Ligar" tip="bottom" disabled={inThisCall || !target.canSend} onclick={() => client.startDmCall(target.id)} />
            <IconButton icon="camera" label="Chamada de vídeo" tip="bottom" disabled={inThisCall || !target.canSend} onclick={() => client.startDmCall(target.id, true)} />
            <IconButton icon="user" label="Perfil" tip="bottom" active={ui.members} onclick={toggleMembers} />
          {:else}
            <span bind:this={pinsButton}>
              <IconButton icon="pin" label="Mensagens fixadas" tip="bottom" active={pinsOpen} onclick={() => (pinsOpen = !pinsOpen)} />
            </span>
            <IconButton icon="users" label="Membros" tip="bottom" active={ui.members && !searchQuery} onclick={() => (searchQuery ? (searchQuery = '') : toggleMembers())} />
            <label class="search" class:filled={!!searchText}>
              <Icon name="search" size={15} />
              <input placeholder="Buscar" bind:value={searchText} aria-label="Buscar mensagens" onkeydown={submitSearch} data-own-escape />
              {#if searchText}
                <button class="clear" aria-label="Limpar busca" onclick={() => ((searchText = ''), (searchQuery = ''))}><Icon name="x" size={14} /></button>
              {/if}
            </label>
          {/if}
        </div>
      </header>

      {#if dmCall && !inThisCall && dmCall.members.length}
        <div class="call-banner">
          <Icon name="phone" size={16} />
          <span>Chamada em andamento</span>
          <Button size="sm" variant="primary" onclick={() => client.startDmCall(target.id)}>Entrar</Button>
        </div>
      {:else if inThisCall && dmCall?.ringing.length}
        <div class="call-banner calling">
          <span class="pulse" aria-hidden="true"></span>
          <span>Chamando {peer?.name}…</span>
          <Button size="sm" variant="danger-soft" onclick={() => client.leaveCall()}>Cancelar</Button>
        </div>
      {/if}

      <div class="scroller" bind:this={scroller} onscroll={onScroll}>
        {#if target.hasMore === false}
          <div class="start">
            {#if peer}
              <Avatar id={peer.id} name={peer.name} size={64} src={client.avatarOf(peer.id)} />
              <h2>{peer.name}</h2>
              <p>Este é o começo da conversa com @{peer.username}. Só vocês dois veem.</p>
            {:else}
              <div class="start-icon"><Icon name="hash" size={28} /></div>
              <h2>Boas-vindas a #{target.title}</h2>
              <p>Este é o começo do canal.</p>
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
            <div class="new-divider" role="separator"><span>Novas</span></div>
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
          Vendo mensagens antigas
          <span>Ir pras recentes <Icon name="chevron-down" size={14} /></span>
        </button>
      {/if}

      <Composer bind:this={composer} {target} bind:replyTo oneditlast={editLast} />
      <div class="typing" aria-live="polite">
        {#if typing.length}
          <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
          {#if typing.length === 1}<b>{target.displayName(typing[0])}</b> está digitando…
          {:else if typing.length <= 3}<b>{typing.map((id) => target.displayName(id)).join(', ')}</b> estão digitando…
          {:else}Várias pessoas estão digitando…{/if}
        {/if}
      </div>

      {#if dragging}
        <div class="drop">
          <div class="drop-card">
            <Icon name="upload" size={28} />
            <span>Solte pra enviar {peer ? `pra ${peer.name}` : `em #${target.title}`}</span>
          </div>
        </div>
      {/if}
    </section>

    {#if aside === 'members' && guild}
      <div class="aside"><MemberList {guild} /></div>
    {:else if aside === 'search' && guild}
      <div class="aside">
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
      <EmptyState icon="hash" title="Nenhum canal aberto" description="Escolha um canal na lista ao lado." />
    {/if}
  </div>
{/if}

<style>
  .pane {
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
    flex: none;
    color: var(--fg-3);
  }

  h1 {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
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
    height: 30px;
    margin-left: 6px;
    padding: 0 8px 0 10px;
    border-radius: var(--r-md);
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
    background: rgb(52 211 153 / 0.1);
    box-shadow: inset 0 0 0 1px rgb(52 211 153 / 0.3);
    color: var(--green);
    font-size: var(--text-sm);
    font-weight: 550;
  }

  .call-banner span {
    flex: 1;
  }

  .call-banner.calling {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent-line);
    color: var(--accent-fg);
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

  .start-icon {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    margin-bottom: 8px;
    border-radius: 20px;
    background:
      linear-gradient(var(--bg-raised), var(--bg-raised)) padding-box,
      linear-gradient(135deg, rgb(143 132 255 / 0.7), rgb(106 92 246 / 0.25), rgb(143 132 255 / 0.45)) border-box;
    border: 1px solid transparent;
    color: var(--fg);
    box-shadow: 0 12px 32px -12px rgb(106 92 246 / 0.45);
  }

  .start :global(.avatar) {
    margin-bottom: 8px;
  }

  .start h2 {
    font-size: var(--text-3xl);
    font-weight: 650;
    letter-spacing: -0.025em;
    line-height: 1.15;
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
    font-weight: 500;
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
    background: rgb(255 92 114 / 0.55);
  }

  .new-divider span {
    position: absolute;
    top: 50%;
    right: 0;
    padding: 1px 6px;
    border-radius: var(--r-xs);
    background: #dc3a50;
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
    background: rgb(11 11 16 / 0.72);
    backdrop-filter: blur(2px);
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
</style>
