<script lang="ts">
  import { onDestroy } from 'svelte'
  import { videoBox, type InkMessage, type InkTool } from '../lib/ink.svelte'

  /**
   * Camada pra rabiscar por cima da transmissão de alguém. Arrastar desenha
   * (laser ou caneta), clicar rápido manda um "ping". Os traços vão pra quem
   * compartilha, que mostra no monitor dele; a gente vê pela própria
   * transmissão. Aqui fica só um eco curtinho, pra resposta ser na hora.
   */
  let {
    video,
    tool,
    color,
    onsend,
  }: {
    video: HTMLVideoElement
    tool: InkTool
    color: string
    onsend: (msg: InkMessage) => void
  } = $props()

  /** Até onde um clique ainda é "ping" (se mexer mais ou segurar mais, vira traço). */
  const TAP_PX = 6
  const TAP_MS = 250
  /** De quanto em quanto tempo os pontos novos vão. */
  const SEND_EVERY = 33
  /** Quanto tempo o eco do meu traço fica na tela (depois a transmissão mostra o de verdade). */
  const ECHO = 0.45

  let canvas = $state<HTMLCanvasElement>()
  let drawing: { id: string; start: { x: number; y: number; t: number }; pending: number[]; stroking: boolean } | null = null
  let flushTimer: ReturnType<typeof setInterval> | null = null
  const echo: { x: number; y: number; t: number }[] = []
  const pings: { x: number; y: number; t: number }[] = []
  let frame = 0

  const now = () => performance.now() / 1000

  /** Ponto do mouse em 0..1 dentro da imagem (a resolução de cada um não importa). */
  function point(event: PointerEvent): { x: number; y: number } {
    const box = videoBox(video)
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    }
  }

  function down(event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    canvas?.setPointerCapture(event.pointerId)
    const at = point(event)
    drawing = { id: crypto.randomUUID().slice(0, 12), start: { ...at, t: performance.now() }, pending: [at.x, at.y], stroking: false }
    echo.push({ ...at, t: now() })
    wake()
  }

  function move(event: PointerEvent) {
    const d = drawing
    if (!d) return
    const at = point(event)
    d.pending.push(at.x, at.y)
    echo.push({ ...at, t: now() })
    wake()
    if (!d.stroking) {
      const box = videoBox(video)
      const dx = (at.x - d.start.x) * box.width
      const dy = (at.y - d.start.y) * box.height
      if (Math.hypot(dx, dy) > TAP_PX || performance.now() - d.start.t > TAP_MS) {
        d.stroking = true
        flushTimer = setInterval(flush, SEND_EVERY)
        flush()
      }
    }
  }

  function up() {
    const d = drawing
    if (!d) return
    drawing = null
    if (flushTimer) clearInterval(flushTimer)
    flushTimer = null
    if (!d.stroking) {
      onsend({ t: 'ink.ping', x: d.start.x, y: d.start.y })
      pings.push({ x: d.start.x, y: d.start.y, t: now() })
      wake()
      return
    }
    onsend({ t: 'ink.stroke', id: d.id, tool, points: d.pending, end: true })
  }

  function flush() {
    const d = drawing
    if (!d || d.pending.length === 0) return
    onsend({ t: 'ink.stroke', id: d.id, tool, points: d.pending })
    d.pending = []
  }

  function wake() {
    if (!frame) frame = requestAnimationFrame(draw)
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
    const px = (p: { x: number; y: number }) => [box.left - rect.left + p.x * box.width, box.top - rect.top + p.y * box.height] as const
    const t = now()

    while (echo.length && t - echo[0].t > ECHO) echo.shift()
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (let i = 1; i < echo.length; i++) {
      const fade = Math.max(0, 1 - (t - echo[i].t) / ECHO)
      const [x0, y0] = px(echo[i - 1])
      const [x1, y1] = px(echo[i])
      g.globalAlpha = 0.85 * fade
      g.strokeStyle = color
      g.lineWidth = 4 + 2 * fade
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x1, y1)
      g.stroke()
    }

    while (pings.length && t - pings[0].t > 0.6) pings.shift()
    for (const p of pings) {
      const k = (t - p.t) / 0.6
      const [x, y] = px(p)
      g.globalAlpha = Math.max(0, 1 - k)
      g.strokeStyle = color
      g.lineWidth = 3
      g.beginPath()
      g.arc(x, y, 8 + 34 * k, 0, Math.PI * 2)
      g.stroke()
    }
    g.globalAlpha = 1
    if (echo.length || pings.length || drawing) frame = requestAnimationFrame(draw)
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
  aria-label="Rabiscar na tela"
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
    cursor: crosshair;
    touch-action: none;
  }
</style>
