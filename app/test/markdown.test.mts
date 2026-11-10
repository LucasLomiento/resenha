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

test('emoji seguido de texto não trava a conferência do "emoji grande" (era exponencial)', () => {
  const flag = String.fromCodePoint(0x1f1e7, 0x1f1f7)
  const heart = String.fromCodePoint(0x2764, 0xfe0f)
  const keycap = '1' + String.fromCodePoint(0xfe0f, 0x20e3)
  const started = performance.now()
  for (const emoji of [flag, heart, keycap]) {
    // 14 bandeiras + uma palavra levavam 4 s; 20, horas.
    assert.equal(isJumbo(emoji.repeat(40) + ' brasil'), false)
    assert.equal(isJumbo(emoji.repeat(600) + ' x'), false)
    assert.equal(isJumbo(emoji.repeat(5)), true)
  }
  assert.ok(performance.now() - started < 200, `levou ${Math.round(performance.now() - started)} ms`)
  // Muito emoji junto passa do limite de 27 (e do de tamanho): tamanho normal.
  assert.equal(isJumbo(flag.repeat(28)), false)
  assert.equal(isJumbo(flag.repeat(27)), true)
})

test('formatação dentro de formatação tem teto: milhares de asteriscos não viram mil negritos aninhados', () => {
  const depth = (nodes: ReturnType<typeof parseInline>): number =>
    1 + Math.max(0, ...nodes.map((n) => ('children' in n ? depth(n.children) : 0)))
  for (const mark of ['*', '_', '~', '|']) {
    const tree = parseInline(mark.repeat(4000))
    assert.ok(depth(tree) <= 12, `${mark}: profundidade ${depth(tree)}`)
  }
  // O que a pessoa escreveu continua todo lá (como texto, depois do teto).
  const text = (nodes: ReturnType<typeof parseInline>): string =>
    nodes.map((n) => ('children' in n ? text(n.children) : 'text' in n ? n.text : '')).join('')
  assert.ok(text(parseInline('**'.repeat(30) + 'oi' + '**'.repeat(30))).includes('oi'))
  // Aninhado de verdade, raso, continua valendo.
  assert.deepEqual(parseInline('**a __b *c* b__ a**'), [
    {
      t: 'bold',
      children: [
        { t: 'text', text: 'a ' },
        { t: 'underline', children: [{ t: 'text', text: 'b ' }, { t: 'italic', children: [{ t: 'text', text: 'c' }] }, { t: 'text', text: ' b' }] },
        { t: 'text', text: ' a' },
      ],
    },
  ])
})
