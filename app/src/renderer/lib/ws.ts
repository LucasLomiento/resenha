import type { ClientMessage, ServerMessage } from '../../../../shared/protocol'

export type ConnectionStatus = 'connecting' | 'open' | 'offline'

/**
 * WebSocket com reconexão automática. Manda "ping" a cada 20 s; o servidor
 * responde "pong" sem acordar o Durable Object, e se a resposta parar de vir
 * a conexão é dada como morta e reaberta.
 */
export class Connection {
  private ws: WebSocket | null = null
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastPong = 0
  private closed = false

  constructor(
    private url: () => string,
    private handlers: {
      message: (msg: ServerMessage) => void
      status: (status: ConnectionStatus) => void
      /** Servidor recusou a sessão (código 4001): precisa logar de novo. */
      unauthorized: () => void
    },
  ) {}

  connect() {
    this.closed = false
    this.open()
  }

  private open() {
    this.handlers.status('connecting')
    const ws = new WebSocket(this.url())
    this.ws = ws

    ws.onopen = () => {
      this.retry = 0
      this.lastPong = Date.now()
      this.handlers.status('open')
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastPong > 50_000) return ws.close(4000, 'sem pong')
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 20_000)
    }

    ws.onmessage = (event) => {
      if (event.data === 'pong') {
        this.lastPong = Date.now()
        return
      }
      this.lastPong = Date.now()
      try {
        this.handlers.message(JSON.parse(event.data))
      } catch (err) {
        console.error('mensagem inválida do servidor', err)
      }
    }

    ws.onclose = (event) => {
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = null
      if (this.ws !== ws) return
      this.ws = null
      if (event.code === 4001) return this.handlers.unauthorized()
      if (this.closed) return
      this.handlers.status('offline')
      const delay = [500, 1000, 2000, 5000, 10_000][Math.min(this.retry++, 4)]
      this.retryTimer = setTimeout(() => this.open(), delay)
    }
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  close() {
    this.closed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.ws?.close(1000)
    this.ws = null
  }
}
