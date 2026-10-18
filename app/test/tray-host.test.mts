import assert from 'node:assert/strict'
import { test } from 'node:test'

const { whenTrayHostReady } = await import('../src/main/tray-host.ts')

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Respostas em sequência pra pergunta "a barra está pronta?" (a última se repete). */
function answers(...list: (boolean | null)[]) {
  let asked = 0
  const ask = async () => list[Math.min(asked++, list.length - 1)]
  return { ask, asked: () => asked }
}

test('com a barra pronta, o ícone nasce na hora', async () => {
  let created = 0
  whenTrayHostReady(() => created++, { ask: answers(true).ask, interval: 5 })
  await wait(20)
  assert.equal(created, 1)
})

test('no login, antes da barra: espera ela ficar pronta e cria uma vez só', async () => {
  const host = answers(false, false, true)
  let created = 0
  whenTrayHostReady(() => created++, { ask: host.ask, interval: 5 })
  await wait(5)
  assert.equal(created, 0)
  await wait(60)
  assert.equal(created, 1)
  assert.equal(host.asked(), 3)
})

test('sem como perguntar (sem busctl), cria na hora como antes', async () => {
  let created = 0
  whenTrayHostReady(() => created++, { ask: answers(null).ask, interval: 5 })
  await wait(20)
  assert.equal(created, 1)
})

test('sem barra nenhuma, passado o limite cria do mesmo jeito', async () => {
  let created = 0
  whenTrayHostReady(() => created++, { ask: answers(false).ask, interval: 5, limit: 30 })
  await wait(15)
  assert.equal(created, 0)
  await wait(60)
  assert.equal(created, 1)
})

test('bandeja desligada no meio da espera: não cria nada', async () => {
  const host = answers(false, false, true)
  let created = 0
  const cancel = whenTrayHostReady(() => created++, { ask: host.ask, interval: 5 })
  await wait(7)
  cancel()
  await wait(40)
  assert.equal(created, 0)
})

test('fora do Linux nem pergunta', () => {
  const host = answers(false)
  let created = 0
  whenTrayHostReady(() => created++, { ask: host.ask, platform: 'win32' })
  assert.equal(created, 1)
  assert.equal(host.asked(), 0)
})
