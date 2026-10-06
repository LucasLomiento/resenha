<script lang="ts">
  import { onDestroy } from 'svelte'
  import { P, type Channel } from '../../../../../../shared/protocol'
  import type { GuildState } from '../../../lib/guild.svelte'
  import { PageHeader, Row, Section, Select, Slider, TextField } from '../../kit'
  import SaveBar from '../SaveBar.svelte'
  import { settled } from '../settle.svelte'
  import type { Unsaved } from '../unsaved.svelte'
  import { SLOWMODES, cleanName, plural } from '../util'

  let { guild, channel, unsaved }: { guild: GuildState; channel: Channel; unsaved: Unsaved } = $props()

  interface Draft {
    name: string
    topic: string
    /** Categoria ('' = sem categoria). */
    parentId: string
    slowmode: number
    userLimit: number
  }

  const KIND = { text: 'Canal de texto', voice: 'Canal de voz', category: 'Categoria' } as const
  const TOPIC_MAX = 1024

  /** Igual ao servidor: sem sobra nas pontas e no máximo uma linha em branco seguida. */
  const cleanTopic = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim()

  const parent = $derived(channel.parentId ? guild.channel(channel.parentId) : null)
  const subtitle = $derived(parent ? `${KIND[channel.kind]} em ${parent.name}` : KIND[channel.kind])

  /** Só as categorias em que a pessoa pode pôr canal (e a atual, mesmo que não possa). */
  const categories = $derived([
    { value: '', label: 'Sem categoria' },
    ...guild.channels
      .filter((c) => c.kind === 'category' && (c.id === parent?.id || guild.can(c.id, P.MANAGE_CHANNELS)))
      .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
      .map((c) => ({ value: c.id, label: c.name })),
  ])

  let draft = $state<Draft | null>(null)
  const base = $derived<Draft>({
    name: channel.name,
    topic: channel.topic,
    parentId: parent?.id ?? '',
    slowmode: channel.slowmode,
    userLimit: channel.userLimit,
  })
  const view = $derived(draft ?? base)
  const changed = $derived(
    !!draft &&
      (cleanName(draft.name) !== base.name ||
        (channel.kind !== 'category' && draft.parentId !== base.parentId) ||
        (channel.kind === 'text' && (cleanTopic(draft.topic) !== base.topic || draft.slowmode !== base.slowmode)) ||
        (channel.kind === 'voice' && draft.userLimit !== base.userLimit)),
  )
  const nameError = $derived(draft && !cleanName(draft.name) ? 'O nome não pode ficar vazio.' : null)
  let saving = $state(false)

  $effect(() => {
    unsaved.dirty = changed
  })
  onDestroy(() => (unsaved.dirty = false))

  function edit(patch: Partial<Draft>) {
    draft = { ...view, ...patch }
  }

  async function save() {
    if (!draft || nameError || saving) return
    const id = channel.id
    const patch: { name?: string; topic?: string; parentId?: string | null; slowmode?: number; userLimit?: number } = {}
    const name = cleanName(draft.name)
    if (name !== base.name) patch.name = name
    if (channel.kind !== 'category' && draft.parentId !== base.parentId) patch.parentId = draft.parentId || null
    if (channel.kind === 'text') {
      const topic = cleanTopic(draft.topic)
      if (topic !== base.topic) patch.topic = topic
      if (draft.slowmode !== base.slowmode) patch.slowmode = draft.slowmode
    }
    if (channel.kind === 'voice' && draft.userLimit !== base.userLimit) patch.userLimit = draft.userLimit
    if (Object.keys(patch).length === 0) {
      draft = null
      return
    }
    saving = true
    guild.updateChannel(id, patch)
    const ok = await settled(() => {
      const now = guild.channel(id)
      return !!now && (Object.keys(patch) as (keyof typeof patch)[]).every((key) => now[key] === patch[key])
    })
    saving = false
    if (ok) draft = null
  }
</script>

<PageHeader title="Visão geral" description={subtitle} />

<Section>
  <Row stack>
    <TextField
      label={channel.kind === 'category' ? 'Nome da categoria' : 'Nome do canal'}
      icon={channel.kind === 'text' ? 'hash' : channel.kind === 'voice' ? 'volume' : 'folder'}
      bind:value={() => view.name, (v) => edit({ name: v })}
      maxlength={100}
      spellcheck={false}
      error={nameError}
    />
  </Row>
  {#if channel.kind === 'text'}
    <Row stack>
      <label class="topic">
        <span>Tópico</span>
        <textarea
          rows="3"
          maxlength={TOPIC_MAX}
          placeholder="Do que se fala aqui"
          value={view.topic}
          oninput={(e) => edit({ topic: e.currentTarget.value })}
        ></textarea>
        <small class="tabular" aria-hidden="true">{view.topic.length}/{TOPIC_MAX}</small>
      </label>
    </Row>
  {/if}
</Section>

{#if channel.kind !== 'category'}
  <Section>
    <Row label="Categoria">
      <div class="w200">
        <Select label="Categoria" bind:value={() => view.parentId, (v) => edit({ parentId: v })} options={categories} />
      </div>
    </Row>
    {#if channel.kind === 'text'}
      <Row label="Modo lento" description="Cada pessoa espera esse tempo entre uma mensagem e outra.">
        <div class="w200">
          <Select label="Modo lento" bind:value={() => String(view.slowmode), (v) => edit({ slowmode: Number(v) })} options={SLOWMODES} />
        </div>
      </Row>
    {:else}
      <Row label="Limite de pessoas">
        <div class="limit">
          <Slider label="Limite de pessoas" min={0} max={99} step={1} bind:value={() => view.userLimit, (v) => edit({ userLimit: Number(v) })} />
          <span class="limit-value tabular">{view.userLimit === 0 ? 'Sem limite' : plural(view.userLimit, 'pessoa', 'pessoas')}</span>
        </div>
      </Row>
    {/if}
  </Section>
{/if}

{#if changed}
  <SaveBar {saving} nudge={unsaved.nudge} disabled={!!nameError} onreset={() => (draft = null)} onsave={save} />
{/if}

<style>
  .topic {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .topic span {
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .topic textarea {
    min-height: 84px;
    padding: 10px 12px 22px;
    border: 0;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--fg);
    line-height: 1.45;
    resize: vertical;
    outline: none;
    user-select: text;
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .topic textarea::placeholder {
    color: var(--fg-3);
  }

  .topic textarea:hover {
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16);
  }

  .topic textarea:focus {
    box-shadow:
      inset 0 0 0 1px var(--accent-line),
      0 0 0 3px rgb(122 108 255 / 0.18);
  }

  .topic small {
    position: absolute;
    right: 10px;
    bottom: 6px;
    color: var(--fg-3);
    font-size: var(--text-2xs);
  }

  .w200 {
    width: 200px;
  }

  .limit {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 280px;
  }

  .limit-value {
    flex: none;
    width: 84px;
    color: var(--fg-2);
    font-size: var(--text-sm);
    text-align: right;
  }
</style>
