<script lang="ts">
  import { P, type ImportedStructure } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { countDraft, fromDraft, plainName, preparePrint, toDraft, type Draft, type DraftChannel } from '../../lib/discord-import'
  import { plural } from '../../lib/format'
  import { ui } from '../../lib/ui.svelte'
  import { Button, Icon, IconButton, Kbd, Modal, Spinner, Switch, TextField } from '../kit'
  import { settled } from './settle.svelte'

  /**
   * Importar do Discord: a pessoa cola o print da lista de canais, o servidor lê
   * (Workers AI), e aqui ela confere, ajusta e cria. Num servidor que já existe,
   * os canais entram no fim da lista; no modo "servidor novo", o servidor é
   * criado com o nome do print e fica só com os canais importados.
   */
  const request = $derived(ui.discordImport)
  const guild = $derived(request && 'guildId' in request ? (client.guilds[request.guildId] ?? null) : null)
  const newServer = $derived(!!request && 'newServer' in request)

  // O servidor sumiu, ou a pessoa perdeu a permissão: fecha.
  $effect(() => {
    if (request && !newServer && (!guild || !guild.canGuild(P.MANAGE_CHANNELS))) close()
  })

  type Step = 'pick' | 'reading' | 'review'
  let step = $state<Step>('pick')
  let print = $state<string | null>(null)
  let error = $state<string | null>(null)
  let draft = $state<Draft>({ channels: [], categories: [] })
  let serverName = $state('')
  let keepEmoji = $state(true)
  /** O rascunho com os emojis, pra voltar se a pessoa religar. */
  let withEmoji: Draft | null = null
  let busy = $state(false)
  let dragging = $state(false)
  let fileInput = $state<HTMLInputElement>()
  let run = 0

  const counts = $derived(countDraft(draft))
  const channels = $derived(counts.text + counts.voice)
  const summary = $derived(
    [
      counts.categories ? plural(counts.categories, 'categoria', 'categorias') : null,
      counts.text ? plural(counts.text, 'canal de texto', 'canais de texto') : null,
      counts.voice ? plural(counts.voice, 'canal de voz', 'canais de voz') : null,
    ]
      .filter(Boolean)
      .join(', ')
      .replace(/, ([^,]*)$/, ' e $1'),
  )

  function close() {
    run++
    ui.discordImport = null
    if (print) URL.revokeObjectURL(print)
  }

  async function read(file: Blob) {
    if (!file.type.startsWith('image/')) {
      error = 'Isso não é uma imagem.'
      return
    }
    const mine = ++run
    error = null
    step = 'reading'
    if (print) URL.revokeObjectURL(print)
    print = URL.createObjectURL(file)
    try {
      const structure = await client.api!.importDiscord(await preparePrint(file))
      if (mine !== run) return
      draft = toDraft(structure)
      withEmoji = null
      keepEmoji = true
      serverName = structure.server?.replace(/[✨⭐🌟💫🔥]+\s*$/u, '').trim() || serverName
      step = 'review'
    } catch (err) {
      if (mine !== run) return
      error = (err as Error).message
      step = 'pick'
    }
  }

  function pickFrom(files: FileList | null | undefined) {
    const file = [...(files ?? [])].find((f) => f.type.startsWith('image/'))
    if (file) void read(file)
  }

  function onPaste(event: ClipboardEvent) {
    if (!request || step !== 'pick') return
    const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    void read(file)
  }

  function setEmoji(on: boolean) {
    keepEmoji = on
    if (!on) {
      withEmoji = structuredClone($state.snapshot(draft))
      const strip = (c: DraftChannel) => ({ ...c, name: plainName(c.name) })
      draft = { channels: draft.channels.map(strip), categories: draft.categories.map((cat) => ({ ...cat, name: plainName(cat.name), channels: cat.channels.map(strip) })) }
    } else if (withEmoji) {
      draft = withEmoji
      withEmoji = null
    }
  }

  function removeChannel(key: number) {
    draft.channels = draft.channels.filter((c) => c.key !== key)
    for (const cat of draft.categories) cat.channels = cat.channels.filter((c) => c.key !== key)
  }

  function removeCategory(key: number) {
    draft.categories = draft.categories.filter((c) => c.key !== key)
  }

  const size = (structure: ImportedStructure) => structure.channels.length + structure.categories.reduce((n, c) => n + 1 + c.channels.length, 0)

  async function create() {
    if (busy) return
    const structure = fromDraft(draft, true)
    const want = size(structure)
    if (!want) return
    busy = true
    try {
      let target = guild
      if (newServer) {
        const name = serverName.trim()
        if (name.length < 2) throw new Error('O nome do servidor precisa de pelo menos 2 letras.')
        const info = await client.createGuild(name)
        if (!info || !(await settled(() => !!client.guilds[info.id]?.loaded, 20_000))) throw new Error('O servidor foi criado, mas não deu pra abrir ele agora.')
        target = client.guilds[info.id]
      }
      if (!target) return
      const g = target
      const before = g.channels.map((c) => c.id)
      if (!g.importChannels(structure)) return
      if (!(await settled(() => g.channels.length >= before.length + want, 15_000))) return
      // Servidor novo: fica só com o que veio do Discord (somem as categorias e os canais que todo
      // servidor ganha). Só se veio canal de texto, porque o servidor não fica sem nenhum.
      const hasText = [...structure.channels, ...structure.categories.flatMap((c) => c.channels)].some((c) => c.kind === 'text')
      if (newServer && hasText) {
        for (const id of before) g.send({ t: 'channel.delete', id })
        await settled(() => before.every((id) => !g.channel(id)), 10_000)
      }
      const made = want - structure.categories.length
      client.toast(`${plural(made, 'canal criado', 'canais criados')}${structure.categories.length ? ` em ${plural(structure.categories.length, 'categoria', 'categorias')}` : ''}.`, 'info')
      const first = g.firstTextChannel
      close()
      if (first) client.openChannel(g.id, first.id)
    } catch (err) {
      client.toast((err as Error).message)
    } finally {
      busy = false
    }
  }
</script>

<svelte:window onpaste={onPaste} />

{#if request && (guild || newServer)}
  <Modal
    title={newServer ? 'Trazer servidor do Discord' : 'Importar canais do Discord'}
    description={step === 'review' ? 'Confira antes de criar. Dá pra mudar nome, tipo e tirar o que não quiser.' : undefined}
    size={step === 'review' ? 'xl' : 'md'}
    onclose={close}
    dismissible={!busy}
  >
    {#if step === 'pick'}
      <button
        type="button"
        class="drop"
        class:dragging
        onclick={() => fileInput?.click()}
        ondragover={(e) => {
          e.preventDefault()
          dragging = true
        }}
        ondragleave={() => (dragging = false)}
        ondrop={(e) => {
          e.preventDefault()
          dragging = false
          pickFrom(e.dataTransfer?.files)
        }}
      >
        <span class="drop-icon"><Icon name="image-plus" size={26} /></span>
        <strong>Cole o print aqui <Kbd keys="Ctrl + V" /></strong>
        <span>ou arraste a imagem, ou clique pra escolher</span>
      </button>
      <input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onchange={(e) => pickFrom(e.currentTarget.files)} />
      <ul class="tips">
        <li>Tire o print só da lista de canais, a coluna da esquerda do Discord.</li>
        <li>Abra as categorias fechadas antes: o que não aparece no print não entra.</li>
        <li>{newServer ? 'O servidor e os canais só são criados depois de você conferir.' : 'Os canais entram no fim da lista, depois de você conferir.'}</li>
      </ul>
      {#if error}<p class="error" role="alert"><Icon name="circle-alert" size={14} />{error}</p>{/if}
    {:else if step === 'reading'}
      <div class="reading" role="status">
        <div class="scan">
          {#if print}<img src={print} alt="" />{/if}
          <span class="beam"></span>
        </div>
        <p><Spinner size={14} /> Lendo os canais do print… leva uns 10 segundos.</p>
      </div>
    {:else}
      <div class="review">
        {#if print}<img class="print" src={print} alt="O print" />{/if}
        <div class="draft">
          <div class="draft-head">
            <span class="summary">{summary || 'Nada pra criar'}</span>
            <label class="emoji">Manter os emojis <Switch size="sm" checked={keepEmoji} onchange={(e) => setEmoji(e.currentTarget.checked)} /></label>
          </div>
          {#if newServer}
            <TextField label="Nome do servidor" bind:value={serverName} maxlength={64} spellcheck={false} />
          {/if}
          <div class="tree">
            {#snippet row(channel: DraftChannel)}
              <div class="row">
                <IconButton
                  icon={channel.kind === 'text' ? 'hash' : 'volume'}
                  label={channel.kind === 'text' ? 'Texto (clique pra trocar pra voz)' : 'Voz (clique pra trocar pra texto)'}
                  size="sm"
                  onclick={() => (channel.kind = channel.kind === 'text' ? 'voice' : 'text')}
                />
                <input class="name" bind:value={channel.name} maxlength={100} spellcheck="false" aria-label="Nome do canal" />
                <IconButton icon="x" label="Não criar este canal" size="sm" onclick={() => removeChannel(channel.key)} />
              </div>
            {/snippet}
            {#each draft.channels as channel (channel.key)}
              {@render row(channel)}
            {/each}
            {#each draft.categories as category (category.key)}
              <div class="category">
                <Icon name="chevron-down" size={14} />
                <input class="name cat" bind:value={category.name} maxlength={100} spellcheck="false" aria-label="Nome da categoria" />
                <IconButton icon="x" label="Não criar esta categoria (nem os canais dela)" size="sm" onclick={() => removeCategory(category.key)} />
              </div>
              {#each category.channels as channel (channel.key)}
                {@render row(channel)}
              {/each}
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#snippet footer()}
      {#if step === 'review'}
        <Button variant="ghost" icon="restart" onclick={() => (step = 'pick')} disabled={busy}>Outro print</Button>
        <span class="grow"></span>
        <Button variant="primary" onclick={create} loading={busy} disabled={!channels && !counts.categories}>
          {newServer ? 'Criar servidor' : `Criar ${plural(channels, 'canal', 'canais')}`}
        </Button>
      {:else}
        <Button variant="ghost" onclick={close}>Cancelar</Button>
      {/if}
    {/snippet}
  </Modal>
{/if}

<style>
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 34px 20px;
    border-radius: var(--r-xl);
    background: rgb(255 255 255 / 0.025);
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
    color: var(--fg-3);
    font-size: var(--text-sm);
    outline-offset: 2px;
    transition:
      background-color var(--t-fast) var(--ease),
      box-shadow var(--t-fast) var(--ease);
  }

  .drop:hover,
  .drop.dragging {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent-line);
  }

  .drop strong {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }

  .drop-icon {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    margin-bottom: 6px;
    border-radius: var(--r-lg);
    background: var(--bg-overlay);
    color: var(--accent-fg);
  }

  .tips {
    margin: var(--s-4) 0 0;
    padding-left: 18px;
    color: var(--fg-3);
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: var(--s-3);
    color: var(--red);
    font-size: var(--text-sm);
  }

  .reading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-2) 0;
  }

  .reading p {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  /* O print com uma luz passando: "lendo". */
  .scan {
    position: relative;
    overflow: hidden;
    max-height: 300px;
    border-radius: var(--r-lg);
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .scan img {
    display: block;
    max-width: 100%;
    max-height: 300px;
    opacity: 0.7;
  }

  .beam {
    position: absolute;
    inset: 0 0 auto;
    height: 40px;
    background: linear-gradient(180deg, transparent, rgb(122 108 255 / 0.45), transparent);
    animation: beam 1.6s var(--ease-in-out) infinite alternate;
  }

  @keyframes beam {
    to {
      translate: 0 260px;
    }
  }

  .review {
    display: grid;
    grid-template-columns: minmax(0, 200px) minmax(0, 1fr);
    gap: var(--s-5);
    align-items: start;
  }

  .print {
    position: sticky;
    top: 0;
    width: 100%;
    max-height: 60vh;
    object-fit: contain;
    object-position: top;
    border-radius: var(--r-lg);
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .draft {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    min-width: 0;
  }

  .draft-head {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }

  .summary {
    flex: 1;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .emoji {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--fg-2);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .tree {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 52vh;
    overflow-y: auto;
    padding: 6px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .row,
  .category {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
  }

  .row {
    padding-left: 14px;
  }

  .category {
    margin-top: 10px;
    padding-left: 4px;
    color: var(--fg-3);
  }

  .category:first-child {
    margin-top: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--r-sm);
    outline: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-md);
  }

  .name:hover {
    background: var(--hover);
  }

  .name:focus {
    background: var(--bg-raised);
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }

  .name.cat {
    color: var(--fg-2);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .grow {
    flex: 1;
  }
</style>
