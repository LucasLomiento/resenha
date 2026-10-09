import type { ClientMessage, MapPin, MapView, MapViewer, ServerMessage, StreetSpot } from '../../../../shared/protocol'

type MapMessage = Extract<ServerMessage, { t: 'map.state' | 'map.viewers' | 'map.view' | 'map.cursor' | 'map.pin' | 'map.pin.removed' }>

/** Quem está com o mapa aberto (a tela do mapa) recebe o que muda a cada instante, fora do estado reativo. */
export interface MapListener {
  /** Chegou o estado inteiro: ao abrir, ou de novo depois de a conexão cair. */
  state(view: MapView | null, first: boolean): void
  view(view: MapView, userId: string): void
  cursor(connId: string, userId: string, at: { lng: number; lat: number } | null): void
}

/**
 * Estilos do OpenFreeMap (grátis, sem chave). Cada um escolhe o seu: não muda pros outros.
 * O nome de cada um fica no catálogo (`m.map.styles`).
 */
export const MAP_STYLES = {
  dark: { url: 'https://tiles.openfreemap.org/styles/dark' },
  positron: { url: 'https://tiles.openfreemap.org/styles/positron' },
  liberty: { url: 'https://tiles.openfreemap.org/styles/liberty' },
} as const

export type MapStyleName = keyof typeof MAP_STYLES

/** Cores dos marcadores (as primeiras dos degradês das pessoas, em `format.ts`). */
export const PIN_COLORS = [0x8b7bff, 0xff7a93, 0x48b9ff, 0x36d6ad, 0xffc35a, 0xee78dc]

/** Mostra "fulano está movendo o mapa" até esse tempo depois da última vista que chegou. */
const MOVER_FOR = 1200

/**
 * O mapa compartilhado de um servidor: quem está nele (aparece na lista de
 * canais), os marcadores e a vista que todo mundo vê. A vista e os cursores
 * chegam muitas vezes por segundo e vão direto pra tela do mapa (`MapListener`).
 */
export class GuildMap {
  /** Conexões com o mapa aberto, na ordem em que entraram. */
  viewers = $state<MapViewer[]>([])
  pins = $state<MapPin[]>([])
  /** Já chegou o estado desde que abri. */
  loaded = $state(false)
  /** Quem está mexendo no mapa agora. */
  mover = $state<string | null>(null)

  private listener: MapListener | null = null
  private moverTimer: ReturnType<typeof setTimeout> | null = null

  /** `quiet`: sem aviso de "sem conexão" (vista e cursor vão muitas vezes por segundo). */
  constructor(private send: (msg: ClientMessage, quiet?: boolean) => boolean) {}

  /** Pessoas no mapa, sem repetir (a mesma pessoa pode estar em dois aparelhos). */
  get people(): string[] {
    return [...new Set(this.viewers.map((v) => v.userId))]
  }

  get open(): boolean {
    return this.listener !== null
  }

  join(listener: MapListener) {
    this.listener = listener
    this.loaded = false
    this.send({ t: 'map.join' }, true)
  }

  leave() {
    if (!this.listener) return
    this.listener = null
    this.loaded = false
    this.setMover(null)
    this.send({ t: 'map.leave' }, true)
  }

  /** A conexão (re)abriu: com o mapa aberto, pede o estado de novo; fechado, garante que saiu. */
  ready(viewers: MapViewer[], connId: string) {
    this.viewers = viewers
    if (this.listener) this.send({ t: 'map.join' }, true)
    else if (viewers.some((v) => v.connId === connId)) this.send({ t: 'map.leave' }, true)
  }

  handle(msg: MapMessage) {
    switch (msg.t) {
      case 'map.viewers':
        this.viewers = msg.viewers
        return

      case 'map.state': {
        this.viewers = msg.viewers
        if (!this.listener) return
        this.pins = msg.pins
        const first = !this.loaded
        this.loaded = true
        this.listener.state(msg.view, first)
        return
      }

      case 'map.view':
        if (!this.listener) return
        this.setMover(msg.userId)
        this.listener.view(msg.view, msg.userId)
        return

      case 'map.cursor':
        this.listener?.cursor(msg.connId, msg.userId, msg.lng === null || msg.lat === null ? null : { lng: msg.lng, lat: msg.lat })
        return

      case 'map.pin':
        if (this.listener && !this.pins.some((p) => p.id === msg.pin.id)) this.pins = [...this.pins, msg.pin]
        return

      case 'map.pin.removed':
        this.pins = this.pins.filter((p) => p.id !== msg.id)
        return
    }
  }

  private setMover(userId: string | null) {
    if (this.moverTimer) clearTimeout(this.moverTimer)
    this.moverTimer = userId ? setTimeout(() => (this.mover = null), MOVER_FOR) : null
    if (this.mover !== userId) this.mover = userId
  }

  // ---------- Ações ----------

  moveTo(view: MapView) {
    this.send({ t: 'map.view', view }, true)
  }

  cursor(at: { lng: number; lat: number } | null) {
    this.send({ t: 'map.cursor', lng: at?.lng ?? null, lat: at?.lat ?? null }, true)
  }

  addPin(lng: number, lat: number, label: string, color: number): boolean {
    return this.send({ t: 'map.pin.add', lng, lat, label, color })
  }

  removePin(id: string) {
    this.send({ t: 'map.pin.remove', id })
  }

  /** Abri (ou fechei) o Street View: os outros veem onde estou olhando. */
  street(at: StreetSpot | null) {
    this.send({ t: 'map.street', at })
  }
}

/**
 * Street View do Google dentro do app, sem chave: é a mesma incorporação que o
 * Google oferece em "Compartilhar → Incorporar um mapa". Acha a foto mais perto do ponto.
 */
export function streetEmbedUrl(at: StreetSpot): string {
  const n = (v: number, digits: number) => Number(v.toFixed(digits))
  return `https://www.google.com/maps/embed?origin=mfe&pb=!6m7!1m6!2m2!1d${n(at.lat, 6)}!2d${n(at.lng, 6)}!3f${n(at.heading, 1)}!4f0!5f0.8`
}

/** O mesmo lugar no Google Maps (no navegador), já no Street View. */
export function streetPageUrl(at: StreetSpot): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at.lat.toFixed(6)},${at.lng.toFixed(6)}&heading=${Math.round(at.heading)}`
}
