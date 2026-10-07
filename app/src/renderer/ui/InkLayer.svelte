<script lang="ts">
  import { onDestroy } from 'svelte'
  import { videoBox, type InkMessage, type InkScreen, type InkTool } from '../lib/ink.svelte'

  /**
   * Camada pra rabiscar por cima da transmissão de alguém. Arrastar desenha
   * (laser ou caneta), clicar rápido manda um "ping". Os traços vão pra quem
   * compartilha, que mostra no monitor dele.
   *
   * O monitor de lá entra na transmissão, então o meu traço volta pra mim no vídeo,
   * atrasado. Pra não ver dobrado, desenho aqui o mesmo traço, no mesmo lugar, do
   * mesmo jeito que a camada de lá (ink-overlay.py), um pouco mais grosso e durando
   * um pouco mais: a cópia atrasada fica escondida embaixo. O ping não tem eco (ele
   * anima, e duas animações defasadas não se escondem): aparece só pelo vídeo.
   *
   * Fica montada enquanto houver traço meu na tela, mesmo fora do modo de rabiscar
   * (`active`), senão a cópia atrasada apareceria ao sair.
   */
  let {
    video,
    tool,
    color,
    name,
    screen,
    active,
    cleared,
    onsend,
  }: {
    video: HTMLVideoElement
    tool: InkTool
    color: string
    name: string
    /** Tamanho do monitor de lá (sem ele, conta como 1080p ou maior). */
    screen?: InkScreen
    /** No modo de rabiscar (pega o mouse). */
    active: boolean
    /** Muda quando quem compartilha apaga tudo ou desliga: o eco some junto. */
    cleared: number
    onsend: (msg: InkMessage) => void
  } = $props()

  /** Até onde um clique ainda é "ping" (se mexer mais ou segurar mais, vira traço). */
  const TAP_PX = 6
  const TAP_MS = 250
  /** De quanto em quanto tempo os pontos novos vão. */
  const SEND_EVERY = 33
  // Os tempos da camada de lá (ink-overlay.py e a janela do main/ink.ts)...
  const PEN_LIFE = 6
  const PEN_FADE = 0.8
  const LASER_TRAIL = 0.7
  const NAME_LIFE = 1.6
  // ...mais a folga pro atraso do vídeo (a cópia de lá chega até isso depois).
  const LATE = 0.5
  /** Pixels a mais de cada lado, pra cobrir o borrado da compressão em volta da cópia. */
  const COVER = 1

  type Point = [x: number, y: number, t: number]
  interface Stroke {
    tool: InkTool
    points: Point[]
    ended: number | null
    updated: number
  }

  let canvas = $state<HTMLCanvasElement>()
  let drawing: { id: string; start: { x: number; y: number; t: number }; pending: number[]; stroking: boolean } | null = null
  let flushTimer: ReturnType<typeof setInterval> | null = null
  const strokes = new Map<string, Stroke>()
  let frame = 0

  const now = () => performance.now() / 1000

  $effect(() => {
    void cleared
    strokes.clear()
    wake()
  })

  /** Ponto do mouse em 0..1 dentro da imagem (a resolução de cada um não importa). */
  function point(event: PointerEvent): { x: number; y: number } {
    const box = videoBox(video)
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    }
  }

  function down(event: PointerEvent) {
    if (!active || event.button !== 0) return
    event.preventDefault()
    canvas?.setPointerCapture(event.pointerId)
    const at = point(event)
    const id = crypto.randomUUID().slice(0, 12)
    drawing = { id, start: { ...at, t: performance.now() }, pending: [at.x, at.y], stroking: false }
  }

  function move(event: PointerEvent) {
    const d = drawing
    if (!d) return
    const at = point(event)
    d.pending.push(at.x, at.y)
    if (!d.stroking) {
      const box = videoBox(video)
      const dx = (at.x - d.start.x) * box.width
      const dy = (at.y - d.start.y) * box.height
      if (Math.hypot(dx, dy) <= TAP_PX && performance.now() - d.start.t <= TAP_MS) return
      // Virou traço: o eco começa com todos os pontos até aqui.
      d.stroking = true
      const t = now()
      const points: Point[] = []
      for (let i = 0; i + 1 < d.pending.length; i += 2) points.push([d.pending[i], d.pending[i + 1], t])
      strokes.set(d.id, { tool, points, ended: null, updated: t })
      flushTimer = setInterval(flush, SEND_EVERY)
      flush()
    } else {
      const s = strokes.get(d.id)
      if (s) {
        s.points.push([at.x, at.y, now()])
        s.updated = now()
      }
    }
    wake()
  }

  function up() {
    const d = drawing
    if (!d) return
    drawing = null
    if (flushTimer) clearInterval(flushTimer)
    flushTimer = null
    if (!d.stroking) {
      onsend({ t: 'ink.ping', x: d.start.x, y: d.start.y })
      return
    }
    onsend({ t: 'ink.stroke', id: d.id, tool: strokes.get(d.id)?.tool ?? tool, points: d.pending, end: true })
    const s = strokes.get(d.id)
    if (s) s.ended = s.updated = now()
    wake()
  }

  function flush() {
    const d = drawing
    if (!d || d.pending.length === 0) return
    onsend({ t: 'ink.stroke', id: d.id, tool: strokes.get(d.id)?.tool ?? tool, points: d.pending })
    d.pending = []
  }

  function wake() {
    if (!frame) frame = requestAnimationFrame(draw)
  }

  /** Some de vez (com a folga do atraso). */
  function gone(s: Stroke, t: number): boolean {
    if (s.tool === 'laser') return (s.ended !== null && t - s.ended > LASER_TRAIL + LATE) || t - s.updated > 5
    const last = s.ended ?? s.updated
    return t - last > PEN_LIFE + PEN_FADE + LATE + (s.ended === null ? 30 : 0)
  }

  function draw() {
    frame = 0
    const c = canvas
    if (!c) return
    const ratio = devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    if (c.width !== Math.round(rect.width * ratio) || c.height !== Math.round(rect.height * ratio)) {
      c.width = Math.round(rect.width * ratio)
      c.height = Math.round(rect.height * ratio)
    }
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.clearRect(0, 0, rect.width, rect.height)
    const box = videoBox(video)
    const ox = box.left - rect.left
    const oy = box.top - rect.top
    const X = (p: Point) => ox + p[0] * box.width
    const Y = (p: Point) => oy + p[1] * box.height
    // A "unidade" da camada de lá (1 px a cada 1080 de altura, nunca menos de 1), em pixels daqui.
    const side = screen ? Math.min(screen.width, screen.height) : 1080
    const u = (Math.max(1, side / 1080) * Math.min(box.width, box.height)) / side
    const t = now()

    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const [id, s] of strokes) {
      if (gone(s, t)) {
        strokes.delete(id)
        continue
      }
      if (s.tool === 'laser') drawLaser(g, s, t, u, X, Y)
      else drawPen(g, s, t, u, X, Y)
    }
    // O nome fica parado no começo do traço (lá também), então a cópia de lá cai embaixo deste.
    for (const s of strokes.values()) {
      if (t - s.updated >= NAME_LIFE + LATE || !s.points.length) continue
      const alpha = s.tool === 'pen' || s.ended === null ? 1 : Math.max(0, 1 - (t - s.ended) / (LASER_TRAIL + LATE))
      label(g, X(s.points[0]), Y(s.points[0]), u, alpha)
    }
    g.globalAlpha = 1
    if (strokes.size || drawing) frame = requestAnimationFrame(draw)
  }

  function drawPen(g: CanvasRenderingContext2D, s: Stroke, t: number, u: number, X: (p: Point) => number, Y: (p: Point) => number) {
    const pts = s.points
    const age = s.ended === null ? 0 : t - s.ended
    const alpha = age > PEN_LIFE + LATE ? Math.max(0, 1 - (age - PEN_LIFE - LATE) / PEN_FADE) : 1
    if (alpha <= 0 || !pts.length) return
    if (pts.length === 1) {
      g.globalAlpha = alpha
      g.fillStyle = color
      g.beginPath()
      g.arc(X(pts[0]), Y(pts[0]), 3.2 * u + COVER, 0, Math.PI * 2)
      g.fill()
      return
    }
    for (const [width, style, a] of [
      [8 * u + 2 * COVER, '#000', 0.45],
      [4.8 * u + 2 * COVER, color, 1],
    ] as const) {
      g.globalAlpha = a * alpha
      g.strokeStyle = style
      g.lineWidth = width
      g.beginPath()
      g.moveTo(X(pts[0]), Y(pts[0]))
      for (const p of pts.slice(1)) g.lineTo(X(p), Y(p))
      g.stroke()
    }
  }

  function drawLaser(g: CanvasRenderingContext2D, s: Stroke, t: number, u: number, X: (p: Point) => number, Y: (p: Point) => number) {
    const life = LASER_TRAIL + LATE
    const live = s.points.filter((p) => t - p[2] < life)
    // Grossura fixa (lá ela afina na cauda): assim cobre a cópia, que chega mais grossa no mesmo ponto.
    for (let i = 1; i < live.length; i++) {
      const fade = Math.max(0, 1 - (t - live[i][2]) / life)
      for (const [width, a] of [
        [14 * u, 0.18],
        [5.5 * u + 2 * COVER, 0.95],
      ] as const) {
        g.globalAlpha = a * fade
        g.strokeStyle = color
        g.lineWidth = width
        g.beginPath()
        g.moveTo(X(live[i - 1]), Y(live[i - 1]))
        g.lineTo(X(live[i]), Y(live[i]))
        g.stroke()
      }
    }
    const tip = live.at(-1)
    if (tip && s.ended === null) {
      g.globalAlpha = 0.95
      g.fillStyle = '#fff'
      g.beginPath()
      g.arc(X(tip), Y(tip), 2.4 * u, 0, Math.PI * 2)
      g.fill()
    }
  }

  /** A etiqueta com o nome, igual à de lá e um pouco maior (opaca, pra cobrir). */
  function label(g: CanvasRenderingContext2D, x: number, y: number, u: number, alpha: number) {
    if (!name || alpha <= 0) return
    g.font = `bold ${13 * u}px sans-serif`
    const padX = 7 * u
    const padY = 4 * u
    const w = g.measureText(name).width + 2 * padX + 2 * COVER + 2
    const h = 13 * u + 2 * padY + 2 * COVER
    const left = x + 12 * u - COVER - 1
    const top = y + 12 * u - COVER
    g.globalAlpha = alpha
    g.fillStyle = color
    g.beginPath()
    g.roundRect(left, top, w, h, h / 2)
    g.fill()
    g.globalAlpha = 0.9 * alpha
    g.fillStyle = '#0d0b17'
    g.fillText(name, left + COVER + 1 + padX, top + COVER + padY + 13 * u * 0.8)
  }

  onDestroy(() => {
    if (flushTimer) clearInterval(flushTimer)
    if (frame) cancelAnimationFrame(frame)
    if (drawing?.stroking) onsend({ t: 'ink.stroke', id: drawing.id, tool, points: drawing.pending, end: true })
  })
</script>

<canvas
  bind:this={canvas}
  class="ink-layer"
  class:active
  aria-label={active ? 'Rabiscar na tela' : undefined}
  aria-hidden={!active}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
></canvas>

<style>
  .ink-layer {
    position: absolute;
    inset: 0;
    z-index: 3;
    width: 100%;
    height: 100%;
    pointer-events: none;
    touch-action: none;
  }

  .ink-layer.active {
    pointer-events: auto;
    cursor: crosshair;
  }
</style>
