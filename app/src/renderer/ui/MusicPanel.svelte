<script lang="ts">
  import type { SpotifyStatus } from '../../preload/api'
  import { client } from '../lib/client.svelte'
  import { m } from '../lib/i18n.svelte'
  import {
    cleanLists,
    cleanSearch,
    progressOf,
    type MusicList,
    type MusicOp,
    type MusicReply,
    type MusicSearch,
    type MusicTrack,
  } from '../lib/music.svelte'
  import { settings } from '../lib/settings.svelte'
  import { ui } from '../lib/ui.svelte'
  import { clock } from '../lib/voice-note'
  import { Button, Icon, IconButton, Modal, Slider, Spinner, Tabs, TextField, tooltip } from './kit'

  const call = client.call
  const t = $derived(m.music)
  const bot = call.bot

  // ---------- De quem é o bot aberto ----------

  const bots = $derived(call.musicBots)
  const hostConnId = $derived.by(() => {
    const wanted = ui.music?.connId
    if (wanted && bots[wanted]) return wanted
    return Object.keys(bots)[0] ?? null
  })
  const share = $derived(hostConnId ? (bots[hostConnId] ?? null) : null)
  const mine = $derived(!!hostConnId && hostConnId === client.callConnId)
  const nameOf = (connId: string) => {
    const userId = client.callMembers.find((x) => x.connId === connId)?.userId
    return userId ? (client.user(userId, call.guildId)?.name ?? m.app.someone) : m.app.someone
  }
  const hostName = $derived(hostConnId ? nameOf(hostConnId) : '')
  const player = $derived(share?.player ?? null)
  const track = $derived(player?.track ?? null)

  function close() {
    ui.music = null
  }

  /** Pede pro bot aberto (o meu ou o de quem pôs); erro vira aviso. */
  async function run(op: MusicOp): Promise<MusicReply | null> {
    if (!hostConnId) return null
    const reply = await call.musicRun(hostConnId, op)
    if (!reply.ok) client.toast(t.errors[reply.error])
    return reply
  }

  // ---------- Posição da música (anda sozinha entre uma leitura e outra) ----------

  let now = $state(Date.now())
  $effect(() => {
    if (!player?.playing) return
    const timer = setInterval(() => (now = Date.now()), 500)
    return () => clearInterval(timer)
  })
  /** Arrastando a barra: mostra onde vai soltar, não onde está. */
  let seeking = $state<number | null>(null)
  const position = $derived(seeking ?? (player ? progressOf(player, now) : 0))
  const duration = $derived(track?.durationMs ?? 0)

  function seek(ms: number) {
    seeking = null
    void run({ op: 'seek', ms })
  }

  const repeatNext = { off: 'context', context: 'track', track: 'off' } as const

  // ---------- Abas: buscar, fila, playlists ----------

  type Tab = 'search' | 'queue' | 'playlists'
  let tab = $state<Tab>('search')
  const tabs = $derived<{ value: Tab; label: string; count?: number }[]>([
    { value: 'search', label: t.tabs.search },
    { value: 'queue', label: t.tabs.queue, count: share?.queue.length || undefined },
    { value: 'playlists', label: t.tabs.playlists },
  ])

  let query = $state('')
  let results = $state<MusicSearch | null>(null)
  let searching = $state(false)
  let searchedFor = ''
  let offset = 0
  let typing: ReturnType<typeof setTimeout> | null = null

  async function search(more = false) {
    const q = query.trim()
    if (!q) return
    if (typing) clearTimeout(typing)
    if (!more && q === searchedFor && results) return
    offset = more ? offset + 10 : 0
    searchedFor = q
    searching = true
    const reply = await run({ op: 'search', q, offset })
    searching = false
    if (!reply?.ok || q !== searchedFor) return
    const found = cleanSearch(reply.data)
    results = more && results ? { tracks: [...results.tracks, ...found.tracks], lists: [...results.lists, ...found.lists] } : found
  }

  /** Busca sozinho quando a pessoa para de digitar (o Spotify limita os pedidos: nada de buscar a cada letra). */
  function typed() {
    if (typing) clearTimeout(typing)
    if (query.trim().length < 2) return
    typing = setTimeout(() => void search(), 600)
  }

  let playlists = $state<MusicList[] | null>(null)
  /** De quem são as playlists que estão chegando (trocou de bot no meio: a resposta velha vai fora). */
  let loadingPlaylists = $state<string | null>(null)
  async function loadPlaylists() {
    const host = hostConnId
    if (!host || playlists || loadingPlaylists === host) return
    loadingPlaylists = host
    const reply = await run({ op: 'playlists' })
    if (loadingPlaylists !== host) return
    loadingPlaylists = null
    if (reply?.ok && host === hostConnId) playlists = cleanLists(reply.data)
  }
  // Outro bot aberto: as playlists são de outra pessoa.
  $effect(() => {
    void hostConnId
    playlists = null
    loadingPlaylists = null
  })
  $effect(() => {
    if (tab === 'playlists' && hostConnId) void loadPlaylists()
  })

  async function play(uri: string) {
    await run({ op: 'play', uri })
  }

  async function enqueue(item: MusicTrack) {
    const reply = await run({ op: 'enqueue', uri: item.uri })
    if (reply?.ok) client.toast(t.search.queued(item.title), 'info')
  }

  // ---------- Pôr o meu Spotify na call ----------

  let status = $state<SpotifyStatus | null>(null)
  /** Client ID do app do Spotify, que o servidor informa (null: o servidor não tem). */
  let clientId = $state<string | null | undefined>(undefined)
  let busy = $state<'install' | 'connect' | null>(null)
  let error = $state<string | null>(null)
  const linux = $derived(client.platform?.platform === 'linux')
  const account = $derived(status?.account && status.account.clientId === clientId ? status.account : null)

  async function loadSetup() {
    status = await window.resenha.spotify.status()
    if (clientId === undefined) clientId = (await client.api?.status().catch(() => null))?.spotifyClientId ?? null
  }
  $effect(() => {
    if (!hostConnId) void loadSetup()
  })

  async function install() {
    busy = 'install'
    error = null
    const ok = await window.resenha.spotify.install()
    busy = null
    if (!ok) error = t.setup.installFailed
    await loadSetup()
  }

  async function connect() {
    if (!clientId) return
    busy = 'connect'
    error = null
    const result = await window.resenha.spotify.connect(clientId)
    busy = null
    if (!result.ok) error = t.errors[result.error]
    await loadSetup()
  }

  async function disconnect() {
    await window.resenha.spotify.disconnect()
    await loadSetup()
  }

  async function start() {
    error = null
    const failed = await call.startMusic()
    if (failed) error = t.errors[failed]
  }
</script>

<Modal title={hostConnId && !mine ? t.botOf(hostName) : t.title} size="lg" onclose={close} class="music-panel">
  {#if Object.keys(bots).length > 1}
    <div class="hosts" role="group">
      {#each Object.keys(bots) as connId (connId)}
        <button class="host" class:on={connId === hostConnId} onclick={() => (ui.music = { connId })}>
          <Icon name="music" size={14} />
          {connId === client.callConnId ? t.title : t.botOf(nameOf(connId))}
        </button>
      {/each}
    </div>
  {/if}

  {#if share && hostConnId}
    <!-- ---------- Tocando agora ---------- -->
    <div class="now">
      <div class="cover" class:empty={!track?.cover}>
        {#if track?.cover}<img src={track.cover} alt="" />{:else}<Icon name="music" size={28} />{/if}
      </div>
      <div class="info">
        {#if track}
          <strong class="title" title={track.title}>{track.title}</strong>
          <span class="artists">{track.artists}</span>
          <span class="album">{track.album}</span>
        {:else}
          <span class="nothing">{t.player.nothing}</span>
        {/if}
      </div>
    </div>

    <div class="progress">
      <span class="tabular">{clock(position / 1000)}</span>
      <Slider
        label={t.player.seek}
        min={0}
        max={Math.max(1, duration)}
        step={1000}
        value={position}
        disabled={!track}
        oninput={(e) => (seeking = Number(e.currentTarget.value))}
        onchange={(e) => seek(Number(e.currentTarget.value))}
      />
      <span class="tabular">{clock(duration / 1000)}</span>
    </div>

    <div class="controls">
      <IconButton
        icon="shuffle"
        label={t.player.shuffle}
        tone="success"
        active={!!player?.shuffle}
        aria-pressed={!!player?.shuffle}
        onclick={() => run({ op: 'shuffle', on: !player?.shuffle })}
      />
      <IconButton icon="skip-back" label={t.player.previous} size="lg" onclick={() => run({ op: 'previous' })} />
      <button
        class="play"
        aria-label={player?.playing ? t.player.pause : t.player.play}
        use:tooltip={player?.playing ? t.player.pause : t.player.play}
        onclick={() => run({ op: player?.playing ? 'pause' : 'resume' })}
      >
        <Icon name={player?.playing ? 'pause' : 'play'} size={20} />
      </button>
      <IconButton icon="skip-forward" label={t.player.next} size="lg" onclick={() => run({ op: 'next' })} />
      <IconButton
        icon={player?.repeat === 'track' ? 'repeat-one' : 'repeat'}
        label={t.player.repeat[player?.repeat ?? 'off']}
        tone="success"
        active={!!player && player.repeat !== 'off'}
        onclick={() => run({ op: 'repeat', mode: repeatNext[player?.repeat ?? 'off'] })}
      />
    </div>

    {#if player && player.elsewhere !== null}
      <!-- O nome do outro aparelho e o "trazer de volta" ficam só com quem pôs o bot. -->
      <div class="elsewhere">
        <Icon name="triangle-alert" size={16} />
        <span>{mine ? t.player.elsewhere(player.elsewhere) : t.player.elsewhereOther(hostName)}</span>
        {#if mine}<Button size="sm" onclick={() => run({ op: 'transfer' })}>{t.player.bringBack}</Button>{/if}
      </div>
    {/if}

    <div class="volume">
      <Icon name={settings.musicVolume === 0 ? 'volume-off' : 'volume'} size={16} />
      <span class="label">{t.player.volume}</span>
      <Slider label={t.player.volume} bind:value={settings.musicVolume} oninput={() => call.applyMusicOutput()} />
      <span class="tabular pct">{Math.round(settings.musicVolume * 100)}%</span>
    </div>

    <Tabs {tabs} bind:value={tab} label={t.title} class="music-tabs" />

    <div class="pane">
      {#if tab === 'search'}
        <form class="search" onsubmit={(e) => (e.preventDefault(), void search())}>
          <TextField icon="search" placeholder={t.search.placeholder} bind:value={query} oninput={typed} aria-label={t.tabs.search} />
        </form>
        {#if searching && !results}
          <div class="center"><Spinner /></div>
        {:else if results}
          {#if !results.tracks.length && !results.lists.length}
            <p class="hint">{t.search.none}</p>
          {/if}
          {#if results.tracks.length}
            <h3>{t.search.tracks}</h3>
            <ul class="items">
              {#each results.tracks as item, i (item.uri + i)}
                {@render trackRow(item, true)}
              {/each}
            </ul>
          {/if}
          {#if results.lists.length}
            <h3>{t.search.lists}</h3>
            <ul class="items">
              {#each results.lists as item, i (item.uri + i)}
                {@render listRow(item)}
              {/each}
            </ul>
          {/if}
          {#if results.tracks.length || results.lists.length}
            <div class="center">
              <Button size="sm" variant="ghost" loading={searching} onclick={() => search(true)}>{t.search.more}</Button>
            </div>
          {/if}
        {/if}
      {:else if tab === 'queue'}
        {#if share.queue.length}
          <ul class="items">
            {#each share.queue as item, i (item.uri + i)}
              {@render trackRow(item, false)}
            {/each}
          </ul>
        {:else}
          <p class="hint">{t.queue.empty}</p>
        {/if}
      {:else}
        <h3>{t.playlists.of(mine ? (client.me?.name ?? '') : hostName)}</h3>
        {#if loadingPlaylists}
          <div class="center"><Spinner /></div>
        {:else if playlists?.length}
          <ul class="items">
            {#each playlists as item, i (item.uri + i)}
              {@render listRow(item)}
            {/each}
          </ul>
        {:else if playlists}
          <p class="hint">{t.playlists.empty}</p>
        {/if}
      {/if}
    </div>
  {:else if !call.channelId}
    <p class="hint">{t.setup.joinFirst}</p>
  {:else if !linux}
    <p class="hint">{t.setup.linuxOnly}</p>
  {:else}
    <!-- ---------- Pôr o meu Spotify na call ---------- -->
    <div class="setup">
      <div class="hero">
        <div class="logo"><Icon name="music" size={26} /></div>
        <p>{t.setup.intro}</p>
      </div>

      {#if clientId === null}
        <p class="hint">{t.setup.noClientId}</p>
      {:else if status && clientId}
        <div class="step">
          <div class="text">
            <strong>{t.setup.librespot}</strong>
            <span>{status.librespot || status.installable ? t.setup.librespotHint : t.setup.installManual}</span>
          </div>
          {#if status.librespot}
            <span class="ok"><Icon name="circle-check" size={16} />{t.setup.installed}</span>
          {:else if status.installable}
            <Button size="sm" icon="download" loading={busy === 'install'} onclick={install}>{t.setup.install}</Button>
          {/if}
        </div>

        <div class="step">
          <div class="text">
            <strong>{t.setup.account}</strong>
            <span>{account ? t.setup.connected(account.name) : busy === 'connect' ? t.setup.connecting : t.setup.premium}</span>
          </div>
          {#if account}
            <Button size="sm" variant="ghost" onclick={disconnect}>{t.setup.disconnect}</Button>
          {:else}
            <Button size="sm" icon="log-in" loading={busy === 'connect'} onclick={connect}>{t.setup.connect}</Button>
          {/if}
        </div>

        {#if bot.status === 'starting'}
          <p class="hint starting">
            <Spinner size={14} />{bot.browser ? t.setup.browser : t.setup.starting}
            {#if bot.browser?.url}<a href={bot.browser.url} target="_blank" rel="noreferrer">{t.setup.browserLink}</a>{/if}
          </p>
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      {:else}
        <div class="center"><Spinner /></div>
      {/if}
    </div>
  {/if}

  {#snippet footer()}
    {#if share && mine}
      <Button variant="danger-soft" icon="log-out" onclick={() => call.stopMusic()}>{t.player.stop}</Button>
    {:else if !share && call.channelId && linux && clientId}
      <Button
        variant="primary"
        icon="music"
        loading={bot.status === 'starting'}
        disabled={!status?.librespot || !account}
        onclick={start}
      >
        {t.setup.start}
      </Button>
    {/if}
  {/snippet}
</Modal>

{#snippet trackRow(item: MusicTrack, actions: boolean)}
  <li class="item">
    <div class="thumb">{#if item.cover}<img src={item.cover} alt="" loading="lazy" />{:else}<Icon name="music" size={16} />{/if}</div>
    <div class="text">
      <span class="name">{item.title}</span>
      <span class="sub">{item.artists}</span>
    </div>
    <span class="tabular time">{clock(item.durationMs / 1000)}</span>
    {#if actions}
      <IconButton icon="list-plus" label={t.search.enqueue} size="sm" onclick={() => enqueue(item)} />
    {/if}
    <IconButton icon="play" label={t.search.playNow} size="sm" onclick={() => play(item.uri)} />
  </li>
{/snippet}

{#snippet listRow(item: MusicList)}
  <li class="item">
    <div class="thumb">{#if item.cover}<img src={item.cover} alt="" loading="lazy" />{:else}<Icon name="list-music" size={16} />{/if}</div>
    <div class="text">
      <span class="name">{item.title}</span>
      <span class="sub">{item.kind === 'album' ? t.search.album : t.search.playlist}{item.by ? ` · ${item.by}` : ''}</span>
    </div>
    <IconButton icon="play" label={t.search.playNow} size="sm" onclick={() => play(item.uri)} />
  </li>
{/snippet}

<style>
  .hosts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }

  .host {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--r-full);
    color: var(--fg-2);
    font-size: var(--text-sm);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .host.on {
    background: var(--spotify-soft);
    color: var(--spotify);
    box-shadow: inset 0 0 0 1px var(--spotify);
  }

  .now {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .cover {
    flex: none;
    width: 112px;
    height: 112px;
    border-radius: var(--r-lg);
    overflow: hidden;
    background: var(--bg-input);
    box-shadow: 0 0 0 1px var(--line);
  }

  .cover.empty {
    display: grid;
    place-items: center;
    color: var(--spotify);
  }

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .title {
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .artists {
    color: var(--fg-2);
  }

  .album,
  .nothing {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .progress {
    display: grid;
    grid-template-columns: 40px 1fr 40px;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .progress span:last-child {
    text-align: right;
  }

  .controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 14px;
    margin-top: 6px;
  }

  .play {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--r-full);
    background: var(--spotify);
    color: var(--spotify-ink);
    transition: transform var(--t-fast) var(--ease);
  }

  .play:hover {
    transform: scale(1.05);
  }

  .play :global(svg) {
    fill: currentColor;
  }

  .elsewhere {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    color: var(--yellow);
    font-size: var(--text-sm);
  }

  .elsewhere span {
    flex: 1;
    color: var(--fg-2);
  }

  .volume {
    display: grid;
    grid-template-columns: auto auto 1fr 40px;
    align-items: center;
    gap: 10px;
    margin: 14px 0 6px;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .pct {
    color: var(--fg-3);
    text-align: right;
  }

  :global(.music-tabs) {
    margin-top: 8px;
  }

  .pane {
    min-height: 220px;
    padding-top: 12px;
  }

  .search {
    margin-bottom: 8px;
  }

  h3 {
    margin: 14px 0 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 -8px;
    padding: 0;
    list-style: none;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: var(--r-md);
  }

  .item:hover {
    background: var(--hover);
  }

  .thumb {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--bg-input);
    color: var(--fg-3);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .item .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .name,
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    font-size: var(--text-sm);
  }

  .sub,
  .time {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .hint {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .hint.starting {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    color: var(--fg-2);
  }

  .error {
    margin-top: 12px;
    color: var(--red);
    font-size: var(--text-sm);
  }

  .center {
    display: flex;
    justify-content: center;
    padding: 16px 0;
  }

  .setup .hero {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
    color: var(--fg-2);
  }

  .logo {
    flex: none;
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: var(--r-full);
    background: var(--spotify);
    color: var(--spotify-ink);
  }

  .step {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }

  .step .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
  }

  .step .text span {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .ok {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--green);
    font-size: var(--text-sm);
  }
</style>
