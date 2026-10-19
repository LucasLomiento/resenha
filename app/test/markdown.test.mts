import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyText, isJumbo, parseInline, parseMarkdown, plainText } from '../src/renderer/lib/markdown.ts'

test('negrito, itálico, sublinhado, riscado, spoiler e código', () => {
  assert.deepEqual(parseInline('**a** *b* __c__ ~~d~~ ||e|| `f`'), [
    { t: 'bold', children: [{ t: 'text', text: 'a' }] },
    { t: 'text', text: ' ' },
    { t: 'italic', children: [{ t: 'text', text: 'b' }] },
    { t: 'text', text: ' ' },
    { t: 'underline', children: [{ t: 'text', text: 'c' }] },
    { t: 'text', text: ' ' },
    { t: 'strike', children: [{ t: 'text', text: 'd' }] },
    { t: 'text', text: ' ' },
    { t: 'spoiler', children: [{ t: 'text', text: 'e' }] },
    { t: 'text', text: ' ' },
    { t: 'code', text: 'f' },
  ])
})

test('aninhado e escapado', () => {
  assert.deepEqual(parseInline('**negrito *e itálico***'), [
    { t: 'bold', children: [{ t: 'text', text: 'negrito ' }, { t: 'italic', children: [{ t: 'text', text: 'e itálico' }] }] },
  ])
  assert.deepEqual(parseInline('\\*não\\*'), [{ t: 'text', text: '*' }, { t: 'text', text: 'não' }, { t: 'text', text: '*' }])
  assert.deepEqual(parseInline('`**cru**`'), [{ t: 'code', text: '**cru**' }])
})

test('nome_de_arquivo não vira itálico, mas _isso_ vira', () => {
  assert.deepEqual(parseInline('meu_arquivo_novo.txt'), [{ t: 'text', text: 'meu_arquivo_novo.txt' }])
  assert.deepEqual(parseInline('um _isso_ aí'), [
    { t: 'text', text: 'um ' },
    { t: 'italic', children: [{ t: 'text', text: 'isso' }] },
    { t: 'text', text: ' aí' },
  ])
})

test('links, menções e @everyone', () => {
  assert.deepEqual(parseInline('veja https://a.com/x_(y), <@u1> <@&r1> <#c1> @everyone'), [
    { t: 'text', text: 'veja ' },
    { t: 'link', url: 'https://a.com/x_(y)' },
    { t: 'text', text: ', ' },
    { t: 'user', id: 'u1' },
    { t: 'text', text: ' ' },
    { t: 'role', id: 'r1' },
    { t: 'text', text: ' ' },
    { t: 'channel', id: 'c1' },
    { t: 'text', text: ' ' },
    { t: 'everyone', text: '@everyone' },
  ])
  assert.deepEqual(parseInline('email@everyone.com'), [{ t: 'text', text: 'email@everyone.com' }])
  assert.deepEqual(parseInline('<https://b.com>'), [{ t: 'link', url: 'https://b.com' }])
  assert.deepEqual(parseInline('javascript:alert(1)'), [{ t: 'text', text: 'javascript:alert(1)' }])
})

test('blocos: código, citação, título e lista', () => {
  assert.deepEqual(parseMarkdown('olha:\n```js\nconst a = 1\n```\n> citado\n> de novo\n# Título\n- um\n- dois\n1. a\n2. b'), [
    { t: 'paragraph', children: [{ t: 'text', text: 'olha:' }] },
    { t: 'code', lang: 'js', text: 'const a = 1' },
    { t: 'quote', children: [{ t: 'paragraph', children: [{ t: 'text', text: 'citado' }, { t: 'br' }, { t: 'text', text: 'de novo' }] }] },
    { t: 'heading', level: 1, children: [{ t: 'text', text: 'Título' }] },
    { t: 'list', ordered: false, start: 1, items: [[{ t: 'text', text: 'um' }], [{ t: 'text', text: 'dois' }]] },
    { t: 'list', ordered: true, start: 1, items: [[{ t: 'text', text: 'a' }], [{ t: 'text', text: 'b' }]] },
  ])
  assert.deepEqual(parseMarkdown('>>> tudo\ncitado'), [
    { t: 'quote', children: [{ t: 'paragraph', children: [{ t: 'text', text: 'tudo' }, { t: 'br' }, { t: 'text', text: 'citado' }] }] },
  ])
  assert.deepEqual(parseMarkdown('<script>alert(1)</script>'), [
    { t: 'paragraph', children: [{ t: 'text', text: '<script>alert(1)</script>' }] },
  ])
})

test('emoji grande só quando a mensagem é só emoji', () => {
  assert.equal(isJumbo('😂'), true)
  assert.equal(isJumbo('👍🏽 🇧🇷 👨‍👩‍👧'), true)
  assert.equal(isJumbo('oi 😂'), false)
  assert.equal(isJumbo('123'), false)
  assert.equal(isJumbo('😂'.repeat(28)), false)
  // Número junto do emoji não vira texto gigante; o emoji de tecla (1️⃣) continua grande.
  assert.equal(isJumbo('2 🍕'), false)
  assert.equal(isJumbo('1 2 3 😀'), false)
  assert.equal(isJumbo('#1 🍕'), false)
  assert.equal(isJumbo('1️⃣ 🔟'), true)
  assert.equal(isJumbo('❤️‍🔥 ☠️'), true)
})

test('texto puro com nomes', () => {
  const names = { user: () => 'Lucas', role: () => 'Mod', channel: () => 'geral' }
  assert.equal(plainText('**oi** <@1> <@&2> <#3> ||segredo||', names), 'oi @Lucas @Mod #geral ▒▒▒')
})

test('copiar texto: só as menções viram nomes, o resto fica como foi escrito', () => {
  const names = { user: () => 'Lucas', role: () => 'Mod', channel: () => 'geral' }
  assert.equal(copyText('def __init__(self, *args): return a * b', names), 'def __init__(self, *args): return a * b')
  assert.equal(copyText('2*3=6 `x` <@1> <@&2> <#3> ||segredo||', names), '2*3=6 `x` @Lucas @Mod #geral ||segredo||')
})
