import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moveId, orderBy } from '../src/renderer/lib/guild-order.ts'

const guilds = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
const ids = (list: { id: string }[]) => list.map((g) => g.id).join('')

test('sem ordem escolhida, vale a do servidor', () => {
  assert.equal(orderBy(guilds, []), guilds)
})

test('a ordem escolhida vale; servidor novo vai pro fim e id que não existe mais é ignorado', () => {
  assert.equal(ids(orderBy(guilds, ['c', 'a'])), 'cabd')
  assert.equal(ids(orderBy(guilds, ['d', 'sumiu', 'b', 'a', 'c'])), 'dbac')
  assert.equal(ids(orderBy([], ['a'])), '')
})

test('arrastar pra antes ou depois de outro', () => {
  const list = ['a', 'b', 'c', 'd']
  assert.deepEqual(moveId(list, 'd', 'a', 'before'), ['d', 'a', 'b', 'c'])
  assert.deepEqual(moveId(list, 'a', 'c', 'after'), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveId(list, 'a', 'b', 'before'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(moveId(list, 'b', 'd', 'after'), ['a', 'c', 'd', 'b'])
  // Em cima dele mesmo, ou id que não está na lista: nada muda.
  assert.deepEqual(moveId(list, 'b', 'b', 'after'), list)
  assert.deepEqual(moveId(list, 'x', 'a', 'before'), list)
  assert.deepEqual(moveId(list, 'a', 'x', 'before'), list)
})
