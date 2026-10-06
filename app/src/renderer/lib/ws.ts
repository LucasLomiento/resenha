export type ConnectionStatus = 'connecting' | 'open' | 'offline'

/** Por que o servidor fechou a conexão de vez (não adianta reconectar). */
export type CloseReason = 'unauthorized' | 'not-member' | 'gone'

/**
 * WebSocket com reconexão automática. Manda "ping" a cada 20 s; o servidor
 * responde "pong" sem acordar o Durable Object, e se a resposta parar de vir
 * a conexão é dada como morta e reaberta. Serve tanto pra conexão de cada
 * servidor quanto pra conexão pessoal (Home).
 */
export class Connection<In, Out> {
  private ws: WebSocket | null = null
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastPong = 0
  private closed = false

  constructor(
    private url: () => string,
    /** Primeira mensagem de cada conexão (o `auth` com o token). */
    private hello: () => Out,
    private handlers: {
      message: (msg: In) => void
      status: (status: ConnectionStatus) => void
      /** O servidor fechou de vez: sessão inválida, saiu do servidor ou ele foi excluído. */
      closed: (reason: CloseReason) => void
    },
  ) {}

  connect() {
    this.closed = false
    this.open()
  }

  /** A rede voltou (ou o PC acordou): tenta já, sem esperar o próximo intervalo. */
  nudge() {
    if (this.closed || this.ws) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retry = 0
    this.open()
  }

  private open() {
    this.retryTimer = null
    this.handlers.status('connecting')
    const ws = new WebSocket(this.url())
    this.ws = ws

    ws.onopen = () => {
      ws.send(JSON.stringify(this.hello()))
      this.retry = 0
      this.lastPong = Date.now()
      this.handlers.status('open')
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastPong > 50_000) return ws.close(4000, 'sem pong')
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 20_000)
    }

    ws.onmessage = (event) => {
      this.lastPong = Date.now()
      if (event.data === 'pong') return
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
      if (this.closed) return
      // Códigos próprios do servidor: não adianta tentar de novo.
      if (event.code === 4001) return this.stop('unauthorized')
      if (event.code === 4003) return this.stop('not-member')
      if (event.code === 4004) return this.stop('gone')
      this.handlers.status('offline')
      const delay = [500, 1000, 2000, 5000, 10_000][Math.min(this.retry++, 4)] * (0.75 + Math.random() / 2)
      this.retryTimer = setTimeout(() => this.open(), delay)
    }
  }

  private stop(reason: CloseReason) {
    this.closed = true
    this.handlers.status('offline')
    this.handlers.closed(reason)
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  send(msg: Out): boolean {
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
