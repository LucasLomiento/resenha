// Toda mensagem que o servidor manda (em português) tem tradução em `m.errors`: pelo texto
// exato (`server`) ou por um padrão de `server-patterns.ts` (`dynamic`). Erro novo no
// servidor sem tradução faz este teste falhar.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import en from '../src/renderer/lib/i18n/en/errors.ts'
import es from '../src/renderer/lib/i18n/es/errors.ts'
import pt from '../src/renderer/lib/i18n/pt/errors.ts'
import { SERVER_PATTERNS } from '../src/renderer/lib/i18n/server-patterns.ts'

const SERVER_SRC = join(import.meta.dirname, '../../server/src')

// Frases do servidor que o app não mostra (vão pro arquivo exportado, não pra tela).
const NOT_SHOWN = new Set(['As mensagens ficam em cada servidor e conversa; você pode apagar as suas a qualquer momento.'])

// O que entra no lugar de cada `${…}` de uma mensagem com parte variável.
const SAMPLE = '7'

type Catalog = { server: Record<string, string>; dynamic: Record<string, (...parts: string[]) => string> }
const CATALOGS = { pt, en, es } as unknown as Record<'pt' | 'en' | 'es', Catalog>

type Found = { text: string; dynamic: boolean; where: string }

const SQL = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|PRAGMA)\b/
/** Frase de gente: maiúscula no começo, com espaço, uma linha só, termina em . ! ? ou … */
const looksLikeSentence = (text: string) =>
  /^[A-ZÀ-Ý]/.test(text) && /\s/.test(text) && !text.includes('\n') && /\S[.!?…]$/.test(text) && !SQL.test(text)

/** O literal é o texto passado direto pra um erro: `fail(…)`, `error(…)`, `{ error: … }`, `{ message: … }`. */
function errorArgument(node: ts.Node): boolean {
  // Sobe pelos `a ? 'x' : 'y'`, `a ?? 'x'` e parênteses (a condição do `?` não conta).
  const passes = (child: ts.Node, parent: ts.Node) =>
    ts.isParenthesizedExpression(parent) ||
    (ts.isConditionalExpression(parent) && child !== parent.condition) ||
    (ts.isBinaryExpression(parent) &&
      (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken))
  let at = node
  while (passes(at, at.parent)) at = at.parent
  const parent = at.parent
  if (ts.isCallExpression(parent) && parent.arguments.includes(at as ts.Expression)) {
    const callee = parent.expression
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
    return name === 'fail' || name === 'error'
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === at && ts.isIdentifier(parent.name)) {
    return parent.name.text === 'error' || parent.name.text === 'message'
  }
  return false
}

const isConsoleCall = (node: ts.Node) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === 'console'

/** As mensagens do `server/src`, lidas pela árvore do TypeScript (comentários e console ficam de fora). */
function serverMessages(): Found[] {
  const found: Found[] = []
  for (const file of readdirSync(SERVER_SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))) {
    const source = ts.createSourceFile(file, readFileSync(join(SERVER_SRC, file), 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      if (isConsoleCall(node)) return
      let text: string | null = null
      let dynamic = false
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text
      else if (ts.isTemplateExpression(node)) {
        text = node.head.text + node.templateSpans.map((span) => SAMPLE + span.literal.text).join('')
        dynamic = true
      }
      if (text !== null && !NOT_SHOWN.has(text) && (looksLikeSentence(text) || errorArgument(node))) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
        found.push({ text, dynamic, where: `${file}:${line}` })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found
}

/** O mesmo caminho do `serverText` (lib/i18n.svelte.ts), sem o Svelte. */
function translate(catalog: Catalog, message: string): string | null {
  const exact = catalog.server[message]
  if (exact) return exact
  for (const { re, key } of SERVER_PATTERNS) {
    const found = re.exec(message)
    if (found) return catalog.dynamic[key](...found.slice(1))
  }
  return null
}

const messages = serverMessages()
const statics = messages.filter((m) => !m.dynamic)
const dynamics = messages.filter((m) => m.dynamic)

test('acha as mensagens do servidor', () => {
  // Se a leitura quebrar (arquivo mudou de lugar, etc.), não passa achando zero.
  assert.ok(statics.length > 100, `só achou ${statics.length} mensagens fixas`)
  assert.ok(dynamics.length >= 10, `só achou ${dynamics.length} mensagens com parte variável`)
  const texts = new Set(messages.map((m) => m.text))
  for (const sample of ['Só o dono da plataforma.', 'Erro no servidor.', 'Calma! Muitas ações de uma vez.', 'Pessoa não encontrada.']) {
    assert.ok(texts.has(sample), `não achou "${sample}"`)
  }
})

test('toda mensagem fixa do servidor está no catálogo', () => {
  const missing = statics.filter((m) => !(m.text in pt.server)).map((m) => `${m.where}  ${m.text}`)
  assert.deepEqual(missing, [], `sem tradução em pt/errors.ts:\n${missing.join('\n')}`)
})

test('toda mensagem com parte variável tem um padrão', () => {
  const missing = dynamics.filter((m) => !SERVER_PATTERNS.some(({ re }) => re.test(m.text))).map((m) => `${m.where}  ${m.text}`)
  assert.deepEqual(missing, [], `sem padrão em server-patterns.ts:\n${missing.join('\n')}`)
})

test('o catálogo não guarda mensagem que o servidor não manda mais', () => {
  const sent = new Set(statics.map((m) => m.text))
  const stale = Object.keys(pt.server).filter((text) => !sent.has(text))
  assert.deepEqual(stale, [], 'o servidor não manda mais (ou o texto mudou)')
  const unused = SERVER_PATTERNS.filter(({ re }) => !dynamics.some((m) => re.test(m.text))).map(({ key }) => key)
  assert.deepEqual(unused, [], 'padrão que não bate com nenhuma mensagem do servidor')
})

test('o português é o próprio texto do servidor', () => {
  for (const [key, value] of Object.entries(pt.server)) assert.equal(value, key)
  for (const m of dynamics) assert.equal(translate(CATALOGS.pt, m.text), m.text, m.where)
})

test('inglês e espanhol têm as mesmas chaves e traduzem de verdade', () => {
  for (const locale of ['en', 'es'] as const) {
    const catalog = CATALOGS[locale]
    assert.deepEqual(Object.keys(catalog.server).sort(), Object.keys(pt.server).sort(), `${locale}: chaves de server`)
    assert.deepEqual(Object.keys(catalog.dynamic).sort(), Object.keys(pt.dynamic).sort(), `${locale}: chaves de dynamic`)
    for (const [key, value] of Object.entries(catalog.server)) {
      assert.ok(typeof value === 'string' && value.trim(), `${locale}: "${key}" vazio`)
      assert.notEqual(value, key, `${locale}: "${key}" ficou em português`)
    }
    for (const [key, make] of Object.entries(catalog.dynamic)) {
      const ptMake = (pt.dynamic as Catalog['dynamic'])[key]
      assert.equal(make.length, ptMake.length, `${locale}: ${key} recebe outro número de partes`)
      const args = Array.from({ length: make.length }, () => SAMPLE)
      const text = make(...args)
      assert.ok(text.trim() && !text.includes('${') && !text.includes('undefined'), `${locale}: ${key} -> "${text}"`)
      assert.notEqual(text, ptMake(...args), `${locale}: ${key} ficou em português`)
    }
  }
})

test('cada mensagem do servidor sai traduzida pelo mesmo caminho do app', () => {
  for (const locale of ['en', 'es'] as const) {
    for (const m of messages) {
      const text = translate(CATALOGS[locale], m.text)
      assert.ok(text, `${locale}: ${m.where} sem tradução: ${m.text}`)
      assert.notEqual(text, m.text, `${locale}: ${m.where} ficou em português`)
    }
  }
  // Tamanho com vírgula vira ponto no inglês e no espanhol.
  assert.equal(translate(CATALOGS.en, 'A imagem pode ter até 1,5 MB.'), 'Images can be up to 1.5 MB.')
  assert.equal(translate(CATALOGS.es, 'Modo lento: espere 12 s pra mandar outra mensagem.'), 'Modo lento: espera 12 s para enviar otro mensaje.')
})
