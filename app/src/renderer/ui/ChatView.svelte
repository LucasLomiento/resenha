<script lang="ts">
  import { tick } from 'svelte'
  import type { Message } from '../../../../shared/protocol'
  import { formatDay } from '../lib/format'
  import { store } from '../lib/store.svelte'
  import Composer from './Composer.svelte'
  import { Avatar, Icon, Spinner } from './kit'
  import MessageItem from './MessageItem.svelte'

  // Canal do grupo, ou conversa privada (que não está na lista de canais).
  const dmUser = $derived(store.currentChannel ? store.dmPeer(store.currentChannel) : null)
  const channel = $derived(
    dmUser && store.currentChannel
      ? { id: store.currentChannel, name: store.users[dmUser]?.name ?? '?', kind: 'text' as const, position: 0 }
      : store.channels.find((c) => c.id === store.currentChannel),
  )
  const messages = $derived<Message[]>((channel && store.messages[channel.id]) || [])
  const typing = $derived(channel ? store.typingIn(channel.id) : [])

  let scroller = $state<HTMLDivElement>()
  let composer = $state<{ addFiles(files: File[]): void }>()
  let dragging = $state(false)

  // Mensagens agrupadas: mesmo autor em sequência (até 7 min) sem repetir o cabeçalho.
  function isGrouped(prev: Message | undefined, m: Message) {
    return !!prev && prev.authorId === m.authorId && m.createdAt - prev.createdAt < 7 * 60_000 && sameDay(prev, m)
  }

  function sameDay(a: Message, b: Message) {
    return new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString()
  }

  // --- rolagem: grudar no fim quando chega mensagem; manter posição quando carrega antigas ---
  let lastChannel: string | undefined
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
    const id = channel?.id
    const firstId = messages[0]?.id
    const count = messages.length
    tick().then(() => {
      if (!scroller) return
      if (id !== lastChannel) {
        scroller.scrollTop = scroller.scrollHeight
      } else if (firstId !== lastFirstId && count > lastCount && lastFirstId) {
        scroller.scrollTop = scroller.scrollHeight - anchor
      } else if (atBottom) {
        scroller.scrollTop = scroller.scrollHeight
      }
      lastChannel = id
      lastFirstId = firstId
      lastCount = count
    })
  })

  function onScroll() {
    if (!scroller || !channel) return
    if (scroller.scrollTop < 300 && store.hasMore[channel.id] && !store.loadingHistory[channel.id] && messages[0]) {
      store.loadHistory(channel.id, messages[0].id)
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    dragging = false
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length) composer?.addFiles(files)
  }
</script>

<section
  aria-label="Chat"
  ondragover={(e) => {
    if (e.dataTransfer?.types.includes('Files')) {
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
    {#if dmUser}
      <Avatar id={dmUser} name={channel?.name ?? '?'} size={24} status={store.online[dmUser] ? 'online' : 'offline'} cutout="var(--bg-panel)" />
      <h1>{channel?.name ?? ''}</h1>
    {:else}
      <Icon name="hash" size={20} class="header-icon" />
      <h1>{channel?.name ?? ''}</h1>
    {/if}
  </header>

  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    {#if channel && store.hasMore[channel.id] === false}
      <div class="start">
        {#if dmUser}
          <Avatar id={dmUser} name={channel.name} size={64} />
          <h2>{channel.name}</h2>
          <p>Só vocês dois veem esta conversa.</p>
        {:else}
          <div class="start-icon"><Icon name="hash" size={28} /></div>
          <h2>Bem-vindo a #{channel.name}</h2>
          <p>Este é o começo do canal.</p>
        {/if}
      </div>
    {:else if channel && store.loadingHistory[channel.id]}
      <div class="loading"><Spinner size={18} /></div>
    {/if}

    {#each messages as message, i (message.id)}
      {#if i === 0 || !sameDay(messages[i - 1], message)}
        <div class="day" role="separator"><span>{formatDay(message.createdAt)}</span></div>
      {/if}
      <MessageItem {message} grouped={isGrouped(messages[i - 1], message)} />
    {/each}
  </div>

  {#if channel}
    <Composer
      bind:this={composer}
      channelId={channel.id}
      placeholder={dmUser ? `Mensagem para ${channel.name}` : `Mensagem em #${channel.name}`}
    />
  {/if}
  <div class="typing" aria-live="polite">
    {#if typing.length}
      <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
      {#if typing.length === 1}<b>{typing[0].name}</b> está digitando…
      {:else}<b>{typing.map((u) => u.name).join(', ')}</b> estão digitando…{/if}
    {/if}
  </div>

  {#if dragging}
    <div class="drop">
      <div class="drop-card">
        <Icon name="upload" size={28} />
        <span>Solte pra enviar {dmUser ? `pra ${channel?.name}` : `em #${channel?.name}`}</span>
      </div>
    </div>
  {/if}
</section>

<style>
  section {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    height: var(--header-h);
    padding: 0 20px;
    border-bottom: 1px solid var(--line);
  }

  header :global(.header-icon) {
    color: var(--fg-3);
  }

  h1 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 0 12px;
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
      linear-gradient(135deg, rgb(111 125 255 / 0.65), rgb(145 80 255 / 0.4), rgb(255 90 122 / 0.55)) border-box;
    border: 1px solid transparent;
    color: var(--fg);
    box-shadow: 0 12px 32px -12px rgb(111 125 255 / 0.4);
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

  .typing {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 26px;
    padding: 0 22px 2px;
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
</style>
