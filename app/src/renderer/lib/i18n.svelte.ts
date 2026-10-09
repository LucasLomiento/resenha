// Idiomas do app (português, inglês e espanhol). Os textos ficam nos catálogos em
// `lib/i18n/<idioma>/<área>.ts`: o português é a fonte, e os outros dois têm que ter
// exatamente as mesmas chaves (o `satisfies` de cada arquivo confere na checagem de tipos).
// Como usar: `m.chat.send` (texto) ou `m.chat.typing(nome)` (texto com valores), lido na
// hora de mostrar (no template, num `$derived` ou numa função), nunca guardado numa
// constante: trocar o idioma atualiza a tela na hora, sem recarregar.

import en from './i18n/en'
import es from './i18n/es'
import pt from './i18n/pt'
import { SERVER_PATTERNS } from './i18n/server-patterns'
import { settings } from './settings.svelte'

export type Locale = 'pt' | 'en' | 'es'
export type Messages = typeof pt

const CATALOGS: Record<Locale, Messages> = { pt, en, es }

/** Os idiomas na escolha das configurações, cada um escrito no próprio idioma. */
export const LOCALES: { id: Locale; name: string; intl: string }[] = [
  { id: 'pt', name: 'Português (Brasil)', intl: 'pt-BR' },
  { id: 'en', name: 'English', intl: 'en-US' },
  { id: 'es', name: 'Español', intl: 'es-419' },
]

const INTL = Object.fromEntries(LOCALES.map((l) => [l.id, l.intl])) as Record<Locale, string>

/** O idioma do sistema, se for um dos três; senão, inglês. */
export function systemLocale(languages: readonly string[] = navigator.languages ?? [navigator.language]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split(/[-_]/)[0]
    if (base === 'pt' || base === 'en' || base === 'es') return base
  }
  return 'en'
}

const system = systemLocale()

export const i18n = {
  /** O idioma em uso: o escolhido nas configurações, ou o do sistema no automático. */
  get locale(): Locale {
    return settings.language === 'auto' ? system : settings.language
  },
  /** Etiqueta pro Intl (datas, números, ordem alfabética): pt-BR, en-US ou es-419. */
  get intl(): string {
    return INTL[this.locale]
  },
  system,
}

/** Os textos do idioma em uso. Ler `m.área.chave` dentro do template já reage à troca. */
export const m: Messages = new Proxy({} as Messages, {
  get: (_, key) => CATALOGS[i18n.locale][key as keyof Messages],
})

/**
 * Mensagem do servidor (que responde em português) no idioma em uso: pelo texto exato,
 * ou por um padrão quando tem parte variável. A que não está no catálogo vai como veio.
 */
export function serverText(message: string): string {
  const errors = m.errors as { server: Record<string, string>; dynamic: Record<string, (...parts: string[]) => string> }
  const exact = errors.server[message]
  if (exact) return exact
  for (const { re, key } of SERVER_PATTERNS) {
    const found = re.exec(message)
    if (found) return errors.dynamic[key as string](...found.slice(1))
  }
  return message
}

/** Os textos de um idioma qualquer (a busca das configurações procura nos três). */
export const messagesOf = (locale: Locale): Messages => CATALOGS[locale]

// ---------- Datas, números e ordem alfabética no idioma em uso ----------

const formatters = new Map<string, unknown>()

function formatter<T>(kind: string, options: object | undefined, make: (locale: string) => T): T {
  const key = `${kind}|${i18n.intl}|${JSON.stringify(options ?? {})}`
  let made = formatters.get(key) as T | undefined
  if (!made) {
    made = make(i18n.intl)
    formatters.set(key, made)
  }
  return made
}

export const fmt = {
  date: (value: number | Date, options?: Intl.DateTimeFormatOptions) =>
    formatter('date', options, (l) => new Intl.DateTimeFormat(l, options)).format(value),
  number: (value: number, options?: Intl.NumberFormatOptions) =>
    formatter('number', options, (l) => new Intl.NumberFormat(l, options)).format(value),
  relative: (value: number, unit: Intl.RelativeTimeFormatUnit, options: Intl.RelativeTimeFormatOptions = { numeric: 'auto' }) =>
    formatter('relative', options, (l) => new Intl.RelativeTimeFormat(l, options)).format(value, unit),
  /** "Ana, Bia e Caio" / "Ana, Bia and Caio" / "Ana, Bia y Caio". */
  list: (items: string[], options: Intl.ListFormatOptions = { type: 'conjunction' }) =>
    formatter('list', options, (l) => new Intl.ListFormat(l, options)).format(items),
  /** Nome de país/região pelo código (BR → Brasil / Brazil). */
  region: (code: string) => formatter('region', undefined, (l) => new Intl.DisplayNames([l], { type: 'region' })).of(code) ?? code,
  /** Pra ordenar nomes: `lista.sort((a, b) => fmt.compare(a.nome, b.nome))`. */
  compare: (a: string, b: string) => a.localeCompare(b, i18n.intl),
}

/**
 * Texto com uma parte destacada no meio (negrito, link): `around(m.x.texto(…), '{nome}')`
 * devolve [antes, depois], e o template põe o destaque entre os dois. Cada idioma escolhe
 * onde o marcador fica na frase.
 */
export function around(text: string, marker: string): [string, string] {
  const at = text.indexOf(marker)
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + marker.length)]
}

// O <html lang> e o processo principal (bandeja, avisos do sistema, corretor) seguem o idioma.
$effect.root(() => {
  $effect(() => {
    const locale = i18n.locale
    document.documentElement.lang = INTL[locale]
    window.resenha?.setLocale?.(locale)
  })
})
