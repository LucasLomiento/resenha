// Importar canais do Discord por um print: o print da lista de canais vai pra
// um modelo de visão do Workers AI, que devolve as categorias e os canais.
// Quem cria os canais é o app, depois de a pessoa conferir (channel.import no
// Guild). O print não fica guardado em lugar nenhum.
//
// Modelo escolhido testando um print com emoji, separador "┃", gente na call e
// itens que não são canal (Eventos, nome do servidor): o Gemma 4 sem
// "raciocínio" acertou a estrutura toda e quase todos os emojis, por ~18
// neurons (o plano grátis dá 10 mil por dia). Llama 4 e Mistral perderam
// categoria ou acharam que as pessoas da call eram canais; o Qwen acertou menos
// emoji e custa 9 vezes mais.

import type { ImportedStructure, ImportedChannel } from '../../shared/protocol'
import { cleanLine } from './validate'

export const IMPORT_MODEL = '@cf/google/gemma-4-26b-a4b-it'

export const MAX_IMPORT_CATEGORIES = 50
export const MAX_IMPORT_CHANNELS = 300

const PROMPT = `This is a screenshot of a Discord server's channel list (the left sidebar). Extract the channel structure exactly as shown, from top to bottom.

Reply with ONLY a JSON object, no explanations:
{"server": string or null, "categories": [{"name": string, "channels": [{"name": string, "type": "text" | "voice"}]}], "uncategorized": [{"name": string, "type": "text" | "voice"}]}

Rules:
- Category headers are small uppercase labels with a small arrow before them. Channels below a header belong to it, until the next header.
- A channel with a "#" icon (or a megaphone, speech bubble or forum icon) is "text". A channel with a speaker icon is "voice".
- Copy channel names exactly as written, including emojis and separators like "┃", "・" or "|". Do not include the icon itself (the "#" or the speaker).
- Channels above the first category go in "uncategorized".
- Ignore: people listed under voice channels (avatars with names), the server name at the top (put it in "server"), "Events", "Browse Channels", "Channels & Roles" and similar menu items, unread badges and numbers, boost banners, and anything that is not a channel.
- If the image is not a Discord channel list, reply {"server": null, "categories": [], "uncategorized": []}.`

function channel(raw: unknown): ImportedChannel | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const name = cleanLine(value.name, 1, 100)
  if (!name) return null
  return { name, kind: value.type === 'voice' || value.kind === 'voice' ? 'voice' : 'text' }
}

/** Confere o que veio (do modelo ou do app): limites, nomes e tipos. */
export function cleanStructure(raw: unknown): ImportedStructure | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  let total = 0
  const take = (list: unknown): ImportedChannel[] => {
    const out: ImportedChannel[] = []
    for (const item of Array.isArray(list) ? list : []) {
      if (total >= MAX_IMPORT_CHANNELS) break
      const c = channel(item)
      if (c) {
        out.push(c)
        total++
      }
    }
    return out
  }
  const channels = take(value.uncategorized ?? value.channels)
  const categories: ImportedStructure['categories'] = []
  for (const item of Array.isArray(value.categories) ? value.categories : []) {
    if (categories.length >= MAX_IMPORT_CATEGORIES || !item || typeof item !== 'object') break
    const name = cleanLine((item as Record<string, unknown>).name, 1, 100)
    if (!name) continue
    categories.push({ name, channels: take((item as Record<string, unknown>).channels) })
  }
  const server = cleanLine(value.server, 1, 100)
  return { server: server ?? null, categories, channels }
}

/** O JSON no meio da resposta do modelo (às vezes vem com ```json em volta). */
export function parseModelReply(text: string): ImportedStructure | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return cleanStructure(JSON.parse(text.slice(start, end + 1)))
  } catch {
    return null
  }
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Tipo da imagem pelos primeiros bytes (o modelo quer saber). */
function mimeOf(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp'
  return null
}

type Reply = { response?: unknown; choices?: { message?: { content?: unknown } }[] }

/** Lê o print. null: não deu (imagem estranha, modelo fora do ar, resposta sem estrutura). */
export async function readDiscordPrint(ai: Ai, image: ArrayBuffer): Promise<ImportedStructure | null> {
  const bytes = new Uint8Array(image)
  const mime = mimeOf(bytes)
  if (!mime) return null
  const reply = (await ai.run(IMPORT_MODEL as Parameters<Ai['run']>[0], {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64(bytes)}` } },
        ],
      },
    ],
    max_tokens: 3000,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
  } as never)) as Reply
  const text =
    typeof reply.response === 'string'
      ? reply.response
      : typeof reply.choices?.[0]?.message?.content === 'string'
        ? (reply.choices[0].message.content as string)
        : reply.response && typeof reply.response === 'object'
          ? JSON.stringify(reply.response)
          : ''
  return parseModelReply(text)
}
