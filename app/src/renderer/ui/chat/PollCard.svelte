<script lang="ts">
  import type { Message } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { fmt, m } from '../../lib/i18n.svelte'
  import { confirmAction, openProfile } from '../../lib/ui.svelte'
  import { Icon, tooltip } from '../kit'
  import Markdown from './Markdown.svelte'
  import type { ChatTarget } from './target.svelte'

  let { message, target }: { message: Message; target: ChatTarget } = $props()

  const t = $derived(m.chat.poll)
  const poll = $derived(message.poll!)
  const meId = $derived(client.me?.id ?? '')

  /** Encerrada por alguém, ou o prazo passou (o relógio do app anda de segundo em segundo). */
  const closed = $derived(poll.closed || (poll.closesAt !== null && poll.closesAt <= client.now))
  /** Cada pessoa conta uma vez, mesmo marcando várias opções. */
  const voters = $derived(new Set(poll.options.flatMap((o) => o.userIds)).size)
  const mine = $derived(poll.options.flatMap((o, i) => (o.userIds.includes(meId) ? [i] : [])))
  const top = $derived(Math.max(0, ...poll.options.map((o) => o.userIds.length)))
  const canClose = $derived(!closed && (message.authorId === meId || target.canManage))

  const percent = (votes: number) => (voters === 0 ? 0 : Math.round((votes / voters) * 100))

  /**
   * O que eu pedi por último e o servidor ainda não confirmou. Dois cliques rápidos numa enquete
   * de várias respostas partiam os dois do voto confirmado, e o segundo apagava o primeiro.
   */
  let asked = $state<number[] | null>(null)
  let askedTimer: ReturnType<typeof setTimeout> | undefined
  const marked = $derived(asked ?? mine)

  // O servidor confirmou exatamente o que eu pedi: volta a valer o dele. (Uma confirmação
  // intermediária, com outro clique ainda a caminho, não desfaz o que está pedido.)
  $effect(() => {
    if (asked && [...asked].sort((a, b) => a - b).join() === mine.join()) asked = null
  })
  $effect(() => () => clearTimeout(askedTimer))

  function toggle(index: number) {
    if (closed) return
    const on = marked.includes(index)
    const next = poll.multiple ? (on ? marked.filter((i) => i !== index) : [...marked, index]) : on ? [] : [index]
    asked = next
    // Sem resposta (voto recusado, conexão fora): volta a mostrar o que o servidor tem.
    clearTimeout(askedTimer)
    askedTimer = setTimeout(() => (asked = null), 4000)
    target.vote(message.id, next)
  }

  /** "em 3 horas", "em 2 dias": sempre arredondando pra cima, pra não dizer "em 0 minutos". */
  const closesText = $derived.by(() => {
    if (poll.closesAt === null) return null
    const left = poll.closesAt - client.now
    if (left <= 0) return null
    const minutes = Math.ceil(left / 60_000)
    if (minutes <= 1) return t.closingSoon
    const when =
      minutes < 60
        ? fmt.relative(minutes, 'minute', { numeric: 'always' })
        : minutes < 48 * 60
          ? fmt.relative(Math.round(minutes / 60), 'hour', { numeric: 'always' })
          : fmt.relative(Math.round(minutes / 1440), 'day', { numeric: 'always' })
    return t.closes(when)
  })

  function names(userIds: string[]): string | null {
    if (userIds.length === 0) return null
    return m.chat.message.reactors(
      userIds
        .slice(0, 8)
        .map((id) => target.displayName(id))
        .join(', '),
      Math.max(0, userIds.length - 8),
    )
  }

  function close() {
    confirmAction({ title: t.closeTitle, description: t.closeDescription, confirm: t.closeConfirm, onconfirm: () => target.closePoll(message.id) })
  }
</script>

<section class="poll" class:closed aria-label={t.label}>
  <header>
    <span class="kind"><Icon name="poll" size={14} />{t.label}</span>
    <div class="question">
      <Markdown content={message.content} names={{ ...target.names, openUser: (id, anchor) => openProfile(id, target.guild?.id ?? null, anchor) }} />
    </div>
    <span class="hint">{closed ? t.closed : poll.multiple ? t.pickMany : t.pickOne}</span>
  </header>

  <div class="options" role="group" aria-label={t.options}>
    {#each poll.options as option, i (i)}
      {@const votes = option.userIds.length}
      {@const share = percent(votes)}
      {@const voted = marked.includes(i)}
      {@const winner = closed && votes > 0 && votes === top}
      <button
        class="option"
        class:voted
        class:winner
        role={poll.multiple ? 'checkbox' : 'radio'}
        aria-checked={voted}
        aria-label={t.optionLabel(option.text, votes, share)}
        disabled={closed}
        onclick={() => toggle(i)}
        use:tooltip={names(option.userIds)}
      >
        <span class="fill" style:width="{share}%"></span>
        <span class="mark" class:square={poll.multiple} aria-hidden="true">
          {#if voted}<Icon name="check" size={12} />{/if}
        </span>
        <span class="text">{option.text}</span>
        <span class="count tabular">{votes > 0 ? `${votes} · ${share}%` : `${share}%`}</span>
      </button>
    {/each}
  </div>

  <footer>
    <span class="tabular">{t.votes(voters)}</span>
    {#if !closed && closesText}<span class="dot" aria-hidden="true">·</span><span>{closesText}</span>{/if}
    {#if canClose}<button class="close" onclick={close}>{t.close}</button>{/if}
  </footer>
</section>

<style>
  .poll {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(100%, 460px);
    margin: 4px 0 2px;
    padding: 14px;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      inset 0 0 0 1px var(--line),
      var(--highlight);
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .kind {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--accent-fg);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .question :global(.md) {
    color: var(--fg);
    font-family: var(--font-display);
    font-size: 16.5px;
    font-weight: 620;
    line-height: 1.3;
  }

  .hint {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .option {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 8px 12px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
    overflow: hidden;
    text-align: left;
    transition:
      box-shadow var(--t-fast) var(--ease),
      background-color var(--t-fast) var(--ease);
  }

  .option:not(:disabled):hover {
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .option.voted {
    box-shadow: inset 0 0 0 1.5px var(--accent-line);
  }

  /* A barra de cada opção cresce por trás do texto. */
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--selected);
    transition: width var(--t-slow) var(--ease);
  }

  .option.voted .fill {
    background: var(--accent-soft);
  }

  .option.winner .fill {
    background: var(--green-soft);
  }

  .mark,
  .text,
  .count {
    position: relative;
  }

  .mark {
    display: grid;
    place-items: center;
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: var(--r-full);
    box-shadow: inset 0 0 0 1.5px var(--fg-4);
    color: var(--fg-on-accent);
  }

  .mark.square {
    border-radius: var(--r-xs);
  }

  .option.voted .mark {
    background: var(--accent);
    box-shadow: none;
  }

  .text {
    flex: 1;
    min-width: 0;
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .count {
    flex: none;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .option.winner .count {
    color: var(--green);
    font-weight: 600;
  }

  .poll.closed .option {
    cursor: default;
  }

  .poll.closed .mark {
    opacity: 0.7;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .close {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: var(--r-full);
    color: var(--fg-2);
    font-size: var(--text-xs);
    font-weight: 550;
    transition: background-color var(--t-fast) var(--ease);
  }

  .close:hover {
    background: var(--hover);
    color: var(--fg);
  }

  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
