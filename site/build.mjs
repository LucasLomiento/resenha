// Gera o site do Resenha (GitHub Pages): junta o modelo de site/src com as
// releases do GitHub (novidades e links de download) e escreve em site/dist.
//
//   node site/build.mjs            (GITHUB_TOKEN opcional; sem ele, 60 pedidos/h)
//
// O Actions roda isto a cada push que mexe no site e depois de cada release
// (.github/workflows/site.yml), então a página acompanha as versões sozinha.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'LucasLomiento/resenha'
const ROOT = dirname(fileURLToPath(import.meta.url))
const OUT = join(ROOT, 'dist')
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
const day = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
const time = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const shortDay = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(iso)).replace('.', '')
const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`

function message(release, latest) {
  const version = release.tag_name.replace(/^v/, '')
  const { title, html } = renderNotes(release.body ?? '')
  return `<article class="msg${latest ? ' latest' : ''}" id="v${esc(version)}">
  <img class="msg-avatar" src="assets/icon.svg" alt="" width="40" height="40" loading="lazy">
  <div class="msg-main">
    <header class="msg-head">
      <span class="msg-author">Resenha</span><span class="msg-bot">app</span>
      <a class="msg-time" href="#v${esc(version)}"><time datetime="${release.published_at}">${shortDay(release.published_at)}, ${time(release.published_at)}</time></a>
    </header>
    <h3 class="msg-title"><span class="msg-version">${esc(version)}</span>${title ? ` ${inline(title)}` : ''}${latest ? ' <span class="msg-new">mais nova</span>' : ''}</h3>
    <div class="msg-body">${html}</div>
  </div>
</article>`
}

/** Mensagens com o separador de dia, igual ao chat do app. */
function messages(list, first) {
  let lastDay = null
  return list
    .map((release, i) => {
      const d = day(release.published_at)
      const divider = d !== lastDay ? `<div class="day"><span>${d}</span></div>` : ''
      lastDay = d
      return divider + message(release, first && i === 0)
    })
    .join('\n')
}

function downloads(latest) {
  const find = (test) => latest.assets.find((a) => test(a.name))
  const pick = {
    pacman: find((n) => n.endsWith('.pacman')),
    appimage: find((n) => n.endsWith('.AppImage')),
    setup: find((n) => /Setup.*\.exe$/.test(n)),
    zip: find((n) => n.endsWith('.zip')),
  }
  const link = (asset) => (asset ? esc(asset.browser_download_url) : `https://github.com/${REPO}/releases/latest`)
  const size = (asset) => (asset ? mb(asset.size) : '')
  return { pick, link, size }
}

async function fetchReleases() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'resenha-site' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers })
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status} pras releases`)
  const list = (await res.json()).filter((r) => !r.draft && !r.prerelease)
  return list.sort((a, b) => b.published_at.localeCompare(a.published_at))
}

async function main() {
  const releases = await fetchReleases()
  if (!releases.length) throw new Error('nenhuma release publicada')
  const latest = releases[0]
  const version = latest.tag_name.replace(/^v/, '')
  const { pick, link, size } = downloads(latest)
  const oldest = releases.at(-1)

  const changelog = `${messages(releases.slice(0, OPEN), true)}
${
  releases.length > OPEN
    ? `<details class="older"><summary>Versões anteriores <span>${releases.length - OPEN}</span></summary>
${messages(releases.slice(OPEN), false)}
</details>`
    : ''
}`

  const values = {
    VERSION: esc(version),
    VERSION_DATE: day(latest.published_at),
    COUNT: String(releases.length),
    FIRST_DATE: day(oldest.published_at),
    PACMAN_URL: link(pick.pacman),
    PACMAN_NAME: esc(pick.pacman?.name ?? 'Resenha.pacman'),
    PACMAN_SIZE: size(pick.pacman),
    APPIMAGE_URL: link(pick.appimage),
    APPIMAGE_NAME: esc(pick.appimage?.name ?? 'Resenha.AppImage'),
    APPIMAGE_SIZE: size(pick.appimage),
    SETUP_URL: link(pick.setup),
    SETUP_SIZE: size(pick.setup),
    ZIP_URL: link(pick.zip),
    CHANGELOG: changelog,
    YEAR: String(new Date().getFullYear()),
  }

  const page = readFileSync(join(ROOT, 'src/index.html'), 'utf8').replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`modelo pede ${match}, que o build não tem`)
    return values[key]
  })

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'index.html'), page)
  cpSync(join(ROOT, 'src/style.css'), join(OUT, 'style.css'))
  cpSync(join(ROOT, 'src/main.js'), join(OUT, 'main.js'))
  cpSync(join(ROOT, 'assets'), join(OUT, 'assets'), { recursive: true })
  // Sem Jekyll no GitHub Pages: os arquivos vão do jeito que estão.
  writeFileSync(join(OUT, '.nojekyll'), '')
  console.log(`site: ${releases.length} versões, mais nova ${version} → ${OUT}`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
