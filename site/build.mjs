// Gera o site do Resenha (GitHub Pages): junta o modelo de site/src com as
// releases do GitHub (novidades e links de download) e escreve em site/dist, uma
// página por idioma (português na raiz, en/ e es/), com os textos de site/src/i18n.
//
//   node site/build.mjs            (GITHUB_TOKEN opcional; sem ele, 60 pedidos/h)
//
// O Actions roda isto a cada push que mexe no site e depois de cada release
// (.github/workflows/site.yml), então a página acompanha as versões sozinha.
//
// As notas de cada versão vêm do corpo da release (o RELEASE_NOTES.md, em português);
// nas outras línguas, de site/notes/<idioma>/<versão>.md. Sem a tradução, a versão
// aparece em português com uma etiqueta avisando.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = 'LucasLomiento/resenha'
const SITE = 'https://lucaslomiento.github.io/resenha/'
const ROOT = dirname(fileURLToPath(import.meta.url))
const OUT = join(ROOT, 'dist')
/** Os idiomas: `dir` é a pasta da página, `intl` o das datas, `og` o do og:locale. */
const LANGS = [
  { code: 'pt', dir: '', lang: 'pt-BR', intl: 'pt-BR', og: 'pt_BR', name: 'Português' },
  { code: 'en', dir: 'en/', lang: 'en', intl: 'en-US', og: 'en_US', name: 'English' },
  { code: 'es', dir: 'es/', lang: 'es', intl: 'es-419', og: 'es_LA', name: 'Español' },
]
/** Quantas versões aparecem abertas; o resto fica em "versões anteriores". */
const OPEN = 4

const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Negrito, código e link (o que as notas das releases usam). */
function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
}

/**
 * Notas de uma release em HTML. Tira o "Como atualizar" (igual em todas), os
 * resumos "### Da 1.2.0" (repetem a versão anterior) e tabelas. O primeiro
 * "## versão: título" vira o título da mensagem.
 */
export function renderNotes(body) {
  const lines = body.replace(/\r/g, '').split('\n')
  let title = null
  let skip = false
  const html = []
  /** Uma entrada por lista aberta (pela indentação): se o item dela ainda está aberto. */
  const lists = []
  let paragraph = []

  const closeParagraph = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const closeLists = (depth = 0) => {
    while (lists.length > depth) {
      if (lists.pop()) html.push('</li>')
      html.push('</ul>')
    }
  }
  const openItem = (depth, text) => {
    while (lists.length < depth) {
      html.push('<ul>')
      lists.push(false)
    }
    closeLists(depth)
    if (lists[depth - 1]) html.push('</li>')
    html.push(`<li>${inline(text)}`)
    lists[depth - 1] = true
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const h2 = /^##\s+(.*)$/.exec(line)
    const h3 = /^###\s+(.*)$/.exec(line)
    if (h2) {
      closeParagraph()
      closeLists()
      if (title === null && !html.length) {
        title = h2[1].replace(/^v?\d+(\.\d+)*\s*[:—–-]\s*/, '')
        skip = false
      } else skip = /como atualizar|como instalar/i.test(h2[1])
      if (!skip && title !== null && html.length) html.push(`<h4>${inline(h2[1])}</h4>`)
      continue
    }
    if (h3) {
      closeParagraph()
      closeLists()
      skip = /^da \d/i.test(h3[1]) || /como atualizar/i.test(h3[1])
      if (!skip) html.push(`<h4>${inline(h3[1])}</h4>`)
      continue
    }
    if (skip || line.startsWith('|')) continue
    const item = /^(\s*)[-*]\s+(.*)$/.exec(line)
    if (item) {
      closeParagraph()
      openItem(Math.min(Math.floor(item[1].length / 2) + 1, lists.length + 1), item[2])
      continue
    }
    if (!line.trim()) {
      closeParagraph()
      continue
    }
    closeLists()
    paragraph.push(line.trim())
  }
  closeParagraph()
  closeLists()

  // Sem "##" (a primeira versão): o título é o começo do primeiro parágrafo.
  if (title === null) {
    const first = html.findIndex((h) => h.startsWith('<p>'))
    const match = first >= 0 ? /^<p>([^:<]{3,40}):\s*(.*)<\/p>$/.exec(html[first]) : null
    if (match) {
      title = match[1]
      html[first] = `<p>${match[2].charAt(0).toUpperCase()}${match[2].slice(1)}</p>`
    } else title = ''
  }
  return { title: title.charAt(0).toUpperCase() + title.slice(1), html: html.join('\n') }
}

const TZ = 'America/Sao_Paulo'
const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`

/** Datas no formato do idioma, no horário de Brasília (o das releases). */
function dates(intl) {
  const long = new Intl.DateTimeFormat(intl, { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' })
  const short = new Intl.DateTimeFormat(intl, { timeZone: TZ, day: 'numeric', month: 'short' })
  const clock = new Intl.DateTimeFormat(intl, { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
  return {
    day: (iso) => long.format(new Date(iso)),
    shortDay: (iso) => short.format(new Date(iso)).replace('.', ''),
    time: (iso) => clock.format(new Date(iso)),
  }
}

/** A nota da versão no idioma, ou a original (em português) quando não tem tradução. */
function notesOf(release, lang) {
  const file = join(ROOT, 'notes', lang.code, `${release.tag_name.replace(/^v/, '')}.md`)
  if (lang.code !== 'pt' && existsSync(file)) return { body: readFileSync(file, 'utf8'), original: false }
  return { body: release.body ?? '', original: lang.code !== 'pt' }
}

function message(release, latest, ctx) {
  const { t, lang, when } = ctx
  const version = release.tag_name.replace(/^v/, '')
  const notes = notesOf(release, lang)
  const { title, html } = renderNotes(notes.body)
  const pt = notes.original ? ' lang="pt-BR"' : ''
  return `<article class="msg${latest ? ' latest' : ''}" id="v${esc(version)}">
  <svg class="msg-mascot" viewBox="0 0 336 336" aria-hidden="true"><use href="#mascot"/></svg>
  <div class="msg-main">
    <header class="msg-head">
      <span class="msg-author">Resenha</span><span class="msg-bot">${t.common.bot}</span>
      <a class="msg-time" href="#v${esc(version)}"><time datetime="${release.published_at}">${when.shortDay(release.published_at)}, ${when.time(release.published_at)}</time></a>
    </header>
    <h3 class="msg-title"><span class="msg-version">${esc(version)}</span>${title ? ` ${notes.original ? `<span${pt}>${inline(title)}</span>` : inline(title)}` : ''}${latest ? ` <span class="msg-new">${t.updates.newest}</span>` : ''}${notes.original ? ` <span class="msg-original">${t.updates.original}</span>` : ''}</h3>
    <div class="msg-body"${pt}>${html}</div>
  </div>
</article>`
}

/** Mensagens com o separador de dia, igual ao chat do app. */
function messages(list, first, ctx) {
  let lastDay = null
  return list
    .map((release, i) => {
      const d = ctx.when.day(release.published_at)
      const divider = d !== lastDay ? `<div class="day"><span>${d}</span></div>` : ''
      lastDay = d
      return divider + message(release, first && i === 0, ctx)
    })
    .join('\n')
}

// ---------- Idiomas ----------

const isGroup = (v) => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof RegExp)

/** As chaves de um catálogo ("welcome.title"); lista e regex contam como um valor só. */
const keysOf = (catalog, prefix = '') =>
  Object.entries(catalog).flatMap(([key, value]) => (isGroup(value) ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))

/** O endereço (#) de um canal: o nome sem acento. */
const slug = (name) => name.normalize('NFD').replace(/\p{M}/gu, '')
const slugsOf = (catalog) => Object.fromEntries(Object.entries(catalog.channels).map(([id, name]) => [id, slug(name)]))

/** Link relativo de uma página pra outra (a raiz e uma pasta abaixo dela). */
const relative = (from, to) => (from ? '../' : '') + to || './'

async function loadCatalogs() {
  const catalogs = {}
  for (const lang of LANGS) catalogs[lang.code] = (await import(pathToFileURL(join(ROOT, 'src/i18n', `${lang.code}.mjs`)).href)).default
  const want = keysOf(catalogs.pt)
  for (const [code, catalog] of Object.entries(catalogs)) {
    const have = keysOf(catalog)
    const missing = want.filter((k) => !have.includes(k))
    const extra = have.filter((k) => !want.includes(k))
    if (missing.length || extra.length)
      throw new Error(`site/src/i18n/${code}.mjs: ${[missing.length && `falta ${missing.join(', ')}`, extra.length && `sobra ${extra.join(', ')}`].filter(Boolean).join('; ')}`)
  }
  // Um endereço só pode levar a um canal, em qualquer idioma (o site aceita os de todos).
  const owner = new Map()
  for (const [code, catalog] of Object.entries(catalogs))
    for (const [id, s] of Object.entries(slugsOf(catalog))) {
      if (owner.has(s) && owner.get(s) !== id) throw new Error(`site/src/i18n/${code}.mjs: #${s} já é de outro canal (${owner.get(s)})`)
      owner.set(s, id)
    }
  return catalogs
}

/**
 * Preenche o modelo: {{MAIÚSCULA}} vem de `values`, {{chave.de.dentro}} do catálogo
 * (com os {{…}} de dentro dele preenchidos também). {{slug.<canal>}} é o endereço do canal.
 */
function fill(text, catalog, values) {
  return text.replace(/\{\{([\w.-]+)\}\}/g, (match, key) => {
    if (/^[A-Z_]+$/.test(key)) {
      if (!(key in values)) throw new Error(`modelo pede ${match}, que o build não tem`)
      return values[key]
    }
    if (key.startsWith('slug.')) {
      const name = catalog.channels[key.slice(5)]
      if (name === undefined) throw new Error(`modelo pede ${match}, um canal que não existe`)
      return slug(name)
    }
    const value = key.split('.').reduce((at, part) => at?.[part], catalog)
    if (typeof value !== 'string') throw new Error(`modelo pede ${match}, que o catálogo não tem`)
    if (value.includes('"')) throw new Error(`o texto de ${match} tem aspas duplas, que fecham o atributo no HTML`)
    return fill(value, catalog, values)
  })
}

/** O que o main.js recebe: os textos de `js`, os canais e os outros idiomas. */
function strings(lang, catalogs) {
  const t = catalogs[lang.code]
  const data = {
    ...t.js,
    answers: t.js.answers.map(([test, text]) => [test.source, test.flags, text]),
    lang: lang.code,
    channels: t.channels,
    langs: LANGS.map((l) => ({ code: l.code, href: relative(lang.dir, l.dir), slugs: slugsOf(catalogs[l.code]) })),
  }
  // "</" dentro do <script> fecharia a tag antes da hora; "<\/" é o mesmo texto em JSON.
  return JSON.stringify(data).replaceAll('</', '<\\/')
}

function downloads(latest) {
  const find = (test) => latest.assets.find((a) => test(a.name))
  const pick = {
    pacman: find((n) => n.endsWith('.pacman')),
    appimage: find((n) => n.endsWith('.AppImage')),
    setup: find((n) => /Setup.*\.exe$/.test(n)),
    zip: find((n) => n.endsWith('.zip')),
    apk: find((n) => n.endsWith('.apk')),
  }
  const link = (asset) => (asset ? esc(asset.browser_download_url) : `https://github.com/${REPO}/releases/latest`)
  const size = (asset) => (asset ? mb(asset.size) : '')
  return { pick, link, size }
}

async function fetchReleases() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'resenha-site' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  // De 100 em 100 (o máximo por página), até vir uma página incompleta.
  const all = []
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers })
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} pras releases (página ${page})`)
    const batch = await res.json()
    all.push(...batch)
    if (batch.length < 100) break
  }
  const list = all.filter((r) => !r.draft && !r.prerelease)
  return list.sort((a, b) => b.published_at.localeCompare(a.published_at))
}

function page(lang, ctx) {
  const { template, catalogs, releases, redirect } = ctx
  const t = catalogs[lang.code]
  const when = dates(lang.intl)
  const latest = releases[0]
  const version = latest.tag_name.replace(/^v/, '')
  const { pick, link, size } = downloads(latest)
  const oldest = releases.at(-1)
  const notes = { t, lang, when }

  const changelog = `${messages(releases.slice(0, OPEN), true, notes)}
${
  releases.length > OPEN
    ? `<details class="older"><summary>${t.updates.older} <span>${releases.length - OPEN}</span></summary>
${messages(releases.slice(OPEN), false, notes)}
</details>`
    : ''
}`

  const values = {
    LANG: lang.lang,
    LANG_SHORT: lang.code.toUpperCase(),
    LANG_LINKS: LANGS.map(
      (l) =>
        `              <a href="${relative(lang.dir, l.dir)}" hreflang="${l.lang}" lang="${l.lang}" data-lang-link="${l.code}"${l === lang ? ' aria-current="true"' : ''}><small>${l.code.toUpperCase()}</small>${l.name}${l === lang ? '<svg aria-hidden="true"><use href="#i-check"/></svg>' : ''}</a>`,
    ).join('\n'),
    ROOT: lang.dir ? '../' : '',
    SITE,
    URL: SITE + lang.dir,
    OG_LOCALE: lang.og,
    ALTERNATES: [...LANGS.map((l) => `  <link rel="alternate" hreflang="${l.lang}" href="${SITE}${l.dir}">`), `  <link rel="alternate" hreflang="x-default" href="${SITE}">`].join('\n'),
    // Só a raiz escolhe o idioma pelo navegador: quem abre /en/ ou /es/ quis aquele.
    REDIRECT: lang.dir ? '' : `  <script>\n${redirect.trim()}\n  </script>`,
    STRINGS: strings(lang, catalogs),
    VERSION: esc(version),
    VERSION_DATE: when.day(latest.published_at),
    COUNT: String(releases.length),
    FIRST_DATE: when.day(oldest.published_at),
    PACMAN_URL: link(pick.pacman),
    PACMAN_NAME: esc(pick.pacman?.name ?? 'Resenha.pacman'),
    PACMAN_SIZE: size(pick.pacman),
    APPIMAGE_URL: link(pick.appimage),
    APPIMAGE_NAME: esc(pick.appimage?.name ?? 'Resenha.AppImage'),
    APPIMAGE_SIZE: size(pick.appimage),
    SETUP_URL: link(pick.setup),
    SETUP_SIZE: size(pick.setup),
    ZIP_URL: link(pick.zip),
    APK_URL: link(pick.apk),
    APK_SIZE: size(pick.apk),
    CHANGELOG: changelog,
    YEAR: String(new Date().getFullYear()),
  }
  return fill(template, t, values)
}

async function main() {
  const releases = await fetchReleases()
  if (!releases.length) throw new Error('nenhuma release publicada')
  const ctx = {
    releases,
    catalogs: await loadCatalogs(),
    template: readFileSync(join(ROOT, 'src/index.html'), 'utf8'),
    redirect: readFileSync(join(ROOT, 'src/redirect.js'), 'utf8'),
  }

  rmSync(OUT, { recursive: true, force: true })
  for (const lang of LANGS) {
    mkdirSync(join(OUT, lang.dir), { recursive: true })
    writeFileSync(join(OUT, lang.dir, 'index.html'), page(lang, ctx))
    const untranslated = lang.code === 'pt' ? [] : releases.filter((r) => notesOf(r, lang).original).map((r) => r.tag_name)
    if (untranslated.length) console.warn(`site: sem a nota em ${lang.code} (vai em português): ${untranslated.join(', ')}`)
  }
  cpSync(join(ROOT, 'src/style.css'), join(OUT, 'style.css'))
  cpSync(join(ROOT, 'src/main.js'), join(OUT, 'main.js'))
  cpSync(join(ROOT, 'assets'), join(OUT, 'assets'), { recursive: true })
  // Sem Jekyll no GitHub Pages: os arquivos vão do jeito que estão.
  writeFileSync(join(OUT, '.nojekyll'), '')
  console.log(`site: ${releases.length} versões, mais nova ${releases[0].tag_name}, em ${LANGS.map((l) => l.code).join('/')} → ${OUT}`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
