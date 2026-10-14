// Site do Resenha: o app de mentirinha. Cada canal é uma parte do site (a rota é o
// #canal), e cada parte tem o seu brinquedo: call, qualidade da tela, rabisco, mapa,
// perfil, Spotify e queda de internet. Tudo local; nada sai do navegador.

const still = matchMedia('(prefers-reduced-motion: reduce)').matches
const now = () => performance.now() / 1000
const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

/** A ordem do tour (setas, "Próximo" no pé de cada canal). */
const TOUR = ['boas-vindas', 'call', 'tela-ao-vivo', 'rabiscos', 'mapa', 'perfil', 'spotify', 'conexao', 'novidades', 'baixar']
/** Endereços do site antigo. */
const OLD = { topo: 'boas-vindas', recursos: 'call' }
const NAMES = { conexao: 'conexão' }
const name = (id) => NAMES[id] ?? id

/** Troca o ícone de um <svg><use></svg>. */
const setIcon = (svg, icon) => svg?.querySelector('use')?.setAttribute('href', `#i-${icon}`)

/** Quem quer saber quando um canal abre ou fecha (pra rodar animação só no canal aberto). */
const watchers = new Map()
const onView = (id, fn) => watchers.set(id, fn)

let current = null

// ---------- Canais ----------

function router() {
  const views = new Map($$('[data-view]').map((v) => [v.dataset.view, v]))
  const channels = $$('.ch[data-ch]')
  const order = channels.map((c) => c.dataset.ch)
  const head = { icon: $('.head-icon'), name: $('.head-name'), topic: $('.head-topic') }
  const nextCard = $('[data-next-card]')
  const visited = new Set()

  for (const c of channels) c.addEventListener('click', closeDrawer)
  for (const c of channels) if (c.closest('.channels') && !['boas-vindas', 'baixar'].includes(c.dataset.ch)) c.classList.add('unread')

  /** O canal (e o elemento, se for um link pra dentro dele) de um #endereço. */
  const resolve = (hash) => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (!id || id === 'conteudo') return { view: current ?? 'boas-vindas' }
    if (views.has(id)) return { view: id }
    if (OLD[id]) return { view: OLD[id] }
    const target = document.getElementById(id)
    const inside = target?.closest('[data-view]')
    if (inside) return { view: inside.dataset.view, target }
    return { view: 'boas-vindas' }
  }

  const show = (id, { target = null, focus = false } = {}) => {
    const view = views.get(id)
    if (!view) return
    const changed = id !== current
    const before = current
    current = id
    for (const [key, v] of views) v.classList.toggle('active', key === id)
    for (const c of channels) {
      const on = c.dataset.ch === id
      c.classList.toggle('active', on)
      if (on) c.setAttribute('aria-current', 'page')
      else c.removeAttribute('aria-current')
    }
    $$(`.ch[data-ch="${id}"]`).forEach((c) => c.classList.remove('unread'))
    visited.add(id)

    setIcon(head.icon, view.dataset.icon)
    head.name.textContent = name(id)
    head.topic.textContent = view.dataset.topic ?? ''
    document.title = id === 'boas-vindas' ? 'Resenha' : `#${name(id)} · Resenha`

    // O "Próximo" vai pro pé do canal aberto.
    const i = TOUR.indexOf(id)
    const next = TOUR[i + 1]
    const scroll = $('.scroll', view)
    if (next && scroll) {
      nextCard.hidden = false
      nextCard.href = `#${next}`
      $('.next-label', nextCard).textContent = id === 'boas-vindas' ? 'Começar o tour' : 'Próximo'
      $('.next-name b', nextCard).textContent = name(next)
      setIcon($('.next-name svg', nextCard), views.get(next).dataset.icon)
      scroll.append(nextCard)
    } else nextCard.hidden = true
    $('[data-prev]').disabled = i <= 0
    $('[data-next]').disabled = !next

    if (changed) {
      if (scroll && !target) scroll.scrollTop = 0
      watchers.get(before)?.(false)
      watchers.get(id)?.(true)
    }
    if (target) {
      const details = target.closest('details')
      if (details) details.open = true
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }))
    }
    closeDrawer()
    if (focus) head.name.focus({ preventScroll: true })
  }

  const go = (id) => {
    if (id === current) return
    location.hash = id
  }

  addEventListener('hashchange', () => {
    const { view, target } = resolve(location.hash)
    show(view, { target, focus: true })
  })

  $('[data-prev]').addEventListener('click', () => go(TOUR[TOUR.indexOf(current) - 1]))
  $('[data-next]').addEventListener('click', () => go(TOUR[TOUR.indexOf(current) + 1]))

  // Alt+↑/↓ anda pela lista de canais, como no app.
  addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const i = order.indexOf(current) + (e.key === 'ArrowDown' ? 1 : -1)
    if (order[i]) go(order[i])
  })

  const { view, target } = resolve(location.hash)
  show(view, { target })
}

// ---------- Gaveta dos canais (celular) ----------

function closeDrawer() {
  if (!document.body.classList.contains('drawer-open')) return
  document.body.classList.remove('drawer-open')
  $('[data-open-drawer]')?.setAttribute('aria-expanded', 'false')
}

function drawer() {
  const open = $('[data-open-drawer]')
  open?.setAttribute('aria-expanded', 'false')
  open?.addEventListener('click', () => {
    document.body.classList.add('drawer-open')
    open.setAttribute('aria-expanded', 'true')
    $('.ch.active')?.focus()
  })
  for (const b of $$('[data-close-drawer]')) b.addEventListener('click', closeDrawer)
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer()
  })
}

// ---------- Você: mudo, surdo e a call ----------

const me = { muted: false, deaf: false, inCall: false }
const meListeners = []
const meChanged = () => meListeners.forEach((fn) => fn())

function dock() {
  const mute = $('[data-mute]')
  const deafen = $('[data-deafen]')
  const call = $('.dock-call')
  mute.addEventListener('click', () => {
    me.muted = !me.muted
    if (!me.muted) me.deaf = false
    meChanged()
  })
  deafen.addEventListener('click', () => {
    me.deaf = !me.deaf
    me.muted = me.deaf
    meChanged()
  })
  $('[data-leave]').addEventListener('click', () => {
    me.inCall = false
    meChanged()
  })
  meListeners.push(() => {
    mute.setAttribute('aria-pressed', String(me.muted))
    mute.setAttribute('aria-label', me.muted ? 'Desmutar' : 'Mutar')
    setIcon(mute.querySelector('svg'), me.muted ? 'mic-off' : 'mic')
    deafen.setAttribute('aria-pressed', String(me.deaf))
    deafen.setAttribute('aria-label', me.deaf ? 'Voltar a ouvir' : 'Ensurdecer')
    setIcon(deafen.querySelector('svg'), me.deaf ? 'head-off' : 'head')
    call.hidden = !me.inCall
    $('.me-text small').textContent = me.inCall ? 'na call' : 'visitante'
  })
}

function call() {
  const tiles = $$('[data-call] .call-tile')
  const mine = $('[data-person="me"]')
  const join = $('[data-join]')
  const note = $('[data-join-note]')
  const people = tiles.filter((t) => t !== mine && !t.classList.contains('muted'))
  let timer = 0
  let turn = 0

  const speak = () => {
    for (const t of tiles) t.classList.remove('speaking')
    // Às vezes ninguém fala; às vezes dois falam ao mesmo tempo.
    const who = people[turn % people.length]
    turn += 1 + Math.floor(Math.random() * 2)
    if (Math.random() > 0.15) who.classList.add('speaking')
    if (Math.random() > 0.75) people[(turn + 1) % people.length].classList.add('speaking')
    if (me.inCall && !me.muted && Math.random() > 0.6) mine.classList.add('speaking')
    timer = setTimeout(speak, 900 + Math.random() * 1100)
  }

  onView('call', (open) => {
    clearTimeout(timer)
    for (const t of tiles) t.classList.remove('speaking')
    if (open && !still) speak()
    else if (open) people[0].classList.add('speaking')
  })

  join.addEventListener('click', () => {
    me.inCall = !me.inCall
    meChanged()
  })
  meListeners.push(() => {
    mine.hidden = !me.inCall
    mine.classList.toggle('muted-me', me.muted)
    if (me.muted) mine.classList.remove('speaking')
    join.textContent = me.inCall ? 'Sair da call' : 'Entrar na call'
    join.classList.toggle('primary', !me.inCall)
    join.classList.toggle('secondary', me.inCall)
    note.textContent = me.inCall
      ? me.muted
        ? 'Você está mudo. Desmuta no microfone lá embaixo, ao lado do seu nome.'
        : 'Você entrou. O microfone e o fone lá embaixo, ao lado do seu nome, funcionam aqui também.'
      : 'Os outros já estão lá. O anel verde mostra quem está falando.'
  })
}

// ---------- Grupos de opção (rádio com setas) ----------

function radios(group, onPick) {
  const options = $$('[role="radio"]', group)
  const pick = (button, focus) => {
    for (const o of options) {
      o.setAttribute('aria-checked', String(o === button))
      o.tabIndex = o === button ? 0 : -1
    }
    if (focus) button.focus()
    onPick(button)
  }
  for (const o of options) {
    o.tabIndex = o.getAttribute('aria-checked') === 'true' ? 0 : -1
    o.addEventListener('click', () => pick(o, false))
    o.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
      if (!step) return
      e.preventDefault()
      pick(options[(options.indexOf(o) + step + options.length) % options.length], true)
    })
  }
}

// ---------- Tela ----------

function quality() {
  const group = $('[data-quality]')
  const player = $('[data-view="tela-ao-vivo"] .player')
  const stats = $('[data-stats]')
  const LEVELS = {
    720: '1280×720 · 60 fps · 4 Mbps · VP9',
    1080: '1920×1080 · 60 fps · 8 Mbps · VP9',
    1440: '2560×1440 · 60 fps · 12 Mbps · VP9',
  }
  radios(group, (b) => {
    player.dataset.q = b.dataset.q
    stats.textContent = LEVELS[b.dataset.q]
  })
}

// ---------- Rabiscos: o mesmo laser e a mesma caneta do app (InkLayer / ink-overlay.py) ----------

const LASER = 0.7
const YOU = '#4f8cff'
const BIA = '#ff7a93'

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
function label(g, text, color, x, y, u, alpha = 1) {
  if (alpha <= 0) return
  g.font = `600 ${13 * u}px Geist, system-ui, sans-serif`
  const w = g.measureText(text).width + 14 * u
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
  g.fillText(text, left + 7 * u, top + 4 * u + 13 * u * 0.8)
  g.globalAlpha = 1
}

function ink() {
  const player = $('.ink-player')
  const canvas = $('[data-ink]')
  const group = $('.ink-bar')
  let tool = 'laser'
  /** Traços de quem está vendo, em coordenadas de 0 a 1 (sobrevivem a mudar o tamanho). */
  let strokes = []
  let drawing = null
  let open = false
  let frame = 0
  let demoStart = 0

  radios(group, (b) => (tool = b.dataset.tool))
  $('[data-ink-clear]').addEventListener('click', () => {
    strokes = []
    wake()
  })

  /** Enquanto ninguém desenhou: a Bia circula o sol e puxa uma seta. */
  const demo = (w, h) => {
    const cx = w * 0.66
    const cy = h * 0.38
    const r = Math.min(w, h) * 0.15
    const points = []
    for (let i = 0; i <= 60; i++) {
      const a = -2.2 + (i / 60) * (Math.PI * 2 + 0.4)
      points.push([cx + Math.cos(a) * r * (1 + i / 400), cy + Math.sin(a) * r * 0.92])
    }
    const [ex, ey] = points.at(-1)
    for (let i = 1; i <= 24; i++) points.push([ex - (i / 24) * w * 0.3, ey + (i / 24) * h * 0.2])
    const [tx, ty] = points.at(-1)
    points.push([tx + w * 0.035, ty - h * 0.06], [tx, ty], [tx + w * 0.055, ty + h * 0.01])
    return points
  }
  let demoPoints = []

  function draw() {
    frame = 0
    if (!open) return
    const { g, width, height } = fit(canvas)
    g.clearRect(0, 0, width, height)
    const u = Math.max(0.7, height / 420)
    const t = now()
    let busy = false

    if (!player.classList.contains('drawn')) {
      const plan = demo(width, height)
      if (still) {
        pen(g, plan, BIA, u)
        label(g, 'Bia', BIA, plan[0][0], plan[0][1], u)
      } else {
        const elapsed = t - demoStart
        const want = Math.min(plan.length, Math.floor((elapsed / 1.8) * plan.length))
        while (demoPoints.length < want) demoPoints.push([...plan[demoPoints.length], t])
        laser(g, demoPoints, t, BIA, u)
        if (demoPoints.length) label(g, 'Bia', BIA, demoPoints[0][0], demoPoints[0][1], u, demoPoints.length < plan.length ? 1 : Math.max(0, 1 - (elapsed - 1.8)))
        if (elapsed > 3.6) {
          demoStart = t
          demoPoints = []
        }
        busy = true
      }
    }

    strokes = strokes.filter((s) => s.tool === 'pen' || s.ended === null || t - s.ended < LASER)
    for (const s of strokes) {
      const points = s.points.map(([x, y, at]) => [x * width, y * height, at])
      if (s.tool === 'pen') pen(g, points, YOU, u)
      else busy = laser(g, points, t, YOU, u) || busy
      const fade = s.tool === 'pen' || s.ended === null ? 1 : Math.max(0, 1 - (t - s.ended) / LASER)
      if (points.length) label(g, 'você', YOU, points[0][0], points[0][1], u, fade)
      if (s.tool === 'laser') busy = true
    }
    if (busy) frame = requestAnimationFrame(draw)
  }

  const wake = () => {
    if (!frame && open) frame = requestAnimationFrame(draw)
  }

  const at = (e) => {
    const box = canvas.getBoundingClientRect()
    return [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height, now()]
  }
  player.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.ink-bar')) return
    e.preventDefault()
    try {
      player.setPointerCapture(e.pointerId)
    } catch {
      // ponteiro que já sumiu: desenha sem capturar
    }
    drawing = { tool, points: [at(e)], ended: null }
    strokes.push(drawing)
    player.classList.add('drawn')
    wake()
  })
  player.addEventListener('pointermove', (e) => {
    if (!drawing) return
    drawing.points.push(at(e))
    wake()
  })
  const end = () => {
    if (drawing) drawing.ended = now()
    drawing = null
    wake()
  }
  player.addEventListener('pointerup', end)
  player.addEventListener('pointercancel', end)
  addEventListener('resize', wake)

  onView('rabiscos', (on) => {
    open = on
    demoStart = now()
    demoPoints = []
    if (on) wake()
  })
}

// ---------- Mapa ----------

function map() {
  const box = $('[data-map]')
  const LABELS = ['Aqui!', 'Bora?', 'Encontro', 'Lanche', 'Rolê']
  let count = 0
  box.addEventListener('click', (e) => {
    if (e.target.closest('.pin')) return
    const r = box.getBoundingClientRect()
    const pin = document.createElement('span')
    pin.className = 'pin mine'
    pin.style.left = `${((e.clientX - r.left) / r.width) * 100}%`
    pin.style.top = `${((e.clientY - r.top) / r.height) * 100}%`
    pin.innerHTML = '<svg aria-hidden="true"><use href="#i-pin"/></svg><b></b>'
    $('b', pin).textContent = LABELS[count++ % LABELS.length]
    box.append(pin)
    const mine = $$('.pin.mine', box)
    if (mine.length > 4) mine[0].remove()
  })
}

// ---------- Perfil ----------

function profile() {
  const card = $('[data-card]')
  const groups = [
    ['[data-themes]', 'setTheme', 'theme'],
    ['[data-frames]', 'setFrame', 'frame'],
    ['[data-names]', 'setName', 'name'],
  ]
  for (const [selector, key, attr] of groups) {
    const buttons = $$(`${selector} button`)
    const mark = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[key] === card.dataset[attr])))
    for (const b of buttons)
      b.addEventListener('click', () => {
        card.dataset[attr] = b.dataset[key]
        mark()
      })
    mark()
  }
}

// ---------- Spotify ----------

function spotify() {
  const root = $('[data-spotify]')
  const TRACKS = [
    { title: 'Evidências', artist: 'Chitãozinho & Xororó', genres: ['sertanejo', 'romântico'], length: 279 },
    { title: 'Lenda', artist: 'Sandy & Junior', genres: ['pop'], length: 240 },
    { title: 'Tempo Perdido', artist: 'Legião Urbana', genres: ['rock nacional'], length: 301 },
    { title: 'Garota de Ipanema', artist: 'Tom Jobim', genres: ['bossa nova', 'mpb'], length: 324 },
  ]
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const ui = {
    title: $('[data-sp-title]', root),
    artist: $('[data-sp-artist]', root),
    genres: $('[data-sp-genres]', root),
    time: $('[data-sp-time]', root),
    dur: $('[data-sp-dur]', root),
    bar: $('[data-sp-bar]', root),
    play: $('[data-sp-play]', root),
    list: $$('[data-track]', root),
  }
  let index = 0
  let at = 72
  let playing = true

  const render = (jump) => {
    const track = TRACKS[index]
    ui.title.textContent = track.title
    ui.artist.textContent = track.artist
    ui.genres.replaceChildren(
      ...track.genres.map((g) => {
        const i = document.createElement('i')
        i.textContent = g
        return i
      }),
    )
    ui.time.textContent = clock(at)
    ui.dur.textContent = clock(track.length)
    ui.bar.classList.toggle('jump', jump)
    ui.bar.style.width = `${(at / track.length) * 100}%`
    root.classList.toggle('paused', !playing)
    ui.play.setAttribute('aria-label', playing ? 'Pausar' : 'Tocar')
    setIcon($('svg', ui.play), playing ? 'pause' : 'play')
    for (const b of ui.list) b.setAttribute('aria-current', String(Number(b.dataset.track) === index))
  }
  const pick = (i) => {
    index = (i + TRACKS.length) % TRACKS.length
    at = 0
    playing = true
    render(true)
  }

  ui.play.addEventListener('click', () => {
    playing = !playing
    render(false)
  })
  $('[data-sp-next]', root).addEventListener('click', () => pick(index + 1))
  $('[data-sp-prev]', root).addEventListener('click', () => (at > 3 ? pick(index) : pick(index - 1)))
  for (const b of ui.list) b.addEventListener('click', () => pick(Number(b.dataset.track)))

  setInterval(() => {
    if (!playing || current !== 'spotify') return
    at += 1
    if (at >= TRACKS[index].length) pick(index + 1)
    else render(false)
  }, 1000)
  render(true)
}

// ---------- Queda de internet ----------

function drop() {
  const net = $('[data-net]')
  const frames = $('[data-frame-count]')
  const button = $('[data-drop-btn]')
  let open = false
  let count = 1820
  let last = 0

  const tick = (t) => {
    if (!open) return
    if (last) count += Math.round(((t - last) / 1000) * 60)
    last = t
    frames.textContent = count.toLocaleString('pt-BR')
    requestAnimationFrame(tick)
  }
  onView('conexao', (on) => {
    open = on
    last = 0
    if (on) requestAnimationFrame(tick)
  })

  button.addEventListener('click', () => {
    button.disabled = true
    net.classList.remove('back')
    net.classList.add('down')
    setTimeout(() => {
      net.classList.remove('down')
      net.classList.add('back')
    }, 2600)
    setTimeout(() => {
      net.classList.remove('back')
      button.disabled = false
    }, 5400)
  })
}

// ---------- Chat das boas-vindas ----------

/** O que o "Resenha" responde, pela primeira palavra-chave que aparecer. */
const ANSWERS = [
  [/\b(oi|ol[aá]|e[ai]+e?|salve|bom dia|boa tarde|boa noite|fala)\b/, 'Salve! 👋 Os canais aí do lado mostram o app. Começa por {call}.'],
  [/gr[aá]tis|pag|pre[cç]o|nitro|custa/, 'É de graça e o código é aberto. O perfil caprichado (moldura, nome com brilho) é pra todo mundo: {perfil}.'],
  [/rabisc|desenh|laser|caneta/, 'Quem assiste rabisca na tela de quem transmite, e aparece no monitor dele. Testa em {rabiscos}.'],
  [/tela|transmi|stream|1440|jogo|fps|qualidade/, 'A tela vai até 1440p a 60 fps, com o som do jogo em estéreo e sem a voz da call. Dá uma olhada em {tela-ao-vivo}.'],
  [/mapa|street|lugar/, 'Cada servidor tem um mapa, com o cursor de todo mundo ao vivo. Tá em {mapa}.'],
  [/spotify|m[uú]sica|playlist|bot/, 'O bot do Spotify toca na call e cada um ouve no volume que quiser: {spotify}.'],
  [/perfil|moldura|nome|tema|banner/, 'Tema, moldura, efeito e nome com fonte e brilho, pra todo mundo: {perfil}.'],
  [/ca[iu]|queda|internet|conex|lag|ping|travou/, 'Caiu a internet? Voltou em até 30 s, ninguém sai da call. Simula em {conexao}.'],
  [/baix|instal|windows|linux|arch|download|appimage|pacman/, 'Tem pra Arch (.pacman), outras distros (AppImage) e Windows: {baixar}.'],
  [/novidade|vers[aã]o|atualiz|changelog|update/, 'Tudo que mudou fica em {novidades}, e o app se atualiza sozinho.'],
  [/call|voz|microfone|fal|ru[ií]do/, 'A voz vai direto de um PC pro outro, com redução de ruído e volume de cada um até 200%: {call}.'],
]

function chat() {
  const form = $('[data-composer]')
  const input = $('input', form)
  const log = $('[data-log]')
  const scroll = log.closest('.scroll')
  const keepDown = () => (scroll.scrollTop = scroll.scrollHeight)

  /** Uma mensagem com o texto dado; "{canal}" vira link pro canal. */
  const message = (author, text) => {
    const article = document.createElement('article')
    article.className = 'msg'
    const avatar =
      author === 'me'
        ? '<span class="avatar me">V</span>'
        : '<svg class="msg-mascot" viewBox="0 0 336 336" aria-hidden="true"><use href="#mascot"/></svg>'
    const head =
      author === 'me'
        ? '<span class="msg-author">Você</span>'
        : '<span class="msg-author">Resenha</span><span class="msg-bot">app</span>'
    article.innerHTML = `${avatar}<div class="msg-main"><header class="msg-head">${head}<span class="msg-time">agora</span></header><p></p></div>`
    if (author === 'me') article.classList.add('mine')
    const p = $('p', article)
    for (const part of text.split(/(\{[a-z-]+\})/)) {
      const ch = /^\{([a-z-]+)\}$/.exec(part)?.[1]
      if (!ch) {
        p.append(part)
        continue
      }
      const a = document.createElement('a')
      a.className = 'mention'
      a.href = `#${ch}`
      a.textContent = `#${name(ch)}`
      p.append(a)
    }
    log.append(article)
    while (log.children.length > 30) log.firstElementChild.remove()
    keepDown()
  }

  let typing = null
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    message('me', text)
    const lower = text.toLowerCase()
    const answer =
      ANSWERS.find(([test]) => test.test(lower))?.[1] ??
      'Ainda não sei responder isso 😅 Mas os canais aí do lado mostram tudo. Começa por {call}.'
    typing?.remove()
    typing = document.createElement('div')
    typing.className = 'typing'
    typing.innerHTML = '<i></i><i></i><i></i><span><b>Resenha</b> está digitando…</span>'
    log.append(typing)
    keepDown()
    const mine = typing
    setTimeout(
      () => {
        mine.remove()
        if (typing === mine) typing = null
        message('bot', answer)
      },
      still ? 0 : 650 + Math.min(900, answer.length * 8),
    )
  })

  // Reações: um clique conta, outro tira.
  log.addEventListener('click', (e) => {
    const button = e.target.closest('.reaction')
    if (!button) return
    const on = button.getAttribute('aria-pressed') !== 'true'
    button.setAttribute('aria-pressed', String(on))
    const count = $('b', button)
    count.textContent = String(Number(count.textContent) + (on ? 1 : -1))
  })
}

// ---------- O mascote ri de vez em quando ----------

function mascot() {
  const face = $('.welcome .mascot')
  if (!face || still) return
  const laugh = () => {
    face.classList.add('laughing')
    setTimeout(() => face.classList.remove('laughing'), 2800)
  }
  face.addEventListener('click', laugh)
  setTimeout(laugh, 900)
  setInterval(() => {
    if (current === 'boas-vindas' && !document.hidden) laugh()
  }, 8000)
}

// ---------- Baixar ----------

function copyButtons() {
  for (const button of $$('.copy')) {
    button.addEventListener('click', async () => {
      const text = button.parentElement.querySelector('code').textContent
      try {
        await navigator.clipboard.writeText(text)
        button.classList.add('done')
        setIcon($('svg', button), 'check')
        button.setAttribute('aria-label', 'Copiado')
        setTimeout(() => {
          button.classList.remove('done')
          setIcon($('svg', button), 'copy')
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
  $(`.dl[data-os="${os}"]`)?.classList.add('mine')
  const cta = $('[data-cta]')
  if (cta) cta.textContent = os === 'windows' ? 'Baixar pro Windows' : 'Baixar pro Linux'
}

drawer()
dock()
call()
quality()
ink()
map()
profile()
spotify()
drop()
chat()
copyButtons()
mySystem()
meChanged()
router()
mascot()
