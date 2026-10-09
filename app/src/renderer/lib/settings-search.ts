// Busca nas configurações: cada configuração tem um lugar (página + âncora
// `data-setting` na linha), e o catálogo de cada idioma (`settings.search.entries`)
// tem o nome dela, o grupo e as palavras que levam até ela: sinônimos, o nome no
// Discord, o jeito que alguém procuraria. Configuração nova: ponha aqui, nos três
// catálogos, e marque a linha com `setting="<id>"` (o teste confere que toda âncora
// daqui existe na página).
// Roda também no teste do Node, que não entende runes: nada de i18n.svelte nem de
// settings.svelte aqui. O idioma chega pelo contexto da busca.

import type { Locale } from './i18n.svelte'
import en from './i18n/en/settings'
import es from './i18n/es/settings'
import pt from './i18n/pt/settings'
import type { SettingsPage } from './ui.svelte'

export type SettingId = keyof typeof pt.search.entries

export interface SettingEntry {
  /** Âncora na página (`setting` no Row/Section); o texto fica no catálogo, com o mesmo id. */
  id: SettingId
  page: SettingsPage
  /** Só pra quem é dono da plataforma. */
  staff?: boolean
  /** Pra quem vê os números da plataforma (o dono e o melhor amigo dele). */
  platform?: boolean
  /** Só no app de computador (as opções que dependem do sistema). */
  desktop?: boolean
  /** Só no Hyprland. */
  hyprland?: boolean
}

/** Configuração achada, com os textos no idioma da busca. */
export interface SettingMatch extends SettingEntry {
  label: string
  /** Grupo dentro da página. */
  section?: string
  /** "Página · Grupo", pra mostrar embaixo do nome. */
  where: string
}

const CATALOGS: Record<Locale, typeof pt> = { pt, en, es }
/** Os outros idiomas também valem (com peso menor): "language" acha o idioma em português. */
const OTHERS: Record<Locale, Locale[]> = { pt: ['en', 'es'], en: ['pt', 'es'], es: ['pt', 'en'] }

export const SETTINGS: SettingEntry[] = [
  // Perfil
  { id: 'profile.photo', page: 'profile' },
  { id: 'profile.name', page: 'profile' },
  { id: 'profile.pronouns', page: 'profile' },
  { id: 'profile.username', page: 'profile' },
  { id: 'profile.bio', page: 'profile' },
  { id: 'profile.banner', page: 'profile' },
  { id: 'profile.color', page: 'profile' },
  { id: 'profile.theme', page: 'profile' },
  { id: 'profile.decoration', page: 'profile' },
  { id: 'profile.effect', page: 'profile' },
  { id: 'profile.nameFont', page: 'profile' },
  { id: 'profile.nameEffect', page: 'profile' },

  // Aparelhos e senha
  { id: 'devices.list', page: 'devices' },
  { id: 'devices.others', page: 'devices' },
  { id: 'password.change', page: 'password' },

  // Privacidade
  { id: 'privacy.dms', page: 'privacy' },
  { id: 'privacy.blocked', page: 'privacy' },
  { id: 'privacy.export', page: 'privacy' },
  { id: 'privacy.delete', page: 'privacy' },
  { id: 'privacy.docs', page: 'privacy' },

  // Voz e vídeo
  { id: 'voice.input', page: 'voice' },
  { id: 'voice.output', page: 'voice' },
  { id: 'voice.test', page: 'voice' },
  { id: 'voice.noise', page: 'voice' },
  { id: 'voice.gate', page: 'voice' },
  { id: 'voice.camera', page: 'voice' },
  { id: 'voice.preview', page: 'voice' },
  { id: 'voice.ink', page: 'voice' },
  { id: 'voice.echo', page: 'voice' },
  { id: 'voice.agc', page: 'voice' },
  { id: 'voice.codec', page: 'voice' },
  { id: 'voice.stats', page: 'voice' },

  // Notificações
  { id: 'notify.sounds', page: 'notifications' },
  { id: 'notify.volume', page: 'notifications' },
  { id: 'notify.message', page: 'notifications' },
  { id: 'notify.preview', page: 'notifications' },
  { id: 'notify.content', page: 'notifications' },

  // Atalhos
  { id: 'shortcuts.toggle-mute', page: 'shortcuts' },
  { id: 'shortcuts.toggle-deafen', page: 'shortcuts' },
  { id: 'shortcuts.toggle-share', page: 'shortcuts' },
  { id: 'shortcuts.leave-call', page: 'shortcuts' },
  { id: 'shortcuts.show-window', page: 'shortcuts' },
  { id: 'shortcuts.all', page: 'shortcuts' },
  { id: 'shortcuts.hyprland', page: 'shortcuts', hyprland: true },

  // Aplicativo
  { id: 'app.language', page: 'app' },
  { id: 'app.autostart', page: 'app', desktop: true },
  { id: 'app.hidden', page: 'app', desktop: true },
  { id: 'app.tray', page: 'app', desktop: true },
  { id: 'app.close', page: 'app', desktop: true },
  { id: 'app.zoom', page: 'app', desktop: true },
  { id: 'app.update', page: 'app' },

  // Plataforma (os números: dono e melhor amigo; cadastro e contas: só o dono)
  { id: 'platform.signup', page: 'platform', staff: true },
  { id: 'platform.accounts', page: 'platform', staff: true },
  { id: 'platform.storage', page: 'platform', platform: true },
  { id: 'platform.invites', page: 'platform', platform: true },
  { id: 'platform.media', page: 'platform', platform: true },
]

/** Sem acento, minúsculo, só letras/números (o resto vira espaço). */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@+]+/gu, ' ')
    .trim()
}

/** Quantas letras trocar, tirar ou pôr pra ir de `a` a `b` (para cedo passando de `max`). */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, row[j])
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

/** Quanto uma palavra da busca bate com as palavras de um texto (0 = não bate). */
function wordScore(term: string, words: string[]): number {
  let best = 0
  for (const word of words) {
    if (word === term) return 3
    if (word.startsWith(term)) best = Math.max(best, 2.5)
    else if (term.length >= 3 && word.includes(term)) best = Math.max(best, 1.5)
    else if (term.length >= 4) {
      // Erro de digitação: uma letra (duas nas palavras compridas), comparando com o começo da palavra.
      const max = term.length >= 7 ? 2 : 1
      const head = word.slice(0, term.length + 1)
      if (distance(term, word, max) <= max || distance(term, head, max) <= max) best = Math.max(best, 1)
    }
  }
  return best
}

export interface SettingContext {
  staff: boolean
  platform: boolean
  desktop: boolean
  hyprland: boolean
  /** Idioma da interface (`i18n.locale`); sem ele, português. */
  locale?: Locale
}

/** Os textos de uma configuração num idioma, já sem acento e separados em palavras. */
interface Folded {
  label: string[]
  keywords: string[]
  place: string[]
  /** O nome e cada palavra-chave inteiros, pra ver se a busca é exatamente um deles. */
  wholes: string[]
}

const foldedCache = new Map<string, Folded>()

function folded(locale: Locale, entry: SettingEntry): Folded {
  const key = `${locale}|${entry.id}`
  let found = foldedCache.get(key)
  if (!found) {
    const catalog = CATALOGS[locale]
    const text: { label: string; section?: string; keywords: string[] } = catalog.search.entries[entry.id]
    found = {
      label: fold(text.label).split(' '),
      keywords: fold(text.keywords.join(' ')).split(' '),
      place: fold(`${catalog.pages[entry.page]} ${text.section ?? ''}`).split(' '),
      wholes: [text.label, ...text.keywords].map(fold),
    }
    foldedCache.set(key, found)
  }
  return found
}

/** A configuração com os textos do idioma. */
function match(locale: Locale, entry: SettingEntry): SettingMatch {
  const catalog = CATALOGS[locale]
  const text: { label: string; section?: string } = catalog.search.entries[entry.id]
  const page = catalog.pages[entry.page]
  return { ...entry, label: text.label, section: text.section, where: text.section ? `${page} · ${text.section}` : page }
}

/** Configurações que batem com a busca, das mais certeiras pras menos. */
export function searchSettings(query: string, context: SettingContext): SettingMatch[] {
  const locale = context.locale ?? 'pt'
  const whole = fold(query)
  const terms = whole.split(' ').filter(Boolean)
  if (terms.length === 0) return []
  const results: { entry: SettingEntry; score: number }[] = []
  for (const entry of SETTINGS) {
    if ((entry.staff && !context.staff) || (entry.platform && !context.platform) || (entry.desktop && !context.desktop) || (entry.hyprland && !context.hyprland)) continue
    const own = folded(locale, entry)
    const others = OTHERS[locale].map((other) => folded(other, entry))
    let score = 0
    let all = true
    for (const term of terms) {
      // O nome vale mais que as palavras-chave, que valem mais que a página; os outros idiomas, menos.
      let hit = Math.max(wordScore(term, own.label) * 2, wordScore(term, own.keywords) * 1.4, wordScore(term, own.place))
      for (const other of others) hit = Math.max(hit, Math.max(wordScore(term, other.label), wordScore(term, other.keywords)) * 1.1)
      if (hit === 0) {
        all = false
        break
      }
      score += hit
    }
    if (!all) continue
    // A busca inteira é o nome ou uma das palavras-chave: é isso que a pessoa quer.
    if (own.wholes.includes(whole)) score += 3
    else if (others.some((other) => other.wholes.includes(whole))) score += 2
    results.push({ entry, score })
  }
  return results.sort((a, b) => b.score - a.score).map((r) => match(locale, r.entry))
}
