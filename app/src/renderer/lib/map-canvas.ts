// O mapa de verdade (MapLibre GL com os mapas do OpenFreeMap). Só é carregado
// quando alguém abre o mapa (import dinâmico): o MapLibre pesa ~1 MB.
import { Map as MapLibre, Marker, Popup, setWorkerUrl, type PositionAnchor } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { MapPin, MapView, StreetSpot } from '../../../../shared/protocol'

// O worker do MapLibre vem do próprio app: nada de blob:, a CSP continua fechada.
setWorkerUrl(workerUrl)

export interface LngLat {
  lng: number
  lat: number
}

export interface SharedMapEvents {
  /** A vista mudou por minha causa (arrastei, ou um voo que eu pedi): vai pros outros. */
  moved(view: MapView): void
  /** Mouse em cima do mapa (null: saiu dele). */
  pointer(at: LngLat | null): void
  /** Clique no modo de marcar, ou botão direito: onde pôr o marcador. */
  pick(at: LngLat): void
  /** Clique no mapa fora de qualquer marcador (fora do modo de marcar). */
  tapped(): void
  pinClicked(id: string): void
  /** Clicou no bonequinho de quem está no Street View (pra ir junto). */
  walkerClicked(connId: string): void
  /** Qualquer mudança da vista (minha ou dos outros), pra tela acompanhar. */
  changed(view: MapView): void
  loaded(): void
  /** O estilo do mapa não veio (sem internet, serviço fora). */
  failed(): void
}

/** Vista mandada no máximo a cada 80 ms (~12 por segundo) enquanto mexe, e a última ao parar. */
const SEND_EVERY = 80
const POINTER_EVERY = 100
/** Cursor parado por esse tempo some. */
const CURSOR_IDLE = 8000
/** A vista dos outros chegando em sequência: o mapa segue colado; depois de uma pausa, desliza. */
const FOLLOW_MS = 110
const SETTLE_MS = 420

const PIN_SVG =
  '<svg viewBox="0 0 28 36" aria-hidden="true"><path class="map-pin-body" d="M14 35s12-11.3 12-21A12 12 0 0 0 2 14c0 9.7 12 21 12 21z"/><circle class="map-pin-dot" cx="14" cy="14" r="4.5"/></svg>'
/** Bonequinho do Street View (pessoa em pé), com um cone pra onde está olhando. */
const WALKER_SVG =
  '<span class="map-walker-cone" aria-hidden="true"></span><span class="map-walker-body" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><path d="m9 20 3-6 3 6M6 8l6 2 6-2M12 10v4"/></svg></span>'

const CURSOR_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 2.5 17 8.9l-6.1 1.6L8.6 17z" stroke-linejoin="round"/></svg>'

/** Onde o cartão encosta no marcador (a gota tem 36 px de altura), pra cada lado em que couber. */
const CARD_OFFSET: Record<PositionAnchor, [number, number]> = {
  center: [0, 0],
  top: [0, 8],
  'top-left': [10, 6],
  'top-right': [-10, 6],
  bottom: [0, -44],
  'bottom-left': [10, -40],
  'bottom-right': [-10, -40],
  left: [18, -20],
  right: [-18, -20],
}

const isRemote = (e: unknown) => (e as { remote?: boolean }).remote === true
const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`
const viewKey = (v: MapView) => `${v.lng.toFixed(6)},${v.lat.toFixed(6)},${v.zoom.toFixed(3)},${v.bearing.toFixed(2)},${v.pitch.toFixed(2)}`

function pinElement(tag: 'button' | 'div', color: number): HTMLElement {
  const el = document.createElement(tag)
  el.className = 'map-pin'
  el.style.setProperty('--pin', hex(color))
  el.innerHTML = PIN_SVG
  return el
}

interface CursorMark {
  marker: Marker
  el: HTMLDivElement
  name: HTMLSpanElement
  from: LngLat
  to: LngLat
  now: LngLat
  start: number
  idle: ReturnType<typeof setTimeout> | null
}

/**
 * O mapa compartilhado na tela: manda a minha vista e segue a dos outros sem
 * brigar com a minha mão (enquanto eu mexo, a dos outros espera), desenha os
 * marcadores e os cursores de quem está junto.
 */
export class SharedMap {
  readonly map: MapLibre
  private style: string
  private loaded = false
  private pins = new Map<string, { marker: Marker; el: HTMLElement }>()
  private walkers = new Map<string, { marker: Marker; el: HTMLElement; name: HTMLElement }>()
  private cursors = new Map<string, CursorMark>()
  private selected: string | null = null
  private draft: Marker | null = null
  private card: Popup | null = null
  /** Botão do mouse apertado no mapa. */
  private pressing = false
  /** Movimento meu acontecendo (arrastando, zoom, voo que eu pedi). */
  private moving = false
  /** Vista dos outros que chegou enquanto eu mexia: vale quando eu soltar, se eu não tiver mexido. */
  private pending: MapView | null = null
  private remoteAt = 0
  private sentKey = ''
  private sentAt = 0
  private sendTimer: ReturnType<typeof setTimeout> | null = null
  private pointerAt = 0
  private pointerTimer: ReturnType<typeof setTimeout> | null = null
  private pointerNext: LngLat | null = null
  private frame = 0
  private placing = false

  constructor(
    container: HTMLElement,
    view: MapView,
    style: string,
    private events: SharedMapEvents,
  ) {
    this.style = style
    this.map = new MapLibre({
      container,
      style,
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      maxPitch: 85,
      attributionControl: { compact: true },
      // Rótulos aparecendo rápido: a vista dos outros chega a cada 80 ms.
      fadeDuration: 120,
    })
    this.sentKey = viewKey(view)

    const canvas = this.map.getCanvasContainer()
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('mouseleave', this.onLeave)
    window.addEventListener('pointerup', this.onUp)
    window.addEventListener('pointercancel', this.onUp)

    this.map.on('movestart', (e) => {
      if (isRemote(e)) return
      this.moving = true
      this.pending = null
    })
    this.map.on('move', (e) => {
      this.events.changed(this.view)
      if (!isRemote(e)) this.queueSend(false)
    })
    this.map.on('moveend', (e) => {
      this.events.changed(this.view)
      if (isRemote(e)) return
      this.moving = false
      this.queueSend(true)
      this.flushPending()
    })
    this.map.on('mousemove', (e) => this.queuePointer(e.lngLat.wrap()))
    this.map.on('click', (e) => {
      if (this.placing) this.events.pick(e.lngLat.wrap())
      else this.events.tapped()
    })
    // O MapLibre só manda depois de soltar o botão, e não se a pessoa girou o mapa arrastando.
    this.map.on('contextmenu', (e) => {
      e.preventDefault()
      this.events.pick(e.lngLat.wrap())
    })
    this.map.on('style.load', () => this.tint())
    this.map.once('load', () => {
      this.loaded = true
      this.events.loaded()
    })
    this.map.on('error', (e) => {
      console.warn('mapa:', e.error?.message ?? e)
      if (!this.loaded && !this.map.isStyleLoaded()) this.events.failed()
    })
  }

  get view(): MapView {
    const center = this.map.getCenter().wrap()
    return { lng: center.lng, lat: center.lat, zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch() }
  }

  // ---------- Vista: a minha vai, a dos outros vem ----------

  private onDown = () => {
    this.pressing = true
  }

  private onUp = () => {
    if (!this.pressing) return
    this.pressing = false
    this.flushPending()
  }

  private onLeave = () => {
    if (this.pointerTimer) clearTimeout(this.pointerTimer)
    this.pointerTimer = null
    this.pointerAt = performance.now()
    this.events.pointer(null)
  }

  private queueSend(done: boolean) {
    if (done) {
      if (this.sendTimer) clearTimeout(this.sendTimer)
      this.sendTimer = null
      return this.sendView()
    }
    if (this.sendTimer) return
    const wait = this.sentAt + SEND_EVERY - performance.now()
    if (wait <= 0) return this.sendView()
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null
      this.sendView()
    }, wait)
  }

  private sendView() {
    const view = this.view
    const key = viewKey(view)
    if (key === this.sentKey) return
    this.sentKey = key
    this.sentAt = performance.now()
    this.events.moved(view)
  }

  /** Vista de outra pessoa: o mapa vai atrás, a não ser que eu esteja mexendo nele. */
  follow(view: MapView, how: 'follow' | 'jump' = 'follow') {
    if (this.pressing || this.moving) {
      this.pending = view
      return
    }
    this.pending = null
    this.sentKey = viewKey(view)
    const camera = { center: [view.lng, view.lat] as [number, number], zoom: view.zoom, bearing: view.bearing, pitch: view.pitch }
    if (how === 'jump') return void this.map.jumpTo(camera, { remote: true })
    const now = performance.now()
    const streaming = now - this.remoteAt < 300
    this.remoteAt = now
    if (streaming) this.map.easeTo({ ...camera, duration: FOLLOW_MS, easing: (t) => t, essential: true }, { remote: true })
    else this.map.easeTo({ ...camera, duration: SETTLE_MS, essential: true }, { remote: true })
  }

  private flushPending() {
    if (this.pressing || this.moving || !this.pending) return
    const view = this.pending
    this.pending = null
    this.remoteAt = 0
    this.follow(view)
  }

  // ---------- Movimentos que eu peço (vão pros outros também) ----------

  flyTo(at: LngLat, zoom?: number) {
    this.map.flyTo({ center: [at.lng, at.lat], zoom: zoom ?? Math.max(this.map.getZoom(), 15), essential: true, speed: 1.6 })
  }

  fitBounds(bbox: [number, number, number, number]) {
    this.map.fitBounds(bbox, { padding: 64, maxZoom: 17, essential: true })
  }

  zoomBy(delta: number) {
    this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 220 })
  }

  resetNorth() {
    this.map.easeTo({ bearing: 0, pitch: 0, duration: 300 })
  }

  setStyle(style: string) {
    if (style === this.style) return
    this.style = style
    this.map.setStyle(style)
  }

  /** Tenta de novo depois de o estilo não ter vindo. */
  retry() {
    this.map.setStyle(this.style, { diff: false })
  }

  /** O escuro do OpenFreeMap puxado pro tom das superfícies do app (os cinzas dele são neutros). */
  private tint() {
    if (!this.style.endsWith('/dark')) return
    if (this.map.getLayer('background')) this.map.setPaintProperty('background', 'background-color', '#0f0f15')
    if (this.map.getLayer('water')) this.map.setPaintProperty('water', 'fill-color', '#191924')
  }

  setPlacing(on: boolean) {
    this.placing = on
    this.map.getCanvasContainer().classList.toggle('placing', on)
  }

  // ---------- Cursor: o meu vai, os dos outros aparecem ----------

  private queuePointer(at: LngLat) {
    this.pointerNext = at
    if (this.pointerTimer) return
    const wait = this.pointerAt + POINTER_EVERY - performance.now()
    const send = () => {
      this.pointerTimer = null
      this.pointerAt = performance.now()
      if (this.pointerNext) this.events.pointer({ lng: this.pointerNext.lng, lat: this.pointerNext.lat })
    }
    if (wait <= 0) send()
    else this.pointerTimer = setTimeout(send, wait)
  }

  /** Cursor de alguém (null: saiu de cima do mapa). Desliza até o ponto novo em vez de pular. */
  setCursor(connId: string, name: string, color: string, at: LngLat | null) {
    let c = this.cursors.get(connId)
    if (!at) {
      if (c) this.hideCursor(c)
      return
    }
    if (!c) {
      const el = document.createElement('div')
      el.className = 'map-cursor'
      el.innerHTML = CURSOR_SVG
      const label = document.createElement('span')
      label.className = 'map-cursor-name'
      el.append(label)
      c = {
        marker: new Marker({ element: el, anchor: 'top-left', offset: [-3, -2.5], subpixelPositioning: true }).setLngLat([at.lng, at.lat]).addTo(this.map),
        el,
        name: label,
        from: at,
        to: at,
        now: at,
        start: 0,
        idle: null,
      }
      this.cursors.set(connId, c)
    } else {
      c.from = c.now
      c.to = at
      c.start = performance.now()
      this.animate()
    }
    c.el.style.setProperty('--c', color)
    if (c.name.textContent !== name) c.name.textContent = name
    c.el.classList.remove('gone')
    if (c.idle) clearTimeout(c.idle)
    const mark = c
    c.idle = setTimeout(() => this.hideCursor(mark), CURSOR_IDLE)
  }

  private hideCursor(c: CursorMark) {
    if (c.idle) clearTimeout(c.idle)
    c.idle = null
    c.el.classList.add('gone')
  }

  /** Tira os cursores de quem saiu do mapa. */
  keepCursors(connIds: Set<string>) {
    for (const [connId, c] of this.cursors) {
      if (connIds.has(connId)) continue
      if (c.idle) clearTimeout(c.idle)
      c.marker.remove()
      this.cursors.delete(connId)
    }
  }

  private animate() {
    if (this.frame) return
    const step = () => {
      this.frame = 0
      const now = performance.now()
      let busy = false
      for (const c of this.cursors.values()) {
        if (c.now === c.to) continue
        const t = Math.min(1, (now - c.start) / POINTER_EVERY)
        c.now = t >= 1 ? c.to : { lng: c.from.lng + (c.to.lng - c.from.lng) * t, lat: c.from.lat + (c.to.lat - c.from.lat) * t }
        c.marker.setLngLat([c.now.lng, c.now.lat])
        busy ||= t < 1
      }
      if (busy) this.frame = requestAnimationFrame(step)
    }
    this.frame = requestAnimationFrame(step)
  }

  // ---------- Marcadores ----------

  setPins(pins: MapPin[]) {
    const wanted = new Set(pins.map((p) => p.id))
    for (const [id, { marker }] of this.pins) {
      if (wanted.has(id)) continue
      marker.remove()
      this.pins.delete(id)
    }
    for (const pin of pins) {
      if (this.pins.has(pin.id)) continue
      const el = pinElement('button', pin.color) as HTMLButtonElement
      el.type = 'button'
      el.setAttribute('aria-label', pin.label)
      const label = document.createElement('span')
      label.className = 'map-pin-label'
      label.textContent = pin.label
      el.append(label)
      el.addEventListener('click', (event) => {
        event.stopPropagation()
        this.events.pinClicked(pin.id)
      })
      el.classList.toggle('selected', pin.id === this.selected)
      const marker = new Marker({ element: el, anchor: 'bottom', subpixelPositioning: true }).setLngLat([pin.lng, pin.lat]).addTo(this.map)
      this.pins.set(pin.id, { marker, el })
    }
  }

  // ---------- Quem está no Street View ----------

  /** Um bonequinho com o nome no lugar onde cada um está olhando no Street View. */
  setWalkers(list: { connId: string; name: string; color: string; at: StreetSpot; mine: boolean }[]) {
    const wanted = new Set(list.map((w) => w.connId))
    for (const [connId, { marker }] of this.walkers) {
      if (wanted.has(connId)) continue
      marker.remove()
      this.walkers.delete(connId)
    }
    for (const walker of list) {
      let entry = this.walkers.get(walker.connId)
      if (!entry) {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'map-walker'
        el.innerHTML = WALKER_SVG
        const name = document.createElement('span')
        name.className = 'map-walker-name'
        el.append(name)
        const connId = walker.connId
        el.addEventListener('click', (event) => {
          event.stopPropagation()
          this.events.walkerClicked(connId)
        })
        const marker = new Marker({ element: el, anchor: 'bottom', subpixelPositioning: true }).setLngLat([walker.at.lng, walker.at.lat]).addTo(this.map)
        entry = { marker, el, name }
        this.walkers.set(walker.connId, entry)
      }
      entry.marker.setLngLat([walker.at.lng, walker.at.lat])
      entry.el.style.setProperty('--c', walker.color)
      entry.el.style.setProperty('--heading', `${walker.at.heading}deg`)
      entry.el.classList.toggle('mine', walker.mine)
      entry.el.setAttribute('aria-label', walker.mine ? 'Você no Street View' : `${walker.name} no Street View: ver junto`)
      const label = walker.mine ? 'Você' : walker.name
      if (entry.name.textContent !== label) entry.name.textContent = label
    }
  }

  select(id: string | null) {
    this.selected = id
    for (const [pinId, { el }] of this.pins) el.classList.toggle('selected', pinId === id)
  }

  /** Gota meio apagada onde o marcador novo vai ficar, enquanto a pessoa dá o nome. */
  setDraft(at: LngLat | null, color: number) {
    if (!at) {
      this.draft?.remove()
      this.draft = null
      return
    }
    if (!this.draft) {
      const el = pinElement('div', color)
      el.classList.add('draft')
      this.draft = new Marker({ element: el, anchor: 'bottom', subpixelPositioning: true })
    }
    this.draft.getElement().style.setProperty('--pin', hex(color))
    this.draft.setLngLat([at.lng, at.lat]).addTo(this.map)
  }

  /**
   * Cartão (o da tela, feito no Svelte) preso num lugar do mapa: acompanha quando
   * o mapa mexe e vira pro lado que couber. `content` null tira o cartão.
   */
  setCard(at: LngLat | null, content: HTMLElement | null) {
    if (!at || !content) {
      this.card?.remove()
      return
    }
    this.card ??= new Popup({
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: false,
      maxWidth: 'none',
      offset: CARD_OFFSET,
      className: 'map-card',
      padding: { top: 12, bottom: 12, left: 12, right: 12 },
    })
    this.card.setLngLat([at.lng, at.lat])
    if (content.parentElement === null || !this.card.isOpen()) this.card.setDOMContent(content)
    if (!this.card.isOpen()) this.card.addTo(this.map)
  }

  destroy() {
    if (this.sendTimer) clearTimeout(this.sendTimer)
    if (this.pointerTimer) clearTimeout(this.pointerTimer)
    if (this.frame) cancelAnimationFrame(this.frame)
    for (const c of this.cursors.values()) if (c.idle) clearTimeout(c.idle)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onUp)
    this.card?.remove()
    this.map.remove()
  }
}
