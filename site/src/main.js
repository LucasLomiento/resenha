// Site do Resenha: o rabisco da abertura, a janela da call que troca de cena com
// a rolagem, e os detalhes (copiar comando, o download do seu sistema).

const still = matchMedia('(prefers-reduced-motion: reduce)').matches
const now = () => performance.now() / 1000

// ---------- Desenho: o mesmo laser e a mesma caneta do app (InkLayer / ink-overlay.py) ----------

const LASER = 0.7

/** Canvas que acompanha o tamanho do elemento e a densidade da tela. */
function fit(canvas) {
  const ratio = devicePixelRatio || 1
  const { width, height } = canvas.getBoundingClientRect()
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  const g = canvas.getContext('2d')
  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  return { g, width, height }
}

function laser(g, points, t, color, u) {
  const live = points.filter((p) => t - p[2] < LASER)
  for (let i = 1; i < live.length; i++) {
    const fade = Math.max(0, 1 - (t - live[i][2]) / LASER)
    for (const [width, alpha] of [
      [14 * u, 0.18],
      [5.5 * u, 0.95],
    ]) {
      g.globalAlpha = alpha * fade
      g.strokeStyle = color
      g.lineWidth = width * (0.4 + 0.6 * fade)
      g.beginPath()
      g.moveTo(live[i - 1][0], live[i - 1][1])
      g.lineTo(live[i][0], live[i][1])
      g.stroke()
    }
  }
  g.globalAlpha = 1
  return live.length > 0
}

function pen(g, points, color, u) {
  if (points.length < 2) return
  for (const [width, style, alpha] of [
    [8 * u, '#000', 0.45],
    [4.8 * u, color, 1],
  ]) {
    g.globalAlpha = alpha
    g.strokeStyle = style
    g.lineWidth = width
    g.beginPath()
    g.moveTo(points[0][0], points[0][1])
    for (const p of points.slice(1)) g.lineTo(p[0], p[1])
    g.stroke()
  }
  g.globalAlpha = 1
}

/** A etiqueta com o nome, parada no começo do traço. */
function label(g, name, color, x, y, u, alpha = 1) {
  if (alpha <= 0) return
  g.font = `600 ${13 * u}px Geist, system-ui, sans-serif`
  const w = g.measureText(name).width + 14 * u
  const h = 21 * u
  const left = x + 12 * u
  const top = y + 12 * u
  g.globalAlpha = 0.95 * alpha
  g.fillStyle = color
  g.beginPath()
  g.roundRect(left, top, w, h, h / 2)
  g.fill()
  g.globalAlpha = 0.9 * alpha
  g.fillStyle = '#0d0b17'
  g.fillText(name, left + 7 * u, top + 4 * u + 13 * u * 0.8)
  g.globalAlpha = 1
}

// ---------- Abertura: a caneta circula "galera"; o mouse rabisca com laser ----------

function hero() {
  const section = document.querySelector('.hero')
  const canvas = section?.querySelector('.scribble')
  const word = section?.querySelector('.circle-me')
  if (!canvas || !word) return

  const ME = '#8b7bff'
  const BIA = '#ff7a93'
  let circle = [] // a volta em "galera", em coordenadas da abertura
  let drawn = 0 // quantos pontos da volta já apareceram
  let strokes = [] // rabiscos de quem está vendo (laser)
  let current = null
  let frame = 0

  /** Uma volta torta em volta da palavra, como alguém faria com o mouse. */
  function makeCircle() {
    const box = section.getBoundingClientRect()
    const r = word.getBoundingClientRect()
    const cx = r.left - box.left + r.width / 2
    const cy = r.top - box.top + r.height * 0.52
    const rx = r.width / 2 + Math.max(12, r.height * 0.14)
    const ry = r.height * 0.4
    const points = []
    const steps = 90
    for (let i = 0; i <= steps; i++) {
      const a = -2.6 + (i / steps) * (Math.PI * 2 + 0.55)
      const wobble = 1 + 0.035 * Math.sin(a * 3 + 1) + (i / steps) * 0.06
      points.push([cx + Math.cos(a) * rx * wobble, cy + Math.sin(a) * ry * wobble - (i / steps) * ry * 0.12])
    }
    return points
  }

  function draw() {
    frame = 0
    const { g, width, height } = fit(canvas)
    g.clearRect(0, 0, width, height)
    const u = Math.max(0.9, Math.min(1.6, word.getBoundingClientRect().height / 120))
    const t = now()
    if (circle.length) {
      pen(g, circle.slice(0, drawn), BIA, u)
      if (drawn > 1) label(g, 'Bia', BIA, circle[0][0], circle[0][1], u)
    }
    let alive = false
    strokes = strokes.filter((s) => s.ended === null || t - s.ended < LASER)
    for (const s of strokes) {
      alive = laser(g, s.points, t, ME, 1) || alive
      const fade = s.ended === null ? 1 : Math.max(0, 1 - (t - s.ended) / LASER)
      if (s.points.length) label(g, 'você', ME, s.points[0][0], s.points[0][1], 1, fade)
    }
    if (alive || strokes.length || drawn < circle.length) frame = requestAnimationFrame(draw)
  }

  const wake = () => {
    if (!frame) frame = requestAnimationFrame(draw)
  }

  function animateCircle() {
    circle = makeCircle()
    if (still) {
      drawn = circle.length
      return wake()
    }
    drawn = 0
    const start = performance.now()
    const step = () => {
      drawn = Math.min(circle.length, Math.round(((performance.now() - start) / 1100) * circle.length))
      wake()
      if (drawn < circle.length) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  // Espera a fonte: o tamanho da palavra muda quando ela chega.
  document.fonts.ready.then(() => setTimeout(animateCircle, 500))
  addEventListener('resize', () => {
    circle = makeCircle()
    drawn = circle.length
    wake()
  })

  const at = (e) => {
    const box = section.getBoundingClientRect()
    return [e.clientX - box.left, e.clientY - box.top, now()]
  }
  section.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || e.target.closest('a, button')) return
    e.preventDefault()
    current = { points: [at(e)], ended: null }
    strokes.push(current)
    section.classList.add('drew')
    wake()
  })
  addEventListener('pointermove', (e) => {
    if (!current) return
    current.points.push(at(e))
    wake()
  })
  addEventListener('pointerup', () => {
    if (current) current.ended = now()
    current = null
    wake()
  })
}

// ---------- A janela da call: troca de cena conforme o texto passa ----------

function story() {
  const win = document.querySelector('.window')
  const steps = [...document.querySelectorAll('.step')]
  const name = win?.querySelector('.win-scene-name')
  if (!win || !steps.length) return
  const NAMES = { call: '4 na call', tela: 'Thiago ao vivo', rabisco: 'Bia rabiscando', mapa: 'Mapa', perfil: 'Perfil', queda: 'Reconectando' }

  const show = (step) => {
    for (const s of steps) s.classList.toggle('on', s === step)
    const scene = step.dataset.scene
    if (win.dataset.scene === scene) return
    win.dataset.scene = scene
    if (name) name.textContent = NAMES[scene] ?? ''
    scenes[scene]?.()
  }

  // O passo no meio da tela (no celular, logo abaixo da janela) é o da vez.
  const narrow = matchMedia('(max-width: 900px)')
  let observer
  const watch = () => {
    observer?.disconnect()
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length) show(visible[visible.length - 1].target)
      },
      { rootMargin: narrow.matches ? '-62% 0px -30% 0px' : '-48% 0px -48% 0px' },
    )
    for (const s of steps) observer.observe(s)
  }
  watch()
  narrow.addEventListener('change', watch)
  show(steps[0])
}

/** O que cada cena faz quando aparece (o resto é CSS). */
const scenes = {
  rabisco: inkScene,
  queda: dropScene,
}

let inkRun = 0

/** Alguém circula o sol com o laser e puxa uma seta: o que quem assiste faria. */
function inkScene() {
  const canvas = document.querySelector('.scene-rabisco .ink')
  const win = document.querySelector('.window')
  if (!canvas) return
  const run = ++inkRun
  const BIA = '#ff7a93'

  const path = (w, h) => {
    const cx = w * 0.67
    const cy = h * 0.39
    const r = Math.min(w, h) * 0.16
    const points = []
    for (let i = 0; i <= 60; i++) {
      const a = -2.2 + (i / 60) * (Math.PI * 2 + 0.4)
      points.push([cx + Math.cos(a) * r * (1 + i / 400), cy + Math.sin(a) * r * 0.92])
    }
    // e a seta pra esquerda, apontando
    const [ex, ey] = points.at(-1)
    for (let i = 1; i <= 24; i++) points.push([ex - (i / 24) * w * 0.3, ey + (i / 24) * h * 0.2])
    const [tx, ty] = points.at(-1)
    points.push([tx + w * 0.035, ty - h * 0.06], [tx, ty], [tx + w * 0.055, ty + h * 0.01])
    return points
  }

  let start = performance.now()
  let points = []
  const loop = () => {
    if (run !== inkRun || win.dataset.scene !== 'rabisco') return
    const { g, width, height } = fit(canvas)
    const plan = path(width, height)
    const elapsed = (performance.now() - start) / 1000
    const want = Math.min(plan.length, Math.floor((elapsed / 1.8) * plan.length))
    while (points.length < want) points.push([...plan[points.length], now()])
    g.clearRect(0, 0, width, height)
    const u = Math.max(0.7, height / 420)
    laser(g, points, now(), BIA, u)
    if (points.length) label(g, 'Bia', BIA, points[0][0], points[0][1], u, points.length < plan.length ? 1 : Math.max(0, 1 - (elapsed - 1.8) / 1))
    if (elapsed > 3.4) {
      start = performance.now()
      points = []
    }
    requestAnimationFrame(loop)
  }
  if (still) {
    const { g, width, height } = fit(canvas)
    const plan = path(width, height)
    pen(g, plan, BIA, Math.max(0.7, height / 420))
    label(g, 'Bia', BIA, plan[0][0], plan[0][1], Math.max(0.7, height / 420))
    return
  }
  requestAnimationFrame(loop)
}

let dropRun = 0

/** A conexão cai e volta; o contador de quadros da tela não para. */
function dropScene() {
  const run = ++dropRun
  const win = document.querySelector('.window')
  const net = document.querySelector('.scene-queda .net')
  const frames = document.querySelector('[data-frames]')
  if (!net || !frames) return
  let count = 1820
  const started = performance.now()
  const tick = () => {
    if (run !== dropRun || win.dataset.scene !== 'queda') return
    count += 1
    frames.textContent = count.toLocaleString('pt-BR')
    net.classList.toggle('back', ((performance.now() - started) / 1000) % 5 > 2.6)
    requestAnimationFrame(tick)
  }
  if (still) {
    net.classList.add('back')
    return
  }
  requestAnimationFrame(tick)
}

// ---------- Detalhes ----------

function nav() {
  const top = document.querySelector('.top')
  const links = [...document.querySelectorAll('.channels a')]
  const onScroll = () => top?.classList.toggle('scrolled', scrollY > 8)
  addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  // O canal da seção que está na tela fica marcado, como no app.
  const sections = links.map((a) => document.querySelector(a.getAttribute('href')))
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        for (const a of links) a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`)
      }
    },
    { rootMargin: '-40% 0px -55% 0px' },
  )
  for (const s of sections) if (s) observer.observe(s)
}

function copyButtons() {
  for (const button of document.querySelectorAll('.copy')) {
    button.addEventListener('click', async () => {
      const text = button.parentElement.querySelector('code').textContent
      try {
        await navigator.clipboard.writeText(text)
        button.classList.add('done')
        button.setAttribute('aria-label', 'Copiado')
        setTimeout(() => {
          button.classList.remove('done')
          button.setAttribute('aria-label', 'Copiar o comando')
        }, 1600)
      } catch {
        // sem permissão de área de transferência: o texto continua lá pra selecionar
      }
    })
  }
}

/** Destaca o download do sistema de quem está vendo. */
function mySystem() {
  const ua = navigator.userAgent
  const os = /Windows/i.test(ua) ? 'windows' : /Linux|X11/i.test(ua) && !/Android/i.test(ua) ? 'arch' : null
  if (!os) return
  document.querySelector(`.dl[data-os="${os}"]`)?.classList.add('mine')
  const cta = document.querySelector('[data-cta]')
  if (cta) cta.textContent = os === 'windows' ? 'Baixar pro Windows' : 'Baixar pro Linux'
}

hero()
story()
nav()
copyButtons()
mySystem()
