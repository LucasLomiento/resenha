// Personalização do perfil (tema, nome, moldura, efeito): nomes pra mostrar e
// as contas de cor. Sem store, serve pro app e pros protótipos.

import type { Badge, Decoration, NameEffect, NameFont, ProfileEffect, ProfileStyle } from '../../../../shared/protocol'
import { userColors, userGradient } from './format'
import { m } from './i18n.svelte'

/** O mínimo de uma pessoa pra desenhar o perfil dela. */
export interface Styled {
  id: string
  accent: number | null
  style?: ProfileStyle
  deleted?: boolean
}

export const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

/**
 * Tabela de nomes lida do catálogo a cada acesso: `DECORATION_LABEL.neon` sai no idioma
 * em uso na hora (e acompanha a troca), sem a interface precisar saber do catálogo.
 */
function labels<K extends string>(read: () => Record<K, string>): Readonly<Record<K, string>> {
  return new Proxy({} as Record<K, string>, {
    get: (_, key) => read()[key as K],
    has: (_, key) => key in read(),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_, key) =>
      key in read() ? { value: read()[key as K], enumerable: true, configurable: true, writable: false } : undefined,
  })
}

export const DECORATION_LABEL = labels<Decoration>(() => m.lib.profile.decorations)

export const EFFECT_LABEL = labels<ProfileEffect>(() => m.lib.profile.effects)

export const NAME_FONT_LABEL = labels<NameFont>(() => m.lib.profile.nameFonts)

export const NAME_EFFECT_LABEL = labels<NameEffect>(() => m.lib.profile.nameEffects)

/** Selo da pessoa (o servidor põe no perfil): Fundador (o dono do Resenha) ou Pioneiro (a primeira pessoa que chegou). */
export const badgeOf = (user: Styled | null | undefined): Badge | null => (user && !user.deleted && user.style?.badge) || null
export const isFounder = (user: Styled | null | undefined) => badgeOf(user) === 'founder'
/** Quem abre o painel da plataforma: o dono (tudo) e o melhor amigo dele (só os números). */
export const seesPlatform = (user: (Styled & { staff?: boolean }) | null | undefined) => !!user?.staff || badgeOf(user) === 'pioneer'

type ThemeId = keyof typeof m.lib.profile.themes

/** Temas prontos: [principal, destaque]. O nome sai do catálogo na hora de mostrar. */
export const THEME_PRESETS: { id: ThemeId; readonly name: string; colors: [number, number] }[] = (
  [
    ['resenha', [0x6a5cf6, 0xff7ab6]],
    ['sunset', [0xff7a59, 0x8f3fd1]],
    ['ocean', [0x2e8bff, 0x2ad4b0]],
    ['forest', [0x2f9e62, 0xc8e05a]],
    ['cottonCandy', [0xff9ccf, 0x8ec5ff]],
    ['ember', [0xe8452c, 0xffc34d]],
    ['midnight', [0x23265c, 0x6a5cf6]],
  ] as [ThemeId, [number, number]][]
).map(([id, colors]) => ({
  id,
  get name() {
    return m.lib.profile.themes[id]
  },
  colors,
}))

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
