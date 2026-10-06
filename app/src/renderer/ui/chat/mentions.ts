import type { MentionNames } from './Markdown.svelte'

// No campo de texto a pessoa vê "@Fulano" e "#canal"; pro servidor vai
// "<@id>" e "<#id>". Aqui ficam as duas conversões.

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Converte o texto digitado: cada "@Nome" escolhido na lista vira o token com id. */
export function toRaw(text: string, tokens: Map<string, string>): string {
  let out = text
  // Nomes mais compridos primeiro: "@Ana Paula" antes de "@Ana".
  for (const display of [...tokens.keys()].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`${escape(display)}(?![\\p{L}\\p{N}_])`, 'gu'), tokens.get(display)!)
  }
  return out
}

/** Pra editar uma mensagem: os tokens viram nomes de novo (e o mapa volta junto). */
export function toEditable(content: string, names: MentionNames): { text: string; tokens: Map<string, string> } {
  const tokens = new Map<string, string>()
  const text = content
    .replace(/<@!?([\w-]{1,64})>/g, (raw, id: string) => {
      const display = `@${names.user(id)}`
      tokens.set(display, `<@${id}>`)
      return display
    })
    .replace(/<@&([\w-]{1,64})>/g, (raw, id: string) => {
      const role = names.role(id)
      if (!role) return raw
      const display = `@${role.name}`
      tokens.set(display, raw)
      return display
    })
    .replace(/<#([\w-]{1,64})>/g, (raw, id: string) => {
      const channel = names.channel(id)
      if (!channel) return raw
      const display = `#${channel.name}`
      tokens.set(display, raw)
      return display
    })
  return { text, tokens }
}
