import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Message } from '../../shared/protocol.ts'
import { freshTail } from '../src/renderer/lib/history.ts'

/** Mensagem com id de 3 dígitos (a ordem do id é a do tempo). */
const msg = (n: number, content = `m${n}`) => ({ id: String(n).padStart(3, '0'), content }) as unknown as Message
const ids = (list: Message[]) => list.map((m) => Number(m.id))
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i))

test('queda rápida: as antigas ficam, o trecho recente entra e nada some da tela', () => {
  const current = range(1, 60)
  const { messages, kept } = freshTail(current, range(11, 62), '060')
  assert.equal(kept, true)
  assert.deepEqual(ids(messages), ids(range(1, 62)))
})

test('o que foi apagado ou editado durante a queda se acerta dentro do trecho', () => {
  const current = range(1, 60)
  const page = range(11, 60).filter((m) => m.id !== '030')
  page[0] = msg(11, 'editada')
  const { messages } = freshTail(current, page, '060')
  assert.equal(messages.some((m) => m.id === '030'), false)
  assert.equal(messages.find((m) => m.id === '011')?.content, 'editada')
  assert.equal(messages.length, 59)
})

test('a última da tela apagada durante a queda não volta', () => {
  const current = range(1, 60)
  const { messages } = freshTail(current, range(11, 59), '060')
  assert.equal(messages.at(-1)?.id, '059')
})

test('o que chegou depois do pedido fica no fim', () => {
  const current = [...range(1, 60), msg(70)]
  const { messages } = freshTail(current, range(11, 62), '060')
  assert.deepEqual(ids(messages).slice(-3), [61, 62, 70])
})

test('queda longa (buraco entre a tela e o trecho): fica só o trecho', () => {
  const current = [...range(1, 20), msg(300)]
  const { messages, kept } = freshTail(current, range(201, 250), '020')
  assert.equal(kept, false)
  assert.deepEqual(ids(messages), [...ids(range(201, 250)), 300])
})

test('canal esvaziado durante a queda: só sobra o que chegou depois', () => {
  const { messages, kept } = freshTail([...range(1, 5), msg(9)], [], '005')
  assert.equal(kept, false)
  assert.deepEqual(ids(messages), [9])
})
