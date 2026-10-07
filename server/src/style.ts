import {
  DECORATIONS,
  MAX_PRONOUNS,
  NAME_EFFECTS,
  NAME_FONTS,
  PROFILE_EFFECTS,
  type ProfileStyle,
} from '../../shared/protocol'
import { cleanLine, color } from './validate'

export { isAnimated } from '../../shared/media'

// Personalização do perfil: guardada como JSON numa coluna `style` (no
// Directory e na cópia dos perfis de cada Guild). O texto sai sempre na mesma
// ordem de chaves, então dá pra comparar texto com texto e saber se mudou.

const KEYS = ['banner', 'avatarStill', 'theme', 'pronouns', 'decoration', 'effect', 'nameFont', 'nameEffect'] as const

const media = (value: unknown) => (typeof value === 'string' && /^[\w-]{8,64}$/.test(value) ? value : undefined)
const oneOf = <T extends string>(list: readonly T[], value: unknown) => (list.includes(value as T) ? (value as T) : undefined)
const theme = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value) || value.length !== 2) return undefined
  const [a, b] = value.map((c) => color(c))
  return typeof a === 'number' && typeof b === 'number' ? [a, b] : undefined
}

/** Só o que é válido, na ordem certa; vazio vira undefined. */
export function normalizeStyle(input: unknown): ProfileStyle | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as Record<string, unknown>
  const out: ProfileStyle = {}
  for (const key of KEYS) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    let clean: unknown
    switch (key) {
      case 'banner':
      case 'avatarStill':
        clean = media(value)
        break
      case 'theme':
        clean = theme(value)
        break
      case 'pronouns':
        clean = cleanLine(value, 1, MAX_PRONOUNS) ?? undefined
        break
      case 'decoration':
        clean = oneOf(DECORATIONS, value)
        break
      case 'effect':
        clean = oneOf(PROFILE_EFFECTS, value)
        break
      case 'nameFont':
        clean = oneOf(NAME_FONTS, value)
        break
      case 'nameEffect':
        clean = oneOf(NAME_EFFECTS, value)
        break
    }
    if (clean !== undefined) (out as Record<string, unknown>)[key] = clean
  }
  return Object.keys(out).length ? out : undefined
}

export function styleText(style: ProfileStyle | undefined): string | null {
  const clean = normalizeStyle(style)
  return clean ? JSON.stringify(clean) : null
}

export function parseStyle(text: string | null | undefined): ProfileStyle | undefined {
  if (!text) return undefined
  try {
    return normalizeStyle(JSON.parse(text))
  } catch {
    return undefined
  }
}

/**
 * Aplica o que o app mandou no PATCH /api/me. Banner e quadro parado não
 * entram aqui (só mudam pelas rotas de imagem, que conferem de quem é).
 */
const PATCHABLE: [keyof ProfileStyle, (value: unknown) => unknown, string][] = [
  ['theme', theme, 'Tema inválido.'],
  ['pronouns', (v) => cleanLine(v, 0, MAX_PRONOUNS) ?? undefined, `Os pronomes podem ter até ${MAX_PRONOUNS} caracteres.`],
  ['decoration', (v) => oneOf(DECORATIONS, v), 'Moldura inválida.'],
  ['effect', (v) => oneOf(PROFILE_EFFECTS, v), 'Efeito inválido.'],
  ['nameFont', (v) => oneOf(NAME_FONTS, v), 'Fonte inválida.'],
  ['nameEffect', (v) => oneOf(NAME_EFFECTS, v), 'Estilo do nome inválido.'],
]

export function applyStylePatch(
  current: ProfileStyle | undefined,
  patch: unknown,
): { ok: true; value: ProfileStyle | undefined } | { ok: false; error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'Personalização inválida.' }
  const input = patch as Record<string, unknown>
  const next: Record<string, unknown> = { ...current }
  for (const [key, clean, error] of PATCHABLE) {
    if (input[key] === undefined) continue
    const value = input[key] === null ? null : clean(input[key])
    if (value === undefined) return { ok: false, error }
    if (value === null || value === '') delete next[key]
    else next[key] = value
  }
  return { ok: true, value: normalizeStyle(next) }
}
