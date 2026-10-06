<script lang="ts">
  import { onMount } from 'svelte'
  import type { AuditAction, AuditEntry } from '../../../../../../shared/protocol'
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { Button, EmptyState, Icon, PageHeader, Section, Select, Spinner, tooltip, type IconName } from '../../kit'
  import { durationText, plural, relative, whenText } from '../util'

  let { guild }: { guild: GuildState } = $props()

  type Tone = 'accent' | 'red' | 'green' | 'yellow' | 'neutral'
  interface Line {
    icon: IconName
    tone: Tone
    verb: string
    target: string | null
    /** Código de convite: em fonte mono. */
    mono?: boolean
    detail: string
  }

  let entries = $state<AuditEntry[]>([])
  let hasMore = $state(false)
  let loading = $state(true)
  let failed = $state(false)
  let kind = $state('all')
  let actor = $state('all')

  async function load(more = false) {
    loading = true
    failed = false
    try {
      const page = await guild.audit(more ? entries[entries.length - 1]?.id : undefined)
      const known = new Set(entries.map((e) => e.id))
      entries = more ? [...entries, ...page.entries.filter((e) => !known.has(e.id))] : page.entries
      hasMore = page.hasMore
    } catch {
      failed = true
    } finally {
      loading = false
    }
  }

  onMount(() => load())

  // ---------- Filtros (no que já foi carregado) ----------

  const KINDS = [
    { value: 'all', label: 'Todas as ações' },
    { value: 'guild', label: 'Servidor' },
    { value: 'channel', label: 'Canais' },
    { value: 'role', label: 'Cargos' },
    { value: 'member', label: 'Cargos e apelidos de membros' },
    { value: 'mod', label: 'Castigos, expulsões e banimentos' },
    { value: 'message', label: 'Mensagens' },
    { value: 'invite', label: 'Convites' },
  ]

  const MOD = new Set<AuditAction>(['member.kick', 'member.ban', 'member.unban', 'member.timeout'])
  const kindOf = (action: AuditAction) => (MOD.has(action) ? 'mod' : action.split('.')[0])

  const actors = $derived(
    [...new Set(entries.map((e) => e.actorId))]
      .map((id) => ({ value: id, label: guild.displayName(id) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
  )

  const shown = $derived(entries.filter((e) => (kind === 'all' || kindOf(e.action) === kind) && (actor === 'all' || e.actorId === actor)))

  // ---------- Texto de cada linha ----------

  /** "Fulano: resto" -> ["Fulano", "resto"] (é assim que o servidor escreve o detalhe). */
  function split(text: string): [string, string] {
    const i = text.indexOf(': ')
    return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i + 2)]
  }

  const cap = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : '')

  /** "A", "A e B", "A, B e C". */
  function list(items: string[]): string {
    return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
  }

  const nameOf = (id: string | null) => (id ? guild.displayName(id) : null)

  function describe(entry: AuditEntry): Line {
    const { action, detail, targetId } = entry
    switch (action) {
      case 'guild.update':
        if (targetId) return { icon: 'crown', tone: 'yellow', verb: 'transferiu o servidor pra', target: nameOf(targetId), detail: '' }
        return { icon: 'settings', tone: 'accent', verb: 'editou o servidor', target: null, detail: cap(detail) }
      case 'channel.create': {
        const match = /^(Categoria|Voz|Texto): (.*)$/.exec(detail)
        const name = match?.[2] ?? detail
        if (match?.[1] === 'Categoria') return { icon: 'folder', tone: 'green', verb: 'criou a categoria', target: name, detail: '' }
        if (match?.[1] === 'Voz') return { icon: 'volume', tone: 'green', verb: 'criou o canal de voz', target: name, detail: '' }
        return { icon: 'hash', tone: 'green', verb: 'criou o canal', target: `#${name}`, detail: '' }
      }
      case 'channel.update': {
        const [where, what] = split(detail)
        const channel = guild.channel(targetId)
        const target = channel ? (channel.kind === 'text' ? `#${channel.name}` : channel.name) : where
        const icon: IconName = channel?.kind === 'voice' ? 'volume' : channel?.kind === 'category' ? 'folder' : 'hash'
        return { icon, tone: 'accent', verb: channel?.kind === 'category' ? 'editou a categoria' : 'editou o canal', target, detail: cap(what) }
      }
      case 'channel.delete': {
        const match = /^(.*) \((\d+) mensagens\)$/.exec(detail)
        const count = Number(match?.[2] ?? 0)
        return {
          icon: 'trash',
          tone: 'red',
          verb: 'apagou o canal',
          target: match?.[1] ?? detail,
          detail: count ? `Tinha ${plural(count, 'mensagem', 'mensagens')}` : '',
        }
      }
      case 'role.create':
        return { icon: 'shield', tone: 'green', verb: 'criou o cargo', target: detail, detail: '' }
      case 'role.update': {
        if (!targetId) return { icon: 'shield', tone: 'accent', verb: 'reordenou os cargos', target: null, detail: '' }
        const [name, what] = split(detail)
        return { icon: 'shield', tone: 'accent', verb: 'editou o cargo', target: name, detail: cap(what) }
      }
      case 'role.delete':
        return { icon: 'shield', tone: 'red', verb: 'apagou o cargo', target: detail, detail: '' }
      case 'member.roles': {
        const [name, what] = split(detail)
        const items = what.split(', ')
        const added = items.filter((i) => i.startsWith('+')).map((i) => i.slice(1))
        const removed = items.filter((i) => i.startsWith('−')).map((i) => i.slice(1))
        const text = [added.length ? `Deu ${list(added)}` : '', removed.length ? `Tirou ${list(removed)}` : ''].filter(Boolean).join(' · ')
        return { icon: 'user', tone: 'accent', verb: 'mudou os cargos de', target: name, detail: text }
      }
      case 'member.nick': {
        const [name, nick] = split(detail)
        return { icon: 'pencil', tone: 'neutral', verb: 'mudou o apelido de', target: name, detail: nick === '(sem apelido)' ? 'Tirou o apelido' : `Agora é ${nick}` }
      }
      case 'member.kick':
      case 'member.ban': {
        const [name, reason] = split(detail)
        const kick = action === 'member.kick'
        return { icon: kick ? 'door-open' : 'hammer', tone: 'red', verb: kick ? 'expulsou' : 'baniu', target: name, detail: reason ? `Motivo: ${reason}` : '' }
      }
      case 'member.unban':
        return { icon: 'shield-check', tone: 'green', verb: 'desbaniu', target: detail, detail: '' }
      case 'member.timeout': {
        const [name, rest] = split(detail)
        const [what, reason] = rest.split(' — ')
        const why = reason ? `Motivo: ${reason}` : ''
        if (what === 'tirou o castigo') return { icon: 'clock', tone: 'green', verb: 'tirou o castigo de', target: name, detail: why }
        const minutes = parseInt(what, 10)
        const length = Number.isFinite(minutes) ? `Por ${durationText(minutes)}` : what
        return { icon: 'clock', tone: 'yellow', verb: 'castigou', target: name, detail: [length, why].filter(Boolean).join(' · ') }
      }
      case 'member.voice': {
        const [name, what] = split(detail)
        return { icon: 'mic-off', tone: 'yellow', verb: 'mexeu na call de', target: name, detail: cap(what) }
      }
      case 'message.delete':
        return { icon: 'trash', tone: 'neutral', verb: 'apagou uma mensagem de', target: nameOf(targetId), detail: `Em ${detail}` }
      case 'message.pin': {
        const pinned = detail.startsWith('Fixou')
        const where = detail.replace(/^(Fixou|Desafixou) em /, '')
        return { icon: pinned ? 'pin' : 'pin-off', tone: 'neutral', verb: pinned ? 'fixou uma mensagem de' : 'desafixou uma mensagem de', target: nameOf(targetId), detail: `Em ${where}` }
      }
      case 'invite.create':
        return { icon: 'link', tone: 'green', verb: 'criou o convite', target: detail, mono: true, detail: '' }
      case 'invite.delete':
        return { icon: 'unlink', tone: 'red', verb: 'apagou o convite', target: detail, mono: true, detail: '' }
      default:
        return { icon: 'scroll', tone: 'neutral', verb: 'fez uma mudança', target: null, detail: cap(detail) }
    }
  }
</script>

<PageHeader title="Registro de auditoria" description="Tudo o que a moderação fez, do mais novo pro mais antigo." />

<div class="toolbar">
  <div class="w240"><Select label="Filtrar por ação" bind:value={kind} options={KINDS} /></div>
  <div class="w200">
    <Select label="Filtrar por pessoa" bind:value={actor} options={[{ value: 'all', label: 'Qualquer pessoa' }, ...actors]} />
  </div>
</div>

{#if failed && entries.length === 0}
  <Section>
    <div class="state">
      <EmptyState icon="scroll" title="Não deu pra carregar o registro" description="Confira a conexão e tente de novo.">
        {#snippet actions()}<Button onclick={() => load()}>Tentar de novo</Button>{/snippet}
      </EmptyState>
    </div>
  </Section>
{:else if loading && entries.length === 0}
  <Section><div class="state"><Spinner size={20} /></div></Section>
{:else if shown.length === 0}
  <Section>
    <div class="state">
      {#if entries.length === 0}
        <EmptyState icon="scroll" title="Nada por aqui ainda" description="As mudanças de canais, cargos e membros aparecem aqui." />
      {:else}
        <EmptyState icon="search" title="Nada com esse filtro" description={hasMore ? 'Carregue mais pra procurar nas mais antigas.' : 'Tente outra ação ou outra pessoa.'} />
      {/if}
    </div>
  </Section>
{:else}
  <Section>
    {#each shown as entry (entry.id)}
      {@const line = describe(entry)}
      <div class="audit-row">
        <span class="audit-icon tone-{line.tone}"><Icon name={line.icon} size={16} /></span>
        <span class="audit-text">
          <span class="audit-main">
            <b>{guild.displayName(entry.actorId)}</b>
            {line.verb}
            {#if line.target}<b class:mono={line.mono}>{line.target}</b>{/if}
          </span>
          {#if line.detail}<span class="audit-detail">{line.detail}</span>{/if}
        </span>
        <span class="audit-time" use:tooltip={whenText(entry.createdAt, client.now)}>{relative(entry.createdAt, client.now)}</span>
      </div>
    {/each}
  </Section>
{/if}

{#if hasMore || (failed && entries.length > 0)}
  <div class="more">
    <Button variant="ghost" loading={loading} onclick={() => load(true)}>{failed ? 'Tentar de novo' : 'Carregar mais'}</Button>
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    gap: var(--s-2);
    margin-bottom: var(--s-3);
  }

  .w240 {
    width: 240px;
  }

  .w200 {
    width: 200px;
  }

  .audit-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 56px;
    padding: 10px 16px;
  }

  .audit-row + .audit-row {
    border-top: 1px solid var(--line);
  }

  .audit-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }

  .tone-accent {
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  .tone-red {
    background: var(--red-soft);
    color: var(--red);
  }

  .tone-green {
    background: var(--green-soft);
    color: var(--green);
  }

  .tone-yellow {
    background: var(--yellow-soft);
    color: var(--yellow);
  }

  .tone-neutral {
    background: rgb(255 255 255 / 0.07);
    color: var(--fg-2);
  }

  .audit-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    color: var(--fg-2);
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  .audit-main {
    overflow-wrap: anywhere;
  }

  .audit-text b {
    color: var(--fg);
    font-weight: 600;
  }

  .audit-text b.mono {
    font-family: var(--mono);
    font-weight: 500;
  }

  .audit-detail {
    color: var(--fg-3);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .audit-time {
    flex: none;
    color: var(--fg-3);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .state {
    display: grid;
    place-items: center;
    min-height: 180px;
    padding: var(--s-6);
    color: var(--fg-3);
  }

  .more {
    display: flex;
    justify-content: center;
    margin-top: var(--s-3);
  }
</style>
