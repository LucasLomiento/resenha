// Personalização do perfil (tema, nome, moldura, efeito): nomes pra mostrar e
// as contas de cor. Sem store, serve pro app e pros protótipos.

import type { Badge, Decoration, NameEffect, NameFont, ProfileEffect, ProfileStyle } from '../../../../shared/protocol'
import { userColors, userGradient } from './format'

/** O mínimo de uma pessoa pra desenhar o perfil dela. */
export interface Styled {
  id: string
  accent: number | null
  style?: ProfileStyle
  deleted?: boolean
}

export const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

export const DECORATION_LABEL: Record<Decoration, string> = {
  neon: 'Neon',
  aurora: 'Aurora',
  headset: 'Fones',
  stars: 'Estrelinhas',
  flames: 'Chamas',
  flowers: 'Flores',
  crown: 'Coroa',
  cat: 'Gatinho',
  founder: 'Fundador',
  pioneer: 'Pioneiro',
}

export const EFFECT_LABEL: Record<ProfileEffect, string> = {
  confetti: 'Confete',
  snow: 'Neve',
  sparkles: 'Brilhos',
  hearts: 'Corações',
  bubbles: 'Bolhas',
  fireflies: 'Vaga-lumes',
}

export const NAME_FONT_LABEL: Record<NameFont, string> = {
  serif: 'Clássica',
  rounded: 'Redonda',
  script: 'Cursiva',
  pixel: 'Pixel',
}

export const NAME_EFFECT_LABEL: Record<NameEffect, string> = {
  gradient: 'Degradê',
  neon: 'Neon',
  holo: 'Holográfico',
  horizon: 'Horizonte',
}

/** Selo da pessoa (o servidor põe no perfil): Fundador (o dono do Resenha) ou Pioneiro (a primeira pessoa que chegou). */
export const badgeOf = (user: Styled | null | undefined): Badge | null => (user && !user.deleted && user.style?.badge) || null
export const isFounder = (user: Styled | null | undefined) => badgeOf(user) === 'founder'

/** Temas prontos: [principal, destaque]. */
export const THEME_PRESETS: { name: string; colors: [number, number] }[] = [
  { name: 'Resenha', colors: [0x6a5cf6, 0xff7ab6] },
  { name: 'Pôr do sol', colors: [0xff7a59, 0x8f3fd1] },
  { name: 'Oceano', colors: [0x2e8bff, 0x2ad4b0] },
  { name: 'Floresta', colors: [0x2f9e62, 0xc8e05a] },
  { name: 'Algodão-doce', colors: [0xff9ccf, 0x8ec5ff] },
  { name: 'Brasa', colors: [0xe8452c, 0xffc34d] },
  { name: 'Meia-noite', colors: [0x23265c, 0x6a5cf6] },
]

function rgb(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** Mistura com branco até dar pra ler sobre o fundo escuro (contraste ~6:1 no painel). */
export function readable(color: string, min = 0.28): string {
  const base = rgb(color)
  let out = base
  for (let t = 0; t <= 1 && luminance(out) < min; t += 0.05) {
    out = base.map((c) => Math.round(c + (255 - c) * t)) as [number, number, number]
  }
  return `rgb(${out.join(' ')})`
}

/** As duas cores da pessoa: o tema; senão a cor do perfil; senão o degradê do avatar. */
export function profileColors(user: Styled): [string, string] {
  const theme = user.style?.theme
  if (theme?.length === 2) return [hex(theme[0]), hex(theme[1])]
  if (user.accent !== null) return [hex(user.accent), hex(user.accent)]
  return userColors(user.id)
}

/**
 * Classe e variáveis do nome com fonte/efeito. As classes (`name-font-*`,
 * `name-fx-*`) ficam no app.css; o efeito usa as cores do perfil, clareadas.
 */
export function nameStyle(user: Styled | null | undefined): { class: string | null; style: string | null } {
  const style = user && !user.deleted ? user.style : undefined
  if (!user || (!style?.nameFont && !style?.nameEffect)) return { class: null, style: null }
  const classes = ['styled-name']
  if (style.nameFont) classes.push(`name-font-${style.nameFont}`)
  if (!style.nameEffect) return { class: classes.join(' '), style: null }
  classes.push(`name-fx-${style.nameEffect}`)
  const [a, b] = profileColors(user)
  const first = readable(a)
  // Uma cor só (cor do perfil): o degradê vai dela pra uma versão bem clara.
  const second = a === b ? readable(a, 0.62) : readable(b)
  return { class: classes.join(' '), style: `--name-a: ${first}; --name-b: ${second}` }
}

/** Topo do cartão sem banner: as cores do tema, senão a cor do perfil, senão o degradê do avatar. */
export function bannerFill(user: Styled): string {
  const theme = user.deleted ? undefined : user.style?.theme
  if (theme?.length === 2) return `linear-gradient(135deg, ${hex(theme[0])}, ${hex(theme[1])})`
  if (user.accent === null) return userGradient(user.id)
  const color = hex(user.accent)
  return `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 45%, #0b0b10))`
}

/** Tema do cartão de perfil (variáveis pro fundo em degradê), ou null sem tema. */
export function cardTheme(user: Styled): string | null {
  const theme = user.deleted ? undefined : user.style?.theme
  if (theme?.length !== 2) return null
  return `--theme-a: ${hex(theme[0])}; --theme-b: ${hex(theme[1])}`
}
