// A conexão (lib/ws.ts) com um WebSocket de mentira: o limite de envio, a espera entre
// tentativas e a pausa que o servidor pede (4008).
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  readyState = 1
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  send(text: string) {
    this.sent.push(text)
    if (text === 'ping') this.onmessage?.({ data: 'pong' })
  }
  close() {
    this.readyState = 3
  }
  /** O servidor aceitou e mandou o `ready`. */
  accept() {
    this.onopen?.()
    this.onmessage?.({ data: JSON.stringify({ t: 'ready' }) })
  }
  drop(code: number) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}
;(globalThis as unknown as { WebSocket: typeof FakeSocket }).WebSocket = FakeSocket

const { Connection } = await import('../src/renderer/lib/ws.ts')

function connection() {
  const limited: string[] = []
  const conn = new Connection<{ t: string }, { t: string; n?: number }>(
    () => 'wss://teste',
    () => ({ t: 'auth' }),
    { message: () => {}, status: () => {}, closed: () => {}, limited: (d) => limited.push(d) },
  )
  return { conn, limited }
}

const messages = (socket: FakeSocket) => socket.sent.filter((s) => s !== 'ping' && !s.includes('"auth"'))

test('o limite de envio segura um app em laço: rajada de 150, depois 2 por segundo', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 })
  try {
    FakeSocket.all = []
    const { conn, limited } = connection()
    conn.connect()
    const socket = FakeSocket.all[0]
    socket.accept()
    for (let i = 0; i < 300; i++) assert.equal(conn.send({ t: 'x', n: i }), true)
    assert.equal(messages(socket).length, 150)
    assert.equal(limited.length, 1)
    mock.timers.tick(2000)
    for (let i = 0; i < 20; i++) conn.send({ t: 'x' })
    assert.equal(messages(socket).length, 154)
    // O aviso de descarte passa por fora do limite.
    conn.send({ t: 'incident' }, true)
    assert.equal(messages(socket).length, 155)
    conn.close()
  } finally {
    mock.timers.reset()
  }
})

test('quem cai logo depois de conectar espera cada vez mais; quem ficou de pé volta na hora', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 })
  try {
    FakeSocket.all = []
    const { conn } = connection()
    conn.connect()
    // Aceita e derruba logo (um laço de reconexão): 1ª na hora, depois 1 s, 2 s, 5 s…
    const waits: number[] = []
    for (let i = 0; i < 6; i++) {
      const socket = FakeSocket.all.at(-1)!
      socket.accept()
      socket.drop(1006)
      const before = FakeSocket.all.length
      let waited = 0
      while (FakeSocket.all.length === before) {
        mock.timers.tick(100)
        waited += 100
      }
      waits.push(waited)
    }
    assert.ok(waits[0] <= 300, `primeira: ${waits[0]}`)
    assert.ok(waits[1] >= 700 && waits[2] >= 1500 && waits[3] >= 3700 && waits[4] >= 7500 && waits[5] >= 22_500, waits.join(','))
    // Ficou de pé 30 s: a queda seguinte volta na hora.
    const socket = FakeSocket.all.at(-1)!
    socket.accept()
    mock.timers.tick(31_000)
    socket.drop(1006)
    const before = FakeSocket.all.length
    mock.timers.tick(300)
    assert.equal(FakeSocket.all.length, before + 1)
    conn.close()
  } finally {
    mock.timers.reset()
  }
})

test('pausa (4008): só volta depois de uns 5 min, nem a rede voltando apressa', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 })
  try {
    FakeSocket.all = []
    const { conn } = connection()
    conn.connect()
    const socket = FakeSocket.all[0]
    socket.accept()
    socket.drop(4008)
    conn.nudge()
    conn.probe()
    mock.timers.tick(4 * 60_000)
    assert.equal(FakeSocket.all.length, 1)
    mock.timers.tick(2 * 60_000)
    assert.equal(FakeSocket.all.length, 2)
    conn.close()
  } finally {
    mock.timers.reset()
  }
})
