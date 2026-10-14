// Ícones do app de Android a partir do ícone do computador (app/build/icon.svg): o ícone
// adaptável (fundo escuro com o brilho azul + o mascote na área segura), o comum (o squircle,
// pros Android antigos), o redondo e o da tela de abertura. Precisa do rsvg-convert.
// Uso: node mobile/scripts/icons.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const here = (path) => new URL(path, import.meta.url).pathname
const RES = here('../android/app/src/main/res')
const icon = readFileSync(here('../../app/build/icon.svg'), 'utf8')

const defs = icon.match(/<defs>[\s\S]*?<\/defs>/)[0]
const squircle = icon.match(/<path fill="url\(#fundo\)" d="([^"]+)"/)[1]
// O mascote: o grupo depois do squircle (sombra, fone, balão, rosto, microfone).
const mascot = icon.slice(icon.indexOf('<g transform="translate(0 -16)">'), icon.lastIndexOf('</svg>'))

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}${body}</svg>`
// Ícone adaptável: o Android recorta (círculo, squircle...) e mexe o desenho; só os 66 dp do
// meio dos 108 aparecem sempre. O fundo vai de ponta a ponta; o mascote encolhe pra caber no meio.
const background = svg('<rect width="512" height="512" fill="url(#fundo)"/><rect width="512" height="512" fill="url(#brilho)"/>')
const foreground = svg(`<g transform="translate(256 256) scale(0.8) translate(-256 -262)">${mascot}</g>`)
const round = svg(
  `<clipPath id="redondo"><circle cx="256" cy="256" r="225"/></clipPath><g clip-path="url(#redondo)"><rect width="512" height="512" fill="url(#fundo)"/><rect width="512" height="512" fill="url(#brilho)"/></g><g transform="translate(256 256) scale(0.86) translate(-256 -262)">${mascot}</g>`,
)

const tmp = mkdtempSync(join(tmpdir(), 'resenha-icons-'))
const files = { background, foreground, round, legacy: icon }
for (const [name, content] of Object.entries(files)) writeFileSync(join(tmp, `${name}.svg`), content)
const render = (name, size, out) => execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), join(tmp, `${name}.svg`), '-o', out])

// Densidades: o ícone comum tem 48 dp; as camadas do adaptável, 108 dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${density}`)
  render('legacy', 48 * scale, join(dir, 'ic_launcher.png'))
  render('round', 48 * scale, join(dir, 'ic_launcher_round.png'))
  render('foreground', 108 * scale, join(dir, 'ic_launcher_foreground.png'))
  render('background', 108 * scale, join(dir, 'ic_launcher_background.png'))
}
rmSync(tmp, { recursive: true, force: true })
console.log('ícones gerados em', RES)
