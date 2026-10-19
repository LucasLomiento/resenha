import assert from 'node:assert/strict'
import { test } from 'node:test'

const { whenTrayHostReady } = await import('../src/main/tray-host.ts')
type TrayHost = 'ready' | 'waiting' | 'absent' | 'unknown'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Respostas em sequência pra pergunta "a barra está pronta?" (a última se repete). */
function answers(...list: TrayHost[]) {
  let asked = 0
  const ask = async () => list[Math.min(asked++, list.length - 1)]
  return { ask, asked: () => asked }
}

test('com a barra pronta, o ícone nasce na hora', async () => {
  let created = 0
  whenTrayHostReady(() => created++, { ask: answers('ready').ask, interval: 5, wayland: true })
  await wait(20)
  assert.equal(created, 1)
})

test('no login, antes da barra: espera ela ficar pronta e cria uma vez só', async () => {
  const host = answers('waiting', 'absent', 'ready')
  let created = 0
  whenTrayHostReady(() => created++, { ask: host.ask, interval: 5, wayland: true })
  await wait(5)
  assert.equal(created, 0)
  await wait(60)
  assert.equal(created, 1)
  assert.equal(host.asked(), 3)
})

test('sem como perguntar (sem busctl), cria na hora como antes', async () => {
  let created = 0
  whenTrayHostReady(() => created++, { ask: answers('unknown').ask, interval: 5, wayland: true })
  await wait(20)
  assert.equal(created, 1)
})

test('X11 sem watcher nenhum (bandeja XEmbed): cria na hora', async () => {
  let created = 0
  whenTrayHostReady(() => created++, { ask: answers('absent').ask, interval: 5, wayland: false })
  await wait(20)
  assert.equal(created, 1)
})

test('X11 com watcher mas sem barra: passado o limite cria do mesmo jeito', async () => {
  let created = 0
  let gaveUp = 0
  whenTrayHostReady(() => created++, { ask: answers('waiting').ask, interval: 5, limit: 30, wayland: false, onGiveUp: () => gaveUp++ })
  await wait(15)
  assert.equal(created, 0)
  await wait(60)
  assert.equal(created, 1)
  assert.equal(gaveUp, 0)
})

test('Wayland sem barra nenhuma: passado o limite desiste (sem ícone que não aparece) e cria se ela chegar depois', async () => {
  const sequence: TrayHost[] = Array(12).fill('absent')
  const host = answers(...sequence, 'ready')
  let created = 0
  let gaveUp = 0
  whenTrayHostReady(() => created++, { ask: host.ask, interval: 5, limit: 30, slowInterval: 5, wayland: true, onGiveUp: () => gaveUp++ })
  await wait(45)
  assert.equal(created, 0)
  assert.equal(gaveUp, 1)
  await wait(120)
  assert.equal(created, 1)
  assert.equal(gaveUp, 1)
})

test('bandeja desligada no meio da espera: não cria nada', async () => {
  const host = answers('waiting', 'waiting', 'ready')
  let created = 0
  const cancel = whenTrayHostReady(() => created++, { ask: host.ask, interval: 5, wayland: true })
  await wait(7)
  cancel()
  await wait(40)
  assert.equal(created, 0)
})

test('fora do Linux nem pergunta', () => {
  const host = answers('waiting')
  let created = 0
  whenTrayHostReady(() => created++, { ask: host.ask, platform: 'win32' })
  assert.equal(created, 1)
  assert.equal(host.asked(), 0)
})
