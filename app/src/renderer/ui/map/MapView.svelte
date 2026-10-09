<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { MAX_MAP_PIN_LABEL, MAX_MAP_PINS, P, type MapPin, type MapView, type StreetSpot } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { formatStamp, userColor } from '../../lib/format'
  import { searchPlaces, type Place } from '../../lib/geocode'
  import type { GuildState } from '../../lib/guild.svelte'
  import { m } from '../../lib/i18n.svelte'
  import type { LngLat, SharedMap } from '../../lib/map-canvas'
  import { MAP_STYLES, PIN_COLORS, streetEmbedUrl, streetPageUrl, type MapListener, type MapStyleName } from '../../lib/map.svelte'
  import { confirmAction } from '../../lib/ui.svelte'
  import { Avatar, Button, EmptyState, Icon, IconButton, Kbd, Menu, Spinner, layer, tooltip, type MenuItem } from '../kit'

  let { guild }: { guild: GuildState } = $props()

  // O mapa e o servidor não mudam enquanto a tela existe (o Shell recria com {#key}).
  // svelte-ignore state_referenced_locally
  const shared = guild.map
  /** Ninguém mexeu ainda: o Brasil inteiro. */
  const BRAZIL: MapView = { lng: -52.5, lat: -14.8, zoom: 3.3, bearing: 0, pitch: 0 }
  const STYLE_KEY = 'resenha.mapStyle'
  const PINS_KEY = 'resenha.mapPins'

  let container = $state<HTMLDivElement>()
  let cardHost = $state<HTMLDivElement>()
  let canvas = $state.raw<SharedMap | null>(null)
  let lib = $state.raw<typeof import('../../lib/map-canvas') | null>(null)
  /** Vista com que o mapa nasce (undefined: o servidor ainda não respondeu). */
  let initial = $state.raw<MapView | null | undefined>(undefined)
  let status = $state<'loading' | 'ready' | 'failed'>('loading')
  /** Por que não abriu: sem WebGL, ou os mapas não vieram (sem internet). */
  let failure = $state<'webgl' | 'offline'>('webgl')
  let view = $state.raw<MapView>(BRAZIL)
  let styleName = $state<MapStyleName>(loadStyle())
  let pinsOpen = $state(loadPinsOpen())
  let placing = $state(false)
  /** Escolhendo onde abrir o Street View (o próximo clique no mapa). */
  let streetPicking = $state(false)
  /** Street View aberto, nesse lugar. */
  let street = $state.raw<StreetSpot | null>(null)
  let selected = $state<string | null>(null)
  let draft = $state<{ at: LngLat; label: string; color: number } | null>(null)
  let draftInput = $state<HTMLInputElement>()
  let styleButton = $state<HTMLElement>()
  let styleMenu = $state(false)

  let query = $state('')
  let searching = $state(false)
  let results = $state<Place[] | null>(null)
  let searchError = $state<string | null>(null)

  const t = $derived(m.map)
  const timedOut = $derived(!!guild.me?.timeoutUntil && guild.me.timeoutUntil > client.now)
  const moderator = $derived(guild.canGuild(P.MANAGE_MESSAGES))
  const people = $derived(shared.people)
  const mover = $derived(shared.mover && shared.mover !== guild.meId ? shared.mover : null)
  const pins = $derived([...shared.pins].reverse())
  /** Quem está no Street View (eu também), pros bonequinhos no mapa. */
  const walkers = $derived(shared.viewers.filter((v) => !!v.street))
  /** Quem está olhando o mesmo lugar que eu no Street View. */
  const together = $derived(
    street ? [...new Set(walkers.filter((w) => w.connId !== guild.connId && near(w.street!, street!)).map((w) => w.userId))] : [],
  )
  const selectedPin = $derived(shared.pins.find((p) => p.id === selected) ?? null)
  // O Google conta o zoom com quadradinhos de 256 px; o MapLibre, de 512: lá é um a mais.
  const googleUrl = $derived(
    `https://www.google.com/maps/@${view.lat.toFixed(6)},${view.lng.toFixed(6)},${Math.min(21, view.zoom + 1).toFixed(2)}z`,
  )

  function loadStyle(): MapStyleName {
    try {
      const saved = localStorage.getItem(STYLE_KEY)
      return saved && saved in MAP_STYLES ? (saved as MapStyleName) : 'dark'
    } catch {
      return 'dark'
    }
  }

  function loadPinsOpen(): boolean {
    try {
      return localStorage.getItem(PINS_KEY) === '1'
    } catch {
      return false
    }
  }

  function remember(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // sem armazenamento
    }
  }

  // ---------- Ligação com o servidor ----------

  const listener: MapListener = {
    state(next, first) {
      if (!canvas) initial = next
      else if (next) canvas.follow(next, first ? 'jump' : 'follow')
    },
    view(next) {
      canvas?.follow(next)
    },
    cursor(connId, userId, at) {
      canvas?.setCursor(connId, guild.displayName(userId), userColor(userId), at)
    },
  }

  onMount(() => {
    let alive = true
    shared.join(listener)
    // Sem resposta do servidor (sem conexão agora): abre onde dá e acompanha quando chegar.
    const fallback = setTimeout(() => {
      if (initial === undefined) initial = null
    }, 3000)
    import('../../lib/map-canvas')
      .then((mod) => {
        if (alive) lib = mod
      })
      .catch((err) => {
        console.error('mapa não carregou', err)
        if (alive) status = 'failed'
      })
    return () => {
      alive = false
      clearTimeout(fallback)
      shared.leave()
      canvas?.destroy()
      canvas = null
    }
  })

  // Cria o mapa quando o MapLibre carregou e o servidor disse onde todo mundo está.
  $effect(() => {
    if (canvas || !lib || initial === undefined || !container || status === 'failed') return
    const start = initial ?? BRAZIL
    view = start
    try {
      canvas = new lib.SharedMap(container, start, MAP_STYLES[styleName].url, {
        moved: (next) => {
          if (!timedOut) shared.moveTo(next)
        },
        pointer: (at) => {
          if (!timedOut) shared.cursor(at)
        },
        pick: (at) => (streetPicking ? openStreet({ ...at, heading: view.bearing }) : openDraft(at)),
        walkerClicked: (connId) => {
          const spot = shared.viewers.find((v) => v.connId === connId)?.street
          if (spot) openStreet(spot)
        },
        tapped: () => (selected = null),
        pinClicked: (id) => (selected = selected === id ? null : id),
        changed: (next) => (view = next),
        loaded: () => (status = 'ready'),
        failed: () => {
          failure = 'offline'
          status = 'failed'
        },
      })
    } catch (err) {
      // Sem WebGL (placa de vídeo bloqueada, driver): o resto (marcadores, quem está aqui) continua.
      console.error('mapa sem WebGL', err)
      failure = 'webgl'
      status = 'failed'
    }
  })

  function retry() {
    status = 'loading'
    canvas?.retry()
  }

  $effect(() => {
    canvas?.setPins(shared.pins)
  })

  $effect(() => {
    canvas?.select(selected)
  })

  $effect(() => {
    canvas?.setPlacing(placing || streetPicking)
  })

  $effect(() => {
    canvas?.setWalkers(
      walkers.map((w) => ({
        connId: w.connId,
        name: guild.displayName(w.userId),
        color: userColor(w.userId),
        at: w.street!,
        mine: w.connId === guild.connId,
      })),
    )
  })

  // O cartão (novo marcador ou o escolhido) fica preso no lugar dele enquanto o mapa mexe.
  $effect(() => {
    const at = draft?.at ?? selectedPin
    canvas?.setCard(at ? { lng: at.lng, lat: at.lat } : null, cardHost ?? null)
  })

  $effect(() => {
    canvas?.setDraft(draft?.at ?? null, draft?.color ?? 0)
  })

  // Quem saiu do mapa leva o cursor junto.
  $effect(() => {
    const ids = new Set(shared.viewers.map((v) => v.connId))
    canvas?.keepCursors(ids)
  })

  // Marcador apagado (por mim ou por outra pessoa): fecha o cartão dele.
  $effect(() => {
    if (selected && !selectedPin) selected = null
  })

  // ---------- Street View ----------

  /** Mais ou menos o mesmo lugar (uns 20 m). */
  function near(a: StreetSpot, b: StreetSpot): boolean {
    return Math.abs(a.lat - b.lat) < 0.0002 && Math.abs(a.lng - b.lng) < 0.0002
  }

  function openStreet(at: StreetSpot) {
    streetPicking = false
    placing = false
    draft = null
    street = at
    shared.street(at)
  }

  function closeStreet() {
    street = null
    shared.street(null)
  }

  function streetAtPin(pin: MapPin | null) {
    if (pin) openStreet({ lng: pin.lng, lat: pin.lat, heading: view.bearing })
  }

  function streetClick() {
    if (street) return closeStreet()
    streetPicking = !streetPicking
    placing = false
    draft = null
  }

  // ---------- Marcadores ----------

  function openDraft(at: LngLat, label = '') {
    if (timedOut) return client.toast(m.map.timedOut)
    placing = false
    selected = null
    draft = { at, label, color: draft?.color ?? myColor() }
    tick().then(() => draftInput?.focus())
  }

  function myColor(): number {
    const mine = parseInt(userColor(guild.meId).slice(1), 16)
    return PIN_COLORS.includes(mine) ? mine : PIN_COLORS[0]
  }

  function submitDraft(event: SubmitEvent) {
    event.preventDefault()
    if (!draft) return
    const label = draft.label.trim()
    if (!label) return draftInput?.focus()
    if (shared.addPin(draft.at.lng, draft.at.lat, label, draft.color)) draft = null
  }

  function canDelete(pin: MapPin): boolean {
    return pin.authorId === guild.meId || moderator
  }

  function deletePin(pin: MapPin, event?: MouseEvent) {
    if (event?.shiftKey) return shared.removePin(pin.id)
    confirmAction({
      title: m.map.confirmDelete.title,
      description: m.map.confirmDelete.description(pin.label),
      confirm: m.map.delete,
      onconfirm: () => shared.removePin(pin.id),
    })
  }

  function goToPin(pin: MapPin) {
    selected = pin.id
    canvas?.flyTo(pin, Math.max(view.zoom, 15))
  }

  function togglePins() {
    pinsOpen = !pinsOpen
    remember(PINS_KEY, pinsOpen ? '1' : '0')
  }

  function pinPlace(pin: MapPin): string {
    return `https://www.google.com/maps/search/?api=1&query=${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`
  }

  // ---------- Busca ----------

  async function search(event: KeyboardEvent) {
    if (event.key !== 'Enter' || searching) return
    event.preventDefault()
    const text = query.trim()
    if (!text) return
    searching = true
    searchError = null
    try {
      results = await searchPlaces(text)
    } catch (err) {
      results = []
      searchError = err instanceof TypeError ? m.map.searchOffline : (err as Error).message
    } finally {
      searching = false
    }
  }

  function clearSearch() {
    query = ''
    results = null
    searchError = null
  }

  function goTo(place: Place) {
    results = null
    if (place.bbox) canvas?.fitBounds(place.bbox)
    else canvas?.flyTo(place, 16)
  }

  function markPlace(place: Place) {
    goTo(place)
    openDraft(place, place.name.slice(0, MAX_MAP_PIN_LABEL))
  }

  // ---------- Estilo ----------

  const styleItems = $derived<MenuItem[]>(
    (Object.keys(MAP_STYLES) as MapStyleName[]).map((name) => ({
      label: t.styles[name],
      checked: styleName === name,
      onselect: () => {
        styleName = name
        remember(STYLE_KEY, name)
        canvas?.setStyle(MAP_STYLES[name].url)
      },
    })),
  )
</script>

<section class="map-pane" class:with-aside={pinsOpen} class:with-street={!!street} aria-label={t.title}>
  <header>
    <Icon name="map" size={20} class="header-icon" />
    <h1>{t.title}</h1>
    {#if people.length}
      <span class="divider"></span>
      <span class="people" aria-label={t.onMapNow(people.map((id) => guild.displayName(id)).join(', '))}>
        {#each people.slice(0, 5) as id (id)}
          <span class="face" use:tooltip={{ text: guild.displayName(id), placement: 'bottom' }}>
            <Avatar {id} name={guild.displayName(id)} size={24} src={client.avatarOf(id, guild.id)} />
          </span>
        {/each}
        {#if people.length > 5}<span class="more">+{people.length - 5}</span>{/if}
      </span>
    {/if}

    <div class="tools">
      <label class="search" class:filled={!!query}>
        {#if searching}<Spinner size={14} />{:else}<Icon name="search" size={15} />{/if}
        <input placeholder={t.search} bind:value={query} aria-label={t.search} onkeydown={search} data-own-escape />
        {#if query}
          <button class="clear" aria-label={t.clearSearch} onclick={clearSearch}><Icon name="x" size={14} /></button>
        {/if}
      </label>
      <IconButton
        icon="map-pin-plus"
        label={timedOut ? t.markTimedOut : t.mark}
        tip="bottom"
        active={placing}
        tone="accent"
        disabled={timedOut || status !== 'ready'}
        onclick={() => ((placing = !placing), (draft = null), (streetPicking = false))}
      />
      <IconButton
        icon="person-standing"
        label={street ? t.closeStreet : t.streetView}
        tip="bottom"
        active={streetPicking || !!street}
        disabled={status !== 'ready'}
        onclick={streetClick}
      />
      <IconButton icon="map-pin" label={t.pins} tip="bottom" active={pinsOpen} onclick={togglePins} />
      <span bind:this={styleButton}>
        <IconButton icon="layers" label={t.style} tip="bottom" active={styleMenu} onclick={() => (styleMenu = !styleMenu)} />
      </span>
      <a class="gmaps" href={googleUrl} target="_blank" rel="noreferrer noopener" use:tooltip={{ text: t.googleHint, placement: 'bottom' }}>
        <span class="gmaps-text">Google Maps</span>
        <Icon name="arrow-up-right" size={15} />
      </a>
    </div>
  </header>

  <div class="body">
    <div
      class="stage"
      data-ready={status === 'ready' ? '' : undefined}
      data-center="{view.lng.toFixed(5)},{view.lat.toFixed(5)},{view.zoom.toFixed(2)}"
    >
      <div class="canvas" bind:this={container}></div>

      {#if status === 'loading'}
        <div class="veil"><Spinner size={20} /></div>
      {:else if status === 'failed'}
        <div class="veil failed">
          {#if failure === 'offline'}
            <EmptyState icon="map" title={t.offline.title} description={t.offline.description}>
              {#snippet actions()}<Button size="sm" onclick={retry}>{m.common.retry}</Button>{/snippet}
            </EmptyState>
          {:else}
            <EmptyState icon="map" title={t.webgl.title} description={t.webgl.description} />
          {/if}
        </div>
      {/if}

      {#if placing}
        <div class="pill" role="status" use:layer={() => (placing = false)}>
          <Icon name="map-pin-plus" size={15} />
          {t.clickToMark}
          <Kbd keys="Esc" />
        </div>
      {:else if streetPicking}
        <div class="pill" role="status" use:layer={() => (streetPicking = false)}>
          <Icon name="person-standing" size={15} />
          {t.clickToStreet}
          <Kbd keys="Esc" />
        </div>
      {:else if mover}
        <div class="pill" role="status">
          <Avatar id={mover} name={guild.displayName(mover)} size={18} src={client.avatarOf(mover, guild.id)} />
          {t.moving(guild.displayName(mover))}
        </div>
      {/if}

      {#if results}
        <div class="results" use:layer={() => (results = null)}>
          {#if searchError}
            <p class="note">{searchError}</p>
          {:else if results.length === 0}
            <p class="note">{t.noResults(query.trim())}</p>
          {:else}
            <ul>
              {#each results as place, i (i)}
                <li>
                  <button class="result" onclick={() => goTo(place)}>
                    <Icon name="map-pin" size={16} />
                    <span class="result-text">
                      <span class="result-name">{place.name}</span>
                      {#if place.detail}<span class="result-detail">{place.detail}</span>{/if}
                    </span>
                  </button>
                  <IconButton icon="map-pin-plus" label={t.markHere} size="sm" disabled={timedOut} onclick={() => markPlace(place)} />
                </li>
              {/each}
            </ul>
          {/if}
          <p class="credit">{t.credit}</p>
        </div>
      {/if}

      <!-- O MapLibre leva o conteúdo daqui pro cartão preso no mapa (setCard). -->
      <div class="card-slot">
        <div class="card-host" bind:this={cardHost}>
          {#if draft}
            <form class="card draft" onsubmit={submitDraft} use:layer={() => (draft = null)}>
              <input
                bind:this={draftInput}
                bind:value={draft.label}
                maxlength={MAX_MAP_PIN_LABEL}
                placeholder={t.placeName}
                aria-label={t.placeName}
              />
              <div class="swatches" role="radiogroup" aria-label={t.color}>
                {#each PIN_COLORS as color (color)}
                  <button
                    type="button"
                    class="swatch"
                    role="radio"
                    aria-checked={draft.color === color}
                    aria-label={t.colorN(PIN_COLORS.indexOf(color) + 1)}
                    style:--pin="#{color.toString(16).padStart(6, '0')}"
                    onclick={() => draft && (draft.color = color)}
                  ></button>
                {/each}
              </div>
              <div class="actions">
                <Button size="sm" variant="ghost" onclick={() => (draft = null)}>{m.common.cancel}</Button>
                <Button size="sm" variant="primary" type="submit" disabled={!draft.label.trim()}>{t.markButton}</Button>
              </div>
            </form>
          {:else if selectedPin}
            <div class="card pin-card" use:layer={() => (selected = null)}>
              <div class="pin-head">
                <span class="dot" style:--pin="#{selectedPin.color.toString(16).padStart(6, '0')}"></span>
                <strong>{selectedPin.label}</strong>
                <IconButton icon="x" label={m.common.close} size="sm" tip={false} onclick={() => (selected = null)} />
              </div>
              <p class="pin-meta">{guild.displayName(selectedPin.authorId)} · {formatStamp(selectedPin.createdAt)}</p>
              <div class="actions">
                {#if canDelete(selectedPin)}
                  {@const pin = selectedPin}
                  <Button size="sm" variant="danger-soft" icon="trash" onclick={(e) => deletePin(pin, e)}>{t.delete}</Button>
                {/if}
                <Button size="sm" variant="secondary" icon="person-standing" onclick={() => streetAtPin(selectedPin)}>
                  {t.streetView}
                </Button>
                <a class="gmaps small" href={pinPlace(selectedPin)} target="_blank" rel="noreferrer noopener">
                  Google Maps <Icon name="arrow-up-right" size={14} />
                </a>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <div class="controls">
        <IconButton icon="plus" label={t.zoomIn} variant="glass" tip="left" disabled={status !== 'ready'} onclick={() => canvas?.zoomBy(1)} />
        <IconButton icon="minus" label={t.zoomOut} variant="glass" tip="left" disabled={status !== 'ready'} onclick={() => canvas?.zoomBy(-1)} />
        <span class="north" style:rotate="{-view.bearing}deg">
          <IconButton icon="compass" label={t.north} variant="glass" tip="left" disabled={status !== 'ready'} onclick={() => canvas?.resetNorth()} />
        </span>
      </div>
    </div>

    {#if street}
      <section class="street" aria-label={t.streetView} use:layer={closeStreet}>
        <div class="street-head">
          <Icon name="person-standing" size={16} class="street-icon" />
          <span class="street-title">{t.streetView}</span>
          {#if together.length}
            <span class="street-with" use:tooltip={{ text: t.together(together.map((id) => guild.displayName(id)).join(', ')), placement: 'bottom' }}>
              {#each together.slice(0, 3) as id (id)}
                <Avatar {id} name={guild.displayName(id)} size={20} src={client.avatarOf(id, guild.id)} cutout="var(--bg-raised)" />
              {/each}
            </span>
          {/if}
          <a class="gmaps small" href={streetPageUrl(street)} target="_blank" rel="noreferrer noopener" use:tooltip={{ text: t.streetBrowser, placement: 'bottom' }}>
            Google Maps <Icon name="arrow-up-right" size={14} />
          </a>
          <IconButton icon="x" label={t.closeStreet} size="sm" tip="bottom" onclick={closeStreet} />
        </div>
        {#key streetEmbedUrl(street)}
          <!-- Sem allow-top-navigation: a página do Google não consegue tirar o app do lugar. -->
          <iframe
            class="street-frame"
            title={t.streetView}
            src={streetEmbedUrl(street)}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            allow="fullscreen"
            scrolling="no"
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
        {/key}
        <p class="street-note">{t.streetNote}</p>
      </section>
    {/if}

    {#if pinsOpen}
      <aside class="aside" aria-label={t.pins}>
        <div class="aside-head">
          <span>{t.pins}</span>
          <span class="count">{shared.pins.length}</span>
        </div>
        {#if pins.length === 0}
          <EmptyState icon="map-pin" title={t.noPins} description={t.noPinsHint} />
        {:else}
          <ul class="pins">
            {#each pins as pin (pin.id)}
              <li class:selected={selected === pin.id}>
                <button class="pin-main" onclick={() => goToPin(pin)}>
                  <span class="dot" style:--pin="#{pin.color.toString(16).padStart(6, '0')}"></span>
                  <span class="pin-text">
                    <span class="pin-label">{pin.label}</span>
                    <span class="pin-meta">{guild.displayName(pin.authorId)} · {formatStamp(pin.createdAt)}</span>
                  </span>
                </button>
                {#if canDelete(pin)}
                  <span class="pin-delete">
                    <IconButton icon="trash" label={t.deletePin} size="sm" tip="left" onclick={(e) => deletePin(pin, e)} />
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
          <p class="aside-foot">{t.pinCount(shared.pins.length, MAX_MAP_PINS)}</p>
        {/if}
      </aside>
    {/if}
  </div>
</section>

{#if styleMenu}
  <Menu items={styleItems} anchor={styleButton} placement="bottom-end" width={180} onclose={() => (styleMenu = false)} />
{/if}

<style>
  .map-pane {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
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

  .people {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .face {
    display: inline-flex;
    margin-left: -6px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--bg-panel);
  }

  .face:first-child {
    margin-left: 0;
  }

  .more {
    margin-left: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
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
    width: 188px;
    height: 30px;
    margin-right: 6px;
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
    width: 240px;
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

  .gmaps {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    margin-left: 6px;
    padding: 0 10px 0 12px;
    border-radius: var(--r-md);
    background: var(--hover);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease);
  }

  .gmaps:hover {
    background: var(--selected);
    color: var(--fg);
  }

  .gmaps.small {
    height: 28px;
    margin-left: auto;
    padding: 0 8px 0 10px;
    font-size: var(--text-xs);
  }

  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .with-aside .body {
    grid-template-columns: minmax(0, 1fr) 280px;
  }

  .with-street .body {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  }

  .with-street.with-aside .body {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) 280px;
  }

  /* ---------- Street View ---------- */

  .street {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--line);
    background: var(--bg-raised);
  }

  .street-head {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 8px 0 14px;
    flex: none;
  }

  .street-head :global(.street-icon) {
    color: var(--fg-3);
  }

  .street-title {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .street-with {
    display: flex;
    padding-left: 6px;
  }

  .street-with > :global(*) {
    margin-left: -6px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--bg-raised);
  }

  .street-head .gmaps {
    margin-left: auto;
  }

  .street-frame {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: 0;
    background: #0f0f15;
  }

  .street-note {
    flex: none;
    padding: 8px 14px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  /* Bonequinho de quem está no Street View, com o cone pra onde está olhando. */
  .canvas :global(.map-walker) {
    --c: var(--accent-fg);
    position: relative;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    cursor: pointer;
  }

  .canvas :global(.map-walker-body) {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--c);
    box-shadow:
      0 0 0 2px rgb(255 255 255 / 0.9),
      0 2px 6px rgb(0 0 0 / 0.45);
  }

  .canvas :global(.map-walker-body svg) {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: rgb(12 10 24 / 0.9);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .canvas :global(.map-walker-cone) {
    position: absolute;
    inset: -14px;
    border-radius: 50%;
    background: conic-gradient(from calc(var(--heading, 0deg) - 30deg), color-mix(in srgb, var(--c) 45%, transparent) 0deg 60deg, transparent 60deg);
    mask: radial-gradient(circle, transparent 11px, #000 12px);
    pointer-events: none;
  }

  .canvas :global(.map-walker-name) {
    position: absolute;
    top: 100%;
    left: 50%;
    margin-top: 4px;
    padding: 2px 7px;
    border-radius: var(--r-full);
    background: var(--c);
    color: rgb(12 10 24 / 0.88);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
    translate: -50% 0;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
  }

  .canvas :global(.map-walker.mine) {
    cursor: default;
  }

  /* Painel estreito (janela pequena): as pessoas saem do cabeçalho e o link vira só o ícone. */
  @container panel (max-width: 780px) {
    .people,
    .divider,
    .gmaps-text {
      display: none;
    }

    .search {
      width: 140px;
    }

    .search:focus-within,
    .search.filled {
      width: 180px;
    }

    .with-aside .body {
      grid-template-columns: minmax(0, 1fr) 240px;
    }
  }

  .stage {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #0f0f15;
  }

  /* O MapLibre põe a fonte dele no mapa inteiro (marcadores, cartões, créditos): volta pra do app. */
  .canvas {
    position: absolute;
    inset: 0;
    font: inherit;
  }

  .veil {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: grid;
    place-items: center;
    background: var(--bg-panel);
    color: var(--fg-3);
  }

  .pill {
    position: absolute;
    top: 14px;
    left: 50%;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 14px 0 8px;
    border-radius: var(--r-full);
    background: rgb(26 26 34 / 0.92);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-md);
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    translate: -50% 0;
    backdrop-filter: blur(8px);
    animation: rs-pop-in var(--t) var(--ease);
    pointer-events: none;
  }

  .pill :global(svg) {
    margin-left: 4px;
    color: var(--accent-fg);
  }

  .card,
  .results {
    z-index: 5;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    animation: rs-pop-in var(--t) var(--ease);
  }

  .results {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 340px;
    max-height: calc(100% - 24px);
    overflow-y: auto;
    padding: 6px;
  }

  .results ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .results li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-right: 4px;
    border-radius: var(--r-lg);
  }

  .results li:hover {
    background: var(--hover);
  }

  .result {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 4px 8px 10px;
    color: var(--fg-3);
    text-align: left;
  }

  .result :global(svg) {
    flex: none;
    margin-top: 1px;
  }

  .result-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .result-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 550;
  }

  .result-detail {
    display: -webkit-box;
    overflow: hidden;
    color: var(--fg-3);
    font-size: var(--text-xs);
    line-height: 1.35;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .note {
    margin: 0;
    padding: 12px 10px;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .credit {
    margin: 2px 0 0;
    padding: 6px 10px 4px;
    border-top: 1px solid var(--line);
    color: var(--fg-4);
    font-size: var(--text-2xs);
  }

  .card-slot {
    display: none;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    color: var(--fg);
    text-align: left;
  }

  .draft {
    width: 264px;
  }

  .draft input {
    height: var(--h-md);
    padding: 0 10px;
    border: 0;
    border-radius: var(--r-md);
    outline: none;
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .draft input:focus {
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }

  .swatches {
    display: flex;
    gap: 8px;
    padding: 0 2px;
  }

  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--pin);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.2);
    transition: transform var(--t-fast) var(--ease);
  }

  .swatch:hover {
    transform: scale(1.1);
  }

  .swatch[aria-checked='true'] {
    box-shadow:
      0 0 0 2px var(--bg-raised),
      0 0 0 4px var(--pin);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
  }

  .pin-card {
    width: 252px;
    gap: 6px;
  }

  .pin-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: -6px;
  }

  .pin-head strong {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-md);
    font-weight: 600;
  }

  .pin-card .pin-meta {
    margin: 0 0 4px 18px;
  }

  .pin-card .actions {
    justify-content: flex-start;
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--pin);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--pin) 22%, transparent);
  }

  .pin-meta {
    overflow: hidden;
    color: var(--fg-3);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .controls {
    position: absolute;
    right: 12px;
    bottom: 44px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px;
    border-radius: var(--r-lg);
    background: rgb(26 26 34 / 0.88);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-md);
    backdrop-filter: blur(8px);
  }

  .north {
    display: inline-grid;
    transition: rotate var(--t-fast) linear;
  }

  /* ---------- Lista de marcadores ---------- */

  .aside {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--line);
  }

  .aside-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 16px 8px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .count {
    color: var(--fg-4);
    font-variant-numeric: tabular-nums;
  }

  .aside :global(.empty) {
    padding: 32px 16px;
  }

  .pins {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin: 0;
    padding: 0 8px 8px;
    list-style: none;
    scrollbar-width: thin;
  }

  .pins li {
    position: relative;
    border-radius: var(--r-md);
  }

  .pins li:hover {
    background: var(--hover);
  }

  .pins li.selected {
    background: var(--selected);
  }

  .pin-main {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    text-align: left;
  }

  .pin-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .pin-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .pin-delete {
    position: absolute;
    top: 50%;
    right: 6px;
    opacity: 0;
    translate: 0 -50%;
    transition: opacity var(--t-fast) var(--ease);
  }

  .pins li:hover .pin-delete,
  .pin-delete:focus-within {
    opacity: 1;
  }

  .aside-foot {
    margin: 0;
    padding: 8px 16px 14px;
    color: var(--fg-4);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  /* ---------- Dentro do mapa (elementos criados pelo MapLibre) ---------- */

  .canvas :global(.maplibregl-canvas-container.placing),
  .canvas :global(.maplibregl-canvas-container.placing .maplibregl-canvas) {
    cursor: crosshair;
  }

  /* Marcadores e cursores ficam com o position: absolute do MapLibre (é ele que posiciona). */
  .canvas :global(.map-pin) {
    width: 28px;
    height: 36px;
    padding: 0;
    filter: drop-shadow(0 3px 6px rgb(0 0 0 / 0.45));
    cursor: pointer;
  }

  /* Cresce só o desenho: escala no marcador mexeria no translate que o MapLibre usa pra posicionar. */
  .canvas :global(.map-pin svg) {
    display: block;
    width: 28px;
    height: 36px;
    transform-origin: 50% 100%;
    transition: scale var(--t-fast) var(--ease);
  }

  .canvas :global(.map-pin-body) {
    fill: var(--pin);
    stroke: rgb(0 0 0 / 0.28);
    stroke-width: 1;
  }

  .canvas :global(.map-pin-dot) {
    fill: rgb(15 15 21 / 0.82);
  }

  .canvas :global(.map-pin:hover svg),
  .canvas :global(.map-pin.selected svg) {
    scale: 1.12;
  }

  .canvas :global(.map-pin-label) {
    position: absolute;
    top: 6px;
    left: calc(100% + 2px);
    max-width: 180px;
    overflow: hidden;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    background: rgb(19 19 25 / 0.9);
    box-shadow: 0 0 0 1px var(--line-strong);
    color: var(--fg);
    font-size: var(--text-xs);
    font-weight: 550;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--t-fast) var(--ease);
  }

  .canvas :global(.map-pin:hover .map-pin-label),
  .canvas :global(.map-pin.selected .map-pin-label),
  .canvas :global(.map-pin:focus-visible .map-pin-label) {
    opacity: 1;
  }

  .canvas :global(.map-cursor) {
    --c: var(--accent-fg);
    pointer-events: none;
    transition: opacity var(--t-slow) var(--ease);
  }

  .canvas :global(.map-cursor.gone) {
    opacity: 0;
  }

  .canvas :global(.map-cursor svg) {
    display: block;
    width: 20px;
    height: 20px;
    fill: var(--c);
    stroke: rgb(255 255 255 / 0.9);
    stroke-width: 1.4;
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.5));
  }

  .canvas :global(.map-cursor-name) {
    position: absolute;
    top: 16px;
    left: 14px;
    padding: 2px 7px;
    border-radius: var(--r-full);
    background: var(--c);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
    color: rgb(12 10 24 / 0.88);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .canvas :global(.map-pin.draft) {
    opacity: 0.6;
    pointer-events: none;
  }

  .canvas :global(.map-card) {
    z-index: 5;
  }

  .canvas :global(.map-card .maplibregl-popup-content) {
    padding: 0;
    border-radius: 0;
    background: none;
    box-shadow: none;
  }

  .canvas :global(.map-card .maplibregl-popup-tip) {
    display: none;
  }

  /* Créditos do mapa no tom do app (continuam visíveis: a licença pede). */
  .canvas :global(.maplibregl-ctrl-attrib) {
    background: rgb(19 19 25 / 0.82);
    color: var(--fg-3);
    font-size: var(--text-2xs);
  }

  .canvas :global(.maplibregl-ctrl-attrib a) {
    color: var(--fg-2);
  }

  .canvas :global(.maplibregl-ctrl-attrib.maplibregl-compact) {
    min-height: 22px;
    margin: 0 10px 10px 0;
    border-radius: 11px;
    box-shadow: 0 0 0 1px var(--line);
  }

  .canvas :global(.maplibregl-ctrl-attrib-button) {
    filter: invert(1) opacity(0.7);
    background-color: transparent;
  }

  .canvas :global(.maplibregl-ctrl-attrib.maplibregl-compact-show) {
    padding: 2px 28px 2px 10px;
  }
</style>
