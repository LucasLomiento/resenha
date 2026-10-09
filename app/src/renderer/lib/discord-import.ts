// Importar canais de um print do Discord: o servidor lê o print (Workers AI) e
// devolve a estrutura; aqui ela vira um rascunho que a pessoa confere e edita
// antes de criar (channel.import).

import type { ImportedStructure } from '../../../../shared/protocol'
import { m } from './i18n.svelte'

export interface DraftChannel {
  key: number
  name: string
  kind: 'text' | 'voice'
}

export interface DraftCategory {
  key: number
  name: string
  channels: DraftChannel[]
}

export interface Draft {
  channels: DraftChannel[]
  categories: DraftCategory[]
}

let nextKey = 0

/** O lado maior do print que vai pro servidor: lê bem a lista de canais e não pesa. */
const MAX_SIDE = 2048
const MAX_BYTES = 1_400_000

/** Print pronto pra mandar: PNG (texto nítido) até 2048 px; se ficar pesado, JPEG. */
export async function preparePrint(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const png = await canvas.convertToBlob({ type: 'image/png' })
  if (png.size <= MAX_BYTES) return png
  for (const quality of [0.92, 0.85, 0.75]) {
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    if (jpeg.size <= MAX_BYTES) return jpeg
  }
  throw new Error(m.lib.discordImport.printTooBig)
}

/** O Discord mostra categoria em CAIXA ALTA; aqui elas ficam em caixa normal ("BATE-PAPO" vira "Bate-papo"). */
export function prettyCategory(name: string): string {
  const letters = name.replace(/[^\p{L}]/gu, '')
  if (!letters || letters !== letters.toUpperCase()) return name
  const lower = name.toLocaleLowerCase('pt-BR')
  const first = lower.search(/\p{L}/u)
  return lower.slice(0, first) + lower.charAt(first).toLocaleUpperCase('pt-BR') + lower.slice(first + 1)
}

/** Sem o emoji e o separador da frente ("💬┃geral" vira "geral"). Se não sobrar nada, fica como estava. */
export function plainName(name: string): string {
  const bare = name
    // Emoji e os pedaços dele (tom de pele, bandeira, ZWJ, variação, keycap), mas não dígitos nem "#".
    .replace(/^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}\s]+/u, '')
    .replace(/^[┃|│｜・•·:»>\-–—]+\s*/u, '')
    .trim()
  return bare || name
}

export function toDraft(structure: ImportedStructure): Draft {
  const channel = (c: { name: string; kind: 'text' | 'voice' }): DraftChannel => ({ key: nextKey++, name: c.name, kind: c.kind })
  return {
    channels: structure.channels.map(channel),
    categories: structure.categories.map((cat) => ({ key: nextKey++, name: prettyCategory(cat.name), channels: cat.channels.map(channel) })),
  }
}

/** O que vai pro servidor: nomes limpos (ou sem emoji), vazios fora. */
export function fromDraft(draft: Draft, keepEmoji: boolean): ImportedStructure {
  const name = (value: string) => (keepEmoji ? value : plainName(value)).replace(/\s+/g, ' ').trim().slice(0, 100)
  const channels = (list: DraftChannel[]) => list.map((c) => ({ name: name(c.name), kind: c.kind })).filter((c) => c.name)
  return {
    server: null,
    channels: channels(draft.channels),
    categories: draft.categories.map((cat) => ({ name: name(cat.name), channels: channels(cat.channels) })).filter((cat) => cat.name),
  }
}

export function countDraft(draft: Draft): { categories: number; text: number; voice: number } {
  const all = [...draft.channels, ...draft.categories.flatMap((c) => c.channels)]
  return {
    categories: draft.categories.length,
    text: all.filter((c) => c.kind === 'text').length,
    voice: all.filter((c) => c.kind === 'voice').length,
  }
}
