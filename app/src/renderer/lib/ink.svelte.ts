// Rabiscos na tela de quem compartilha (como nas chamadas do Slack).
//
// Quem assiste desenha por cima da transmissão; os traços vão direto pra quem
// compartilha (canal de dados da conexão P2P), com as posições de 0 a 1 em
// relação à tela inteira, então a resolução de cada um não importa. Quem
// compartilha mostra tudo numa camada por cima do monitor (main/ink.ts), e
// como ela está no monitor transmitido, todo mundo que assiste vê na própria
// transmissão. Só vale compartilhando o monitor inteiro.

import type { InkMonitor } from '../../preload/api'
import { settings } from './settings.svelte'

export type InkTool = 'laser' | 'pen'

/** O que vai pelo canal de dados entre quem assiste e quem compartilha. */
export type InkMessage =
  /** Quem compartilha avisa se dá pra rabiscar (monitor inteiro, camada aberta, permitido). */
  | { t: 'ink.policy'; allowed: boolean }
  /** Pedaço de um traço: pontos novos (x, y, x, y...) desde o último pedaço. */
  | { t: 'ink.stroke'; id: string; tool: InkTool; points: number[]; end?: boolean }
  | { t: 'ink.ping'; x: number; y: number }

/** Situação dos rabiscos pra quem compartilha. */
export type InkStatus =
  /** Não está compartilhando. */
  | 'off'
  /** Desligado nas opções da transmissão. */
  | 'disabled'
  /** Compartilhando uma janela (só funciona com o monitor inteiro). */
  | 'window'
  /** O sistema não tem como desenhar por cima da tela (GNOME, falta o gtk4-layer-shell). */
  | 'unsupported'
  /** Mais de um monitor possível: pergunta em qual. */
  | 'choose'
  | 'starting'
  | 'on'
  | 'failed'

const MAX_POINTS = 400
/** Mensagens por segundo que cada pessoa pode mandar (o resto é jogado fora). */
const MAX_RATE = 90

const unit = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null

/** O que chegou de quem assiste, conferido (nunca confia no outro lado). */
export function cleanInk(raw: unknown): InkMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const msg = raw as Record<string, unknown>
  if (msg.t === 'ink.policy') return { t: 'ink.policy', allowed: msg.allowed === true }
  if (msg.t === 'ink.ping') {
    const x = unit(msg.x)
    const y = unit(msg.y)
    return x === null || y === null ? null : { t: 'ink.ping', x, y }
  }
  if (msg.t === 'ink.stroke' && typeof msg.id === 'string' && Array.isArray(msg.points)) {
    const points: number[] = []
    for (const v of msg.points.slice(0, MAX_POINTS * 2)) {
      const n = unit(v)
      if (n === null) return null
      points.push(n)
    }
    if (points.length % 2) points.pop()
    return { t: 'ink.stroke', id: msg.id.slice(0, 24), tool: msg.tool === 'pen' ? 'pen' : 'laser', points, end: msg.end === true }
  }
  return null
}

/**
 * Lado de quem compartilha: descobre o monitor, abre a camada e repassa os
 * traços de quem assiste com o nome e a cor de cada um.
 */
export class InkShare {
  status = $state<InkStatus>('off')
  monitors = $state.raw<InkMonitor[]>([])
  monitor = $state.raw<InkMonitor | null>(null)
  private track: MediaStreamTrack | null = null
  private rate = new Map<string, number[]>()

  /** `changed`: a permissão mudou (avisa quem assiste). */
  constructor(private changed: () => void) {
    window.resenha?.ink.onClosed(() => {
      if (this.status === 'on') this.set('failed')
    })
  }

  /** Dá pra rabiscar agora (vai pra quem assiste no `ink.policy`). */
  get allowed(): boolean {
    return this.status === 'on'
  }

  /** Começou a compartilhar: vê se é o monitor inteiro e abre a camada no monitor certo. */
  async begin(track: MediaStreamTrack) {
    this.track = track
    const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface
    if (surface === 'window' || surface === 'browser') return this.set('window')
    if (!settings.inkAllowed) return this.set('disabled')
    const monitors = await window.resenha.ink.monitors()
    if (this.track !== track) return
    if (!monitors) return this.set('unsupported')
    this.monitors = [...monitors].sort((a, b) => a.x - b.x || a.y - b.y)
    const pick = this.pick(track)
    if (pick) await this.open(pick)
    else this.set('choose')
  }

  /** O monitor mais provável: o único, o único com o mesmo formato da transmissão, ou o último escolhido. */
  private pick(track: MediaStreamTrack): InkMonitor | null {
    const all = this.monitors
    if (all.length === 1) return all[0]
    const { width, height } = track.getSettings()
    const ratio = width && height ? width / height : null
    const shaped = ratio ? all.filter((m) => Math.abs(m.width / m.height - ratio) / ratio < 0.02) : all
    if (shaped.length === 1) return shaped[0]
    const remembered = all.find((m) => m.connector === settings.inkMonitor)
    return remembered && (shaped.length === 0 || shaped.includes(remembered)) ? remembered : null
  }

  /** Escolheu (ou trocou) o monitor no painel da transmissão. */
  async choose(connector: string) {
    const monitor = this.monitors.find((m) => m.connector === connector)
    if (!monitor || !this.track) return
    settings.inkMonitor = connector
    await this.open(monitor)
  }

  private async open(monitor: InkMonitor) {
    const track = this.track
    this.monitor = monitor
    this.set('starting')
    const result = await window.resenha.ink.start(monitor.connector)
    if (this.track !== track) {
      if (result.ok) window.resenha.ink.stop()
      return
    }
    if (!result.ok) console.error('rabiscos: a camada não abriu', result.error)
    this.set(result.ok ? 'on' : result.error === 'unsupported' ? 'unsupported' : 'failed')
  }

  /** Ligou ou desligou nas opções da transmissão. */
  async setEnabled(enabled: boolean) {
    settings.inkAllowed = enabled
    if (!this.track) return
    if (!enabled) {
      window.resenha.ink.stop()
      return this.set('disabled')
    }
    await this.begin(this.track)
  }

  end() {
    this.track = null
    this.monitor = null
    this.rate.clear()
    window.resenha.ink.stop()
    this.set('off')
  }

  /** Apaga tudo (botão de quem compartilha). */
  clear() {
    if (this.status === 'on') window.resenha.ink.event({ t: 'clear' })
  }

  /** Traço ou ping de alguém que assiste (`connId`), já conferido. */
  receive(connId: string, name: string, color: string, msg: InkMessage) {
    if (this.status !== 'on' || msg.t === 'ink.policy' || !this.within(connId)) return
    if (msg.t === 'ink.ping') {
      window.resenha.ink.event({ t: 'ping', x: msg.x, y: msg.y, name, color })
      return
    }
    window.resenha.ink.event({
      t: 'stroke',
      id: `${connId}:${msg.id}`,
      author: connId,
      name,
      color,
      tool: msg.tool,
      points: msg.points,
      end: !!msg.end,
    })
  }

  private within(connId: string): boolean {
    const now = Date.now()
    const recent = (this.rate.get(connId) ?? []).filter((t) => now - t < 1000)
    if (recent.length >= MAX_RATE) return false
    recent.push(now)
    this.rate.set(connId, recent)
    return true
  }

  private set(status: InkStatus) {
    const before = this.allowed
    this.status = status
    if (this.allowed !== before) this.changed()
  }
}

/** Retângulo onde a imagem aparece de verdade no <video> (sem as faixas pretas do "contain"). */
export function videoBox(video: HTMLVideoElement): { left: number; top: number; width: number; height: number } {
  const r = video.getBoundingClientRect()
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return { left: r.left, top: r.top, width: r.width, height: r.height }
  const scale = Math.min(r.width / vw, r.height / vh)
  const width = vw * scale
  const height = vh * scale
  return { left: r.left + (r.width - width) / 2, top: r.top + (r.height - height) / 2, width, height }
}
