import assert from 'node:assert/strict'
import { test } from 'node:test'
import { highlight, supports, toTree, type CodeNode } from '../src/renderer/lib/highlight.ts'

/** O texto da árvore, na ordem: tem que ser igual ao que a pessoa escreveu. */
const flat = (nodes: CodeNode[]): string => nodes.map((n) => (typeof n === 'string' ? n : flat(n.children))).join('')
const classes = (nodes: CodeNode[]): string[] => nodes.flatMap((n) => (typeof n === 'string' ? [] : [n.cls, ...classes(n.children)]))

test('a saída do highlight.js vira árvore de dados, com o texto de volta sem escape', () => {
  assert.deepEqual(toTree('<span class="hljs-keyword">const</span> a = <span class="hljs-string">&quot;&lt;b&gt; &amp; &#x27;x&#x27;&quot;</span>'), [
    { cls: 'hljs-keyword', children: ['const'] },
    ' a = ',
    { cls: 'hljs-string', children: ['"<b> & \'x\'"'] },
  ])
  assert.deepEqual(toTree('<span class="hljs-string">`a <span class="hljs-subst">${b}</span>`</span>'), [
    { cls: 'hljs-string', children: ['`a ', { cls: 'hljs-subst', children: ['${b}'] }, '`'] },
  ])
  assert.deepEqual(toTree(''), [])
})

test('qualquer coisa fora do formato (outra tag, atributo a mais, span sem fechar) dá null', () => {
  assert.equal(toTree('<script>alert(1)</script>'), null)
  assert.equal(toTree('<span class="x" onclick="y">a</span>'), null)
  assert.equal(toTree('<span class="x">a'), null)
  assert.equal(toTree('a</span>'), null)
  assert.equal(toTree('a < b'), null)
  assert.equal(toTree('&nbsp;'), null)
})

test('pinta as linguagens conhecidas (e os apelidos) sem perder nem mudar o texto', () => {
  const samples: [string, string][] = [
    ['ts', 'const x: number = 1 // <b>&amp;</b>\nfunction f(a: string) { return `${a}` }'],
    ['js', 'if (a < b && c > d) console.log("oi")'],
    ['py', 'def f(x):\n    return x < 2 and "a" or \'b\''],
    ['json', '{ "a": [1, true, null], "b": "<>" }'],
    ['sh', 'echo "$(ls -la)" && cd ~ # fim'],
    ['shell', 'npm run build'],
    ['html', '<div class="a">&amp; texto</div>'],
    ['css', '.a > b { color: #fff; }'],
    ['sql', "SELECT * FROM t WHERE a < 1 AND b = 'x'"],
    ['diff', '-velho\n+novo'],
    ['rust', 'fn main() { let v: Vec<u8> = vec![]; }'],
    ['c++', 'std::vector<int> v; // &'],
    ['yml', 'a: 1\nb: "dois"'],
  ]
  for (const [lang, code] of samples) {
    assert.ok(supports(lang), `${lang} é conhecida`)
    const tree = highlight(lang, code)
    assert.ok(tree, `${lang} pintou`)
    assert.equal(flat(tree), code, `${lang}: o texto é o mesmo`)
    assert.ok(
      classes(tree).every((cls) => /^[\w -]+$/.test(cls)),
      `${lang}: só nomes de classe`,
    )
  }
  assert.ok(classes(highlight('ts', 'const a = 1')!).includes('hljs-keyword'))
})

test('sem linguagem ou com uma desconhecida, o bloco fica sem cor', () => {
  assert.equal(supports(''), false)
  assert.equal(supports('klingon'), false)
  assert.equal(highlight('', 'const a = 1'), null)
  assert.equal(highlight('klingon', 'const a = 1'), null)
  // Nome de propriedade de objeto não é linguagem.
  assert.equal(supports('constructor'), false)
  assert.equal(supports('__proto__'), false)
})
