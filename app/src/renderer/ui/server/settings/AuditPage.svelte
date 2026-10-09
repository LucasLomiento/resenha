<script lang="ts">
  import { onMount } from 'svelte'
  import type { AuditAction, AuditEntry } from '../../../../../../shared/protocol'
  import { client } from '../../../lib/client.svelte'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { around, fmt, m } from '../../../lib/i18n.svelte'
  import { Button, EmptyState, Icon, PageHeader, Section, Select, Spinner, tooltip, type IconName } from '../../kit'
  import { durationText, relative, whenText } from '../util'

  let { guild }: { guild: GuildState } = $props()

  const t = $derived(m.server.audit)

  type Tone = 'accent' | 'red' | 'green' | 'yellow' | 'neutral'
  interface Line {
    icon: IconName
    tone: Tone
    /** A ação, com {target} onde entra o alvo (o catálogo escolhe a posição). */
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

  const KINDS = $derived(
    (['all', 'guild', 'channel', 'role', 'member', 'mod', 'message', 'invite'] as const).map((value) => ({ value, label: t.kinds[value] })),
  )

  const MOD = new Set<AuditAction>(['member.kick', 'member.ban', 'member.unban', 'member.timeout'])
  const kindOf = (action: AuditAction) => (MOD.has(action) ? 'mod' : action.split('.')[0])

  const actors = $derived(
    [...new Set(entries.map((e) => e.actorId))]
      .map((id) => ({ value: id, label: guild.displayName(id) }))
      .sort((a, b) => fmt.compare(a.label, b.label)),
  )

  const shown = $derived(entries.filter((e) => (kind === 'all' || kindOf(e.action) === kind) && (actor === 'all' || e.actorId === actor)))

  // ---------- Texto de cada linha ----------

  /** "Fulano: resto" -> ["Fulano", "resto"] (é assim que o servidor escreve o detalhe). */
  function split(text: string): [string, string] {
    const i = text.indexOf(': ')
    return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i + 2)]
  }

  const cap = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : '')

  /**
   * O que mudou ("nome: a → b, cor"), que o servidor escreve em português, no idioma em uso.
   * Pedaço que não está no catálogo (nome com vírgula, versão nova do servidor) fica como veio.
   */
  function changes(text: string): string {
    const c = t.changes
    const exact: Record<string, string> = c.exact
    return text
      .split(', ')
      .map((part) => {
        if (Object.hasOwn(exact, part)) return exact[part]
        let found = /^nome: (.*) → (.*)$/.exec(part)
        if (found) return c.rename(found[1], found[2])
        if ((found = /^nome: (.*)$/.exec(part))) return c.name(found[1])
        if ((found = /^limite: (\d+)$/.exec(part))) return c.limit(found[1])
        if ((found = /^modo lento: (\d+) s$/.exec(part))) return c.slowmode(found[1])
        if ((found = /^moveu pra (.*)$/.exec(part))) return c.movedTo(found[1])
        return part
      })
      .join(', ')
  }

  const nameOf = (id: string | null) => (id ? guild.displayName(id) : null)
  /** Nome de hoje do cargo (o detalhe guarda o de quando aconteceu). */
  const roleName = (id: string | null) => guild.roles.find((r) => r.id === id)?.name ?? null

  function describe(entry: AuditEntry): Line {
    const { action, detail, targetId } = entry
    const v = t.verbs
    switch (action) {
      case 'guild.update':
        if (targetId) return { icon: 'crown', tone: 'yellow', verb: v.transferred, target: nameOf(targetId), detail: '' }
        return { icon: 'settings', tone: 'accent', verb: v.editedServer, target: null, detail: cap(changes(detail)) }
      case 'channel.create': {
        const imported = /^Importou de um print do Discord: (\d+) categorias e (\d+) canais$/.exec(detail)
        if (imported) return { icon: 'image-plus', tone: 'green', verb: v.imported, target: null, detail: cap(t.imported(Number(imported[1]), Number(imported[2]))) }
        const match = /^(Categoria|Voz|Texto): (.*)$/.exec(detail)
        const name = guild.channel(targetId)?.name ?? match?.[2] ?? detail
        if (match?.[1] === 'Categoria') return { icon: 'folder', tone: 'green', verb: v.createdCategory, target: name, detail: '' }
        if (match?.[1] === 'Voz') return { icon: 'volume', tone: 'green', verb: v.createdVoice, target: name, detail: '' }
        return { icon: 'hash', tone: 'green', verb: v.createdChannel, target: `#${name}`, detail: '' }
      }
      case 'channel.update': {
        const [where, what] = split(detail)
        const channel = guild.channel(targetId)
        const target = channel ? (channel.kind === 'text' ? `#${channel.name}` : channel.name) : where
        const icon: IconName = channel?.kind === 'voice' ? 'volume' : channel?.kind === 'category' ? 'folder' : 'hash'
        return { icon, tone: 'accent', verb: channel?.kind === 'category' ? v.editedCategory : v.editedChannel, target, detail: cap(changes(what)) }
      }
      case 'channel.delete': {
        const match = /^(.*) \((\d+) mensagens\)$/.exec(detail)
        const count = Number(match?.[2] ?? 0)
        return {
          icon: 'trash',
          tone: 'red',
          verb: v.deletedChannel,
          target: match?.[1] ?? detail,
          detail: count ? t.hadMessages(count) : '',
        }
      }
      case 'role.create':
        return { icon: 'shield', tone: 'green', verb: v.createdRole, target: roleName(targetId) ?? detail, detail: '' }
      case 'role.update': {
        if (!targetId) return { icon: 'shield', tone: 'accent', verb: v.reorderedRoles, target: null, detail: '' }
        const [name, what] = split(detail)
        return { icon: 'shield', tone: 'accent', verb: v.editedRole, target: roleName(targetId) ?? name, detail: cap(changes(what)) }
      }
      case 'role.delete':
        return { icon: 'shield', tone: 'red', verb: v.deletedRole, target: detail, detail: '' }
      case 'member.roles': {
        const [name, what] = split(detail)
        const items = what.split(', ')
        const added = items.filter((i) => i.startsWith('+')).map((i) => i.slice(1))
        const removed = items.filter((i) => i.startsWith('−')).map((i) => i.slice(1))
        const text = [added.length ? t.gave(fmt.list(added)) : '', removed.length ? t.took(fmt.list(removed)) : ''].filter(Boolean).join(' · ')
        return { icon: 'user', tone: 'accent', verb: v.changedRoles, target: name, detail: text }
      }
      case 'member.nick': {
        const [name, nick] = split(detail)
        return { icon: 'pencil', tone: 'neutral', verb: v.changedNick, target: name, detail: nick === '(sem apelido)' ? t.noNick : t.nickNow(nick) }
      }
      case 'member.kick':
      case 'member.ban': {
        const [name, reason] = split(detail)
        const kick = action === 'member.kick'
        return { icon: kick ? 'door-open' : 'hammer', tone: 'red', verb: kick ? v.kicked : v.banned, target: name, detail: reason ? t.reason(reason) : '' }
      }
      case 'member.unban':
        return { icon: 'shield-check', tone: 'green', verb: v.unbanned, target: detail, detail: '' }
      case 'member.timeout': {
        const [name, rest] = split(detail)
        const [what, reason] = rest.split(' — ')
        const why = reason ? t.reason(reason) : ''
        if (what === 'tirou o castigo') return { icon: 'clock', tone: 'green', verb: v.removedTimeout, target: name, detail: why }
        const minutes = parseInt(what, 10)
        const length = Number.isFinite(minutes) ? t.duration(durationText(minutes)) : what
        return { icon: 'clock', tone: 'yellow', verb: v.timedOut, target: name, detail: [length, why].filter(Boolean).join(' · ') }
      }
      case 'member.voice': {
        const [name, what] = split(detail)
        return { icon: 'mic-off', tone: 'yellow', verb: v.voice, target: name, detail: cap(changes(what)) }
      }
      case 'message.delete':
        return { icon: 'trash', tone: 'neutral', verb: v.deletedMessage, target: nameOf(targetId), detail: t.inChannel(detail) }
      case 'message.pin': {
        const pinned = detail.startsWith('Fixou')
        const where = detail.replace(/^(Fixou|Desafixou) em /, '')
        return { icon: pinned ? 'pin' : 'pin-off', tone: 'neutral', verb: pinned ? v.pinned : v.unpinned, target: nameOf(targetId), detail: t.inChannel(where) }
      }
      case 'invite.create':
        return { icon: 'link', tone: 'green', verb: v.createdInvite, target: detail, mono: true, detail: '' }
      case 'invite.delete':
        return { icon: 'unlink', tone: 'red', verb: v.deletedInvite, target: detail, mono: true, detail: '' }
      default:
        return { icon: 'scroll', tone: 'neutral', verb: v.other, target: null, detail: cap(detail) }
    }
  }

  /** O texto da ação em volta do alvo; sem alvo, só a ação. */
  const verbAround = (line: Line): [string, string] =>
    line.target ? around(line.verb, '{target}') : [line.verb.replace('{target}', '').trim(), '']
</script>

<PageHeader title={t.title} description={t.description} />

<div class="toolbar">
  <div class="w240"><Select label={t.filterAction} bind:value={kind} options={KINDS} /></div>
  <div class="w200">
    <Select label={t.filterPerson} bind:value={actor} options={[{ value: 'all', label: t.anyone }, ...actors]} />
  </div>
</div>

{#if failed && entries.length === 0}
  <Section>
    <div class="state">
      <EmptyState icon="scroll" title={t.failedTitle} description={m.server.shared.checkConnection}>
        {#snippet actions()}<Button onclick={() => load()}>{m.common.retry}</Button>{/snippet}
      </EmptyState>
    </div>
  </Section>
{:else if loading && entries.length === 0}
  <Section><div class="state"><Spinner size={20} /></div></Section>
{:else if shown.length === 0}
  <Section>
    <div class="state">
      {#if entries.length === 0}
        <EmptyState icon="scroll" title={t.emptyTitle} description={t.emptyDescription} />
      {:else}
        <EmptyState icon="search" title={t.noMatchTitle} description={hasMore ? t.noMatchMore : t.noMatchOther} />
      {/if}
    </div>
  </Section>
{:else}
  <Section>
    {#each shown as entry (entry.id)}
      {@const line = describe(entry)}
      {@const [before, after] = verbAround(line)}
      <div class="audit-row">
        <span class="audit-icon tone-{line.tone}"><Icon name={line.icon} size={16} /></span>
        <span class="audit-text">
          <span class="audit-main">
            <b>{guild.displayName(entry.actorId)}</b>
            {before}{#if line.target}<b class:mono={line.mono}>{line.target}</b>{/if}{after}
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
    <Button variant="ghost" loading={loading} onclick={() => load(true)}>{failed ? m.common.retry : t.loadMore}</Button>
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
