<script lang="ts">
  import { tick } from 'svelte'
  import type { Message } from '../../../../shared/protocol'
  import { formatDay } from '../lib/format'
  import { store } from '../lib/store.svelte'
  import Avatar from './Avatar.svelte'
  import Composer from './Composer.svelte'
  import Icon from './Icon.svelte'
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

  // Mensagens agrupadas como no Discord: mesmo autor em sequência (até 7 min) sem repetir cabeçalho.
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
      <Avatar id={dmUser} name={channel?.name ?? '?'} size={24} />
      <span class="title">{channel?.name ?? ''}</span>
      <span class="online" class:on={store.online[dmUser]}></span>
    {:else}
      <Icon name="hash" size={20} />
      <span class="title">{channel?.name ?? ''}</span>
    {/if}
  </header>

  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    {#if channel && store.hasMore[channel.id] === false}
      <div class="start">
        {#if dmUser}
          <Avatar id={dmUser} name={channel.name} size={64} />
          <h2>{channel.name}</h2>
          <p>Começo da conversa privada com {channel.name}. Só vocês dois veem.</p>
        {:else}
          <div class="start-icon"><Icon name="hash" size={30} /></div>
          <h2>Bem-vindo a #{channel.name}</h2>
          <p>Este é o começo do canal.</p>
        {/if}
      </div>
    {:else if channel && store.loadingHistory[channel.id]}
      <div class="loading">Carregando…</div>
    {/if}

    {#each messages as message, i (message.id)}
      {#if i === 0 || !sameDay(messages[i - 1], message)}
        <div class="day"><span>{formatDay(message.createdAt)}</span></div>
      {/if}
      <MessageItem {message} grouped={isGrouped(messages[i - 1], message)} />
    {/each}
  </div>

  {#if channel}
    <Composer bind:this={composer} channelId={channel.id} placeholder={dmUser ? `Mensagem para @${channel.name}` : `Conversar em #${channel.name}`} />
  {/if}
  <div class="typing">
    {#if typing.length === 1}<b>{typing[0].name}</b> está digitando…
    {:else if typing.length > 1}<b>{typing.map((u) => u.name).join(', ')}</b> estão digitando…{/if}
  </div>

  {#if dragging}
    <div class="drop">Solte pra enviar {dmUser ? `pra ${channel?.name}` : `em #${channel?.name}`}</div>
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
    gap: 8px;
    height: 52px;
    padding: 0 18px;
    border-bottom: 1px solid var(--border);
    color: var(--text-faint);
    flex: none;
  }

  .title {
    color: var(--text);
    font-weight: 700;
    font-size: 15px;
  }

  .online {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-faint);
  }

  .online.on {
    background: var(--green);
  }

  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 0 8px;
  }

  .start {
    padding: 24px 18px 12px;
  }

  .start-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--bg-active);
  }

  .start h2 {
    margin: 12px 0 4px;
    font-size: 24px;
  }

  .start p,
  .loading {
    margin: 0;
    color: var(--text-dim);
  }

  .loading {
    padding: 12px 18px;
  }

  .day {
    display: flex;
    align-items: center;
    margin: 16px 18px 6px;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 600;
  }

  .day::before,
  .day::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .day span {
    padding: 0 10px;
  }

  .typing {
    height: 22px;
    padding: 0 18px 4px;
    font-size: 12px;
    color: var(--text-dim);
    flex: none;
  }

  .drop {
    position: absolute;
    inset: 12px;
    display: grid;
    place-items: center;
    border: 2px dashed var(--accent);
    border-radius: 14px;
    background: rgb(28 29 34 / 0.9);
    font-size: 18px;
    font-weight: 700;
    pointer-events: none;
  }
</style>
