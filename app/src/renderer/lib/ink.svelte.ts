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

/** Por que não dá pra rabiscar agora (vai pra quem assiste, pra explicar o lápis apagado). */
export type InkBlocked = 'disabled' | 'window' | 'unsupported' | 'choose' | 'starting' | 'failed'

/** Tamanho do monitor de quem compartilha (pra quem desenha imitar a grossura do traço de lá). */
export interface InkScreen {
  width: number
  height: number
}

/** O que vai pelo canal de dados entre quem assiste e quem compartilha. */
export type InkMessage =
  /** Quem compartilha avisa se dá pra rabiscar (monitor inteiro, camada aberta, permitido). */
  | { t: 'ink.policy'; allowed: boolean; reason?: InkBlocked; screen?: InkScreen }
  /** Pedaço de um traço: pontos novos (x, y, x, y...) desde o último pedaço. */
  | { t: 'ink.stroke'; id: string; tool: InkTool; points: number[]; end?: boolean }
  | { t: 'ink.ping'; x: number; y: number }
  /** Quem compartilha apagou tudo (quem desenha apaga o próprio eco também). */
  | { t: 'ink.clear' }

export type InkPolicy = Omit<Extract<InkMessage, { t: 'ink.policy' }>, 't'>

const BLOCKED: InkBlocked[] = ['disabled', 'window', 'unsupported', 'choose', 'starting', 'failed']

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
/** Quadradinho que a camada desenha no canto pra achar o monitor transmitido (PROBE_SIZE do ink-overlay.py). */
const PROBE = 48
/** Quanto esperar o quadradinho aparecer na captura antes de tentar o próximo monitor. */
const PROBE_WAIT = 1200
/** Diferença de formato (largura/altura) que ainda conta como "a imagem é esse monitor". */
const SAME_SHAPE = 0.01
/** Mensagens por segundo que cada pessoa pode mandar (o resto é jogado fora). */
const MAX_RATE = 90

const unit = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null

/** O que chegou de quem assiste, conferido (nunca confia no outro lado). */
export function cleanInk(raw: unknown): InkMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const msg = raw as Record<string, unknown>
  if (msg.t === 'ink.policy') {
    const reason = BLOCKED.find((r) => r === msg.reason)
    const screen = msg.screen as Record<string, unknown> | undefined
    const size = (v: unknown) => (typeof v === 'number' && v >= 100 && v <= 20_000 ? v : null)
    const width = size(screen?.width)
    const height = size(screen?.height)
    return {
      t: 'ink.policy',
      allowed: msg.allowed === true,
      ...(reason ? { reason } : {}),
      ...(width && height ? { screen: { width, height } } : {}),
    }
  }
  if (msg.t === 'ink.clear') return { t: 'ink.clear' }
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

  /** `emit`: manda pra todo mundo que assiste (permissão mudou, apagou tudo). */
  constructor(private emit: (msg: InkMessage) => void) {
    window.resenha?.ink.onClosed(() => {
      if (this.status === 'on') this.set('failed')
    })
  }

  /** Dá pra rabiscar agora (vai pra quem assiste no `ink.policy`). */
  get allowed(): boolean {
    return this.status === 'on'
  }

  /** O que quem assiste precisa saber: pode ou não (e por quê), e o tamanho do monitor. */
  policy(): InkMessage {
    const status = this.status
    if (status === 'on') {
      const m = this.monitor
      return { t: 'ink.policy', allowed: true, ...(m ? { screen: { width: m.width, height: m.height } } : {}) }
    }
    return { t: 'ink.policy', allowed: false, ...(status !== 'off' ? { reason: status } : {}) }
  }

  /**
   * Começou a compartilhar: vê se é um monitor inteiro e abre a camada no monitor certo.
   *
   * O tipo da captura não ajuda no Wayland: lá o Electron diz "janela" até pra monitor
   * inteiro (o portal não conta o que foi escolhido). Então vale o formato da imagem:
   * igual ao de um monitor, é esse monitor (ou uma janela em tela cheia nele, que dá no
   * mesmo). Com mais de um monitor desse formato, a camada pisca um quadradinho no canto
   * de cada um até ele aparecer na captura.
   */
  async begin(track: MediaStreamTrack) {
    this.track = track
    const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface
    if (surface === 'browser') return this.set('window')
    if (!settings.inkAllowed) return this.set('disabled')
    this.set('starting')
    const monitors = await window.resenha.ink.monitors()
    if (this.track !== track) return
    if (!monitors) return this.set('unsupported')
    this.monitors = [...monitors].sort((a, b) => a.x - b.x || a.y - b.y)
    const reader = new FrameReader(track)
    try {
      const size = await reader.size()
      if (this.track !== track) return
      const candidates = this.candidates(surface, size)
      if (candidates.length === 0) return this.set('window')
      if (candidates.length === 1) return await this.open(candidates[0])
      const remembered = candidates.find((m) => m.connector === settings.inkMonitor)
      if (size) {
        const ordered = remembered ? [remembered, ...candidates.filter((m) => m !== remembered)] : candidates
        for (const monitor of ordered) {
          const result = await this.probe(reader, monitor, track)
          if (this.track !== track || result === 'found' || result === 'stop') return
        }
        window.resenha.ink.stop()
      }
      // Não deu pra descobrir (a captura não mostra a camada?): o último escolhido, ou pergunta.
      if (remembered) await this.open(remembered)
      else {
        this.monitor = null
        this.set('choose')
      }
    } finally {
      reader.close()
    }
  }

  /** Monitores que podem ser a imagem transmitida (pelo formato; sem quadros, todos). */
  private candidates(surface: string | undefined, size: { width: number; height: number } | null): InkMonitor[] {
    const all = this.monitors
    if (!size) return all
    const ratio = size.width / size.height
    const shaped = all.filter((m) => Math.abs(m.width / m.height - ratio) / ratio < SAME_SHAPE)
    // Monitor de verdade (Windows/X11) com formato estranho (escala?): qualquer um serve.
    return shaped.length === 0 && surface === 'monitor' ? all : shaped
  }

  /** Abre a camada nesse monitor e procura o quadradinho dela na captura. */
  private async probe(reader: FrameReader, monitor: InkMonitor, track: MediaStreamTrack): Promise<'found' | 'missing' | 'stop'> {
    this.monitor = monitor
    const result = await window.resenha.ink.start(monitor.connector)
    if (this.track !== track) {
      if (result.ok) window.resenha.ink.stop()
      return 'stop'
    }
    if (!result.ok) {
      console.error('rabiscos: a camada não abriu', result.error)
      this.set(result.error === 'unsupported' ? 'unsupported' : 'failed')
      return 'stop'
    }
    // Canto já dessa cor antes do quadradinho: não dá pra saber por aqui.
    if (reader.marked(monitor)) return 'missing'
    window.resenha.ink.event({ t: 'probe', on: true })
    const until = performance.now() + PROBE_WAIT
    let found = false
    while (!found && performance.now() < until && this.track === track) {
      await new Promise((r) => setTimeout(r, 40))
      found = reader.marked(monitor)
    }
    window.resenha.ink.event({ t: 'probe', on: false })
    if (this.track !== track) return 'stop'
    if (!found) return 'missing'
    settings.inkMonitor = monitor.connector
    this.set('on')
    return 'found'
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
    if (this.status !== 'on') return
    window.resenha.ink.event({ t: 'clear' })
    this.emit({ t: 'ink.clear' })
  }

  /** Traço ou ping de alguém que assiste (`connId`), já conferido. */
  receive(connId: string, name: string, color: string, msg: InkMessage) {
    if (this.status !== 'on' || msg.t === 'ink.policy' || msg.t === 'ink.clear' || !this.within(connId)) return
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
    if (this.status === status) return
    this.status = status
    this.emit(this.policy())
  }
}

/** Lê a própria captura: o tamanho de verdade dos quadros e a cor do canto de cima à esquerda. */
class FrameReader {
  private video = document.createElement('video')
  private canvas = document.createElement('canvas')

  constructor(track: MediaStreamTrack) {
    this.video.muted = true
    this.video.srcObject = new MediaStream([track])
    this.video.play().catch(() => {})
    this.canvas.width = this.canvas.height = 4
  }

  /** Tamanho dos quadros (null se nenhum chegou a tempo). */
  async size(timeout = 3000): Promise<{ width: number; height: number } | null> {
    const until = performance.now() + timeout
    while (performance.now() < until) {
      if (this.video.videoWidth > 0) return { width: this.video.videoWidth, height: this.video.videoHeight }
      await new Promise((r) => setTimeout(r, 40))
    }
    return null
  }

  /** O quadradinho da camada aparece no canto da imagem (olhando o meio dele, que escala e compressão não borram)? */
  marked(monitor: InkMonitor): boolean {
    const g = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!g || !this.video.videoWidth) return false
    const side = (PROBE * this.video.videoWidth) / monitor.width
    g.drawImage(this.video, side * 0.25, side * 0.25, side * 0.5, side * 0.5, 0, 0, 4, 4)
    const data = g.getImageData(0, 0, 4, 4).data
    let r = 0
    let green = 0
    let b = 0
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]
      green += data[i + 1]
      b += data[i + 2]
    }
    const n = data.length / 4
    return r / n > 190 && green / n < 80 && b / n > 190
  }

  close() {
    this.video.pause()
    this.video.srcObject = null
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
