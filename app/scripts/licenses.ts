// Avisos de licença do que vai dentro do app (THIRD_PARTY_LICENSES.txt, ao lado do index.html do
// renderer e solto em resources/ no pacote). Entra o que o Vite juntou na página, as dependências
// que vão em node_modules no pacote (dbus-next, electron-updater e as delas) e o que não passa
// pelo Vite: as fontes (importadas pelo CSS), o rnnoise (wasm) e o venmic (binário pronto).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/** O que sempre vai, mesmo que não apareça nos módulos do Vite. */
const ALWAYS = [
  'svelte',
  'maplibre-gl',
  '@lucide/svelte',
  '@breezystack/lamejs',
  '@jitsi/rnnoise-wasm',
  '@vencord/venmic',
  '@fontsource-variable/bricolage-grotesque',
  '@fontsource-variable/fraunces',
  '@fontsource-variable/fredoka',
  '@fontsource-variable/geist',
  '@fontsource-variable/geist-mono',
  '@fontsource/pacifico',
  '@fontsource/silkscreen',
]

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i

interface PackageJson {
  name?: string
  version?: string
  license?: string | { type?: string }
  /** Formato antigo do package.json. */
  licenses?: { type?: string }[]
  homepage?: string
  repository?: string | { url?: string }
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const readJson = (file: string): PackageJson => JSON.parse(readFileSync(file, 'utf8')) as PackageJson

/** Acha o pacote como o Node acha: no node_modules de quem pede e depois nos de cima. */
function findPackage(from: string, name: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(dir) === dir) return null
  }
}

/** A pasta do pacote de um arquivo dentro de node_modules (o mais fundo, pra pacote dentro de pacote). */
function packageDirOf(id: string): string | null {
  const file = id.replace(/^\0/, '').split('?')[0].replace(/\\/g, '/')
  const at = file.lastIndexOf('/node_modules/')
  if (at < 0) return null
  const rest = file.slice(at + '/node_modules/'.length).split('/')
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
  return `${file.slice(0, at)}/node_modules/${name}`
}

/** Monta o texto com cada pacote, a licença e o arquivo de licença dele. */
export function thirdPartyLicenses(appDir: string, bundledIds: Iterable<string> = []): string {
  const dirs = new Set<string>()
  for (const id of bundledIds) {
    const dir = packageDirOf(id)
    if (dir && existsSync(join(dir, 'package.json'))) dirs.add(dir)
  }
  for (const name of ALWAYS) {
    const dir = findPackage(appDir, name)
    if (dir) dirs.add(dir)
  }
  // Dependências do processo principal (vão em node_modules no pacote), com as delas. As opcionais
  // ficam de fora: a única é o usocket do dbus-next, que o before-pack.cjs tira do pacote.
  const app = readJson(join(appDir, 'package.json'))
  const walked = new Set<string>()
  const queue = Object.keys(app.dependencies ?? {})
    .map((name) => findPackage(appDir, name))
    .filter((dir): dir is string => !!dir)
  while (queue.length > 0) {
    const dir = queue.pop()!
    if (walked.has(dir)) continue
    walked.add(dir)
    dirs.add(dir)
    for (const name of Object.keys(readJson(join(dir, 'package.json')).dependencies ?? {})) {
      const child = findPackage(dir, name)
      if (child && !walked.has(child)) queue.push(child)
    }
  }

  const entries = new Map<string, string>()
  for (const dir of dirs) {
    const pkg = readJson(join(dir, 'package.json'))
    if (!pkg.name) continue
    const key = `${pkg.name}@${pkg.version ?? ''}`
    if (entries.has(key)) continue
    const declared = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? pkg.licenses?.map((l) => l.type).filter(Boolean).join(' OR '))
    const license = declared || 'license in the text below'
    const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    const source = (pkg.homepage || repository || '').replace(/^git\+/, '')
    const texts = readdirSync(dir)
      .filter((file) => LICENSE_FILE.test(file))
      .sort((a, b) => Number(/^notice/i.test(a)) - Number(/^notice/i.test(b)) || a.localeCompare(b))
      .map((file) => readFileSync(join(dir, file), 'utf8').trim())
    entries.set(key, [`${pkg.name} ${pkg.version ?? ''} (${license})`, source, '-'.repeat(72), ...(texts.length > 0 ? texts : [`License: ${license}`])].filter(Boolean).join('\n'))
  }

  const header = [
    'Resenha: third-party licenses',
    '',
    'Source code of Resenha: https://github.com/LucasLomiento/resenha',
    'Electron and Chromium ship their own notices next to the app (LICENSE.electron.txt and LICENSES.chromium.html).',
    'lamejs (LGPL-3.0) is included unmodified in the app page; it can be replaced by building the app from the source above.',
  ].join('\n')
  const body = [...entries.keys()].sort((a, b) => a.localeCompare(b)).map((key) => entries.get(key)!)
  return `${[header, ...body].join(`\n\n${'='.repeat(72)}\n`)}\n`
}

/** No build do renderer: o arquivo sai junto do index.html (e o pacote leva uma cópia solta pra resources/). */
export function licenses(appDir: string): Plugin {
  return {
    name: 'resenha-licenses',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source: thirdPartyLicenses(appDir, this.getModuleIds()) })
    },
  }
}
