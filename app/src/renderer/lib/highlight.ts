// Cores nos blocos de código (```ts ... ```), com o highlight.js, como no Discord.
// Este módulo chega sob demanda (import dinâmico no CodeBlock): o highlight.js e as
// linguagens ficam num pedaço à parte, fora do pacote principal. Só as linguagens
// daqui; sem linguagem ou com uma desconhecida, o bloco fica sem cor (sem adivinhar).
//
// O resultado continua sendo árvore de dados, nunca HTML: a saída do highlight.js
// (texto escapado e <span class>) é lida de volta em nós, e a interface monta os
// elementos. Qualquer coisa fora desse formato vira bloco sem cor.

import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/** Texto, ou um trecho com as classes do highlight.js (`hljs-keyword`...) e o que tem dentro. */
export type CodeNode = string | { cls: string; children: CodeNode[] }

const LANGUAGES = { bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, lua, markdown, php, python, rust, sql, typescript, xml, yaml }
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language)
// O "shell" do highlight.js é sessão de terminal (só pinta linha com `$ `); quem escreve
// ```shell quase sempre manda comando solto, então shell vira bash e a sessão fica em ```console.
hljs.registerLanguage('console', shell)
hljs.registerAliases(['shell', 'zsh'], { languageName: 'bash' })

/** Quantos trechos um dentro do outro o bloco pintado pode ter (código de verdade não passa de uns 10). */
const MAX_DEPTH = 40

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" }

/**
 * Saída do highlight.js → árvore. Ele escapa todo o texto (`& < > " '`) e só abre
 * `<span class="...">`; qualquer outra coisa (que não devia aparecer) dá null.
 */
export function toTree(html: string): CodeNode[] | null {
  const root: CodeNode[] = []
  const stack: CodeNode[][] = [root]
  const token = /<span class="([\w -]{1,80})">|<\/span>|&(?:amp|lt|gt|quot|#x27);|[^<&]+/y
  let text = ''
  const flush = () => {
    if (text) stack.at(-1)!.push(text)
    text = ''
  }
  while (token.lastIndex < html.length) {
    const at = token.lastIndex
    const m = token.exec(html)
    if (!m) return null
    if (m[1] !== undefined) {
      flush()
      // Trecho dentro de trecho sem fim (um "`${" repetido 150 vezes dá 150 níveis): desenhar isso
      // estourava a pilha e derrubava a lista de mensagens. Fundo assim, o bloco fica sem cor.
      if (stack.length > MAX_DEPTH) return null
      const node = { cls: m[1], children: [] as CodeNode[] }
      stack.at(-1)!.push(node)
      stack.push(node.children)
    } else if (m[0] === '</span>') {
      flush()
      if (stack.length === 1) return null
      stack.pop()
    } else text += m[0][0] === '&' ? ENTITIES[m[0]] : m[0]
    if (token.lastIndex === at) return null
  }
  flush()
  return stack.length === 1 ? root : null
}

/** Linguagem que este módulo pinta (nome ou apelido: ts, py, sh, yml, c++...). */
export function supports(lang: string): boolean {
  return !!lang && !!hljs.getLanguage(lang)
}

// A lista de mensagens monta e desmonta os blocos ao rolar: guarda os últimos pintados.
const cache = new Map<string, CodeNode[] | null>()

/** O bloco pintado, ou null (linguagem desconhecida ou saída estranha): aí fica sem cor. */
export function highlight(lang: string, text: string): CodeNode[] | null {
  if (!supports(lang)) return null
  const key = `${lang}\n${text}`
  let tree = cache.get(key)
  if (tree === undefined) {
    try {
      tree = toTree(hljs.highlight(text, { language: lang, ignoreIllegals: true }).value)
    } catch {
      tree = null
    }
    if (cache.size >= 200) cache.delete(cache.keys().next().value!)
    cache.set(key, tree)
  }
  return tree
}
