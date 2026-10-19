export type ConnectionStatus = 'connecting' | 'open' | 'offline'

/** Por que o servidor fechou a conexão de vez (não adianta reconectar). */
export type CloseReason = 'unauthorized' | 'not-member' | 'gone'

const PING_EVERY = 20_000
/** Sem resposta a um ping nesse tempo, a conexão morreu (mesmo que o sistema ainda não tenha avisado). */
const PONG_TIMEOUT = 10_000
/** Espera entre as tentativas seguintes (a primeira é na hora). */
const RETRY_DELAYS = [1000, 2000, 5000, 10_000]
/**
 * Tentativa que não chega ao `ready` nesse tempo é largada: num caminho que engole os pacotes
 * (troca de Wi-Fi, VPN), o sistema levava uns 2 min pra desistir de uma conexão "conectando".
 */
const CONNECT_TIMEOUT = 15_000
/** Conferência rápida quando o app volta pra frente ou o PC acorda (ver `probe`). */
const PROBE_TIMEOUT = 5000

/**
 * Chave desta instância do app pra uma conexão: vai no `auth` de toda
 * reconexão, e o servidor tira dela o mesmo connId (a call continua).
 */
export function connectionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * WebSocket com reconexão automática. Manda "ping" a cada 20 s; o servidor
 * responde "pong" sem acordar o Durable Object, e se a resposta não vier em
 * 10 s a conexão é dada como morta e reaberta na hora. Serve tanto pra
 * conexão de cada servidor quanto pra conexão pessoal (Home).
 */
export class Connection<In, Out> {
  private ws: WebSocket | null = null
  /**
   * O servidor já respondeu (o `ready`): só daí o app manda o resto. Antes disso, o servidor ainda
   * confere o token, e até a 1.14 uma mensagem nesse meio fechava com 4001 (o app deslogava).
   */
  private ready = false
  private openedAt = 0
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private openTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
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
    if (this.closed) return
    if (this.ws) {
      // Ainda tentando há um tempo (a rede trocou no meio): larga e tenta de novo, já.
      if (this.ready || Date.now() - this.openedAt < 3000) return
      this.abandon(this.ws)
    }
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retry = 0
    this.open()
  }

  /**
   * O app voltou pra frente ou o PC acordou: confere já se a conexão está viva (um ping com
   * resposta curta), sem esperar os 20 s do próximo ping com uma conexão morta que parece aberta.
   */
  probe() {
    const ws = this.ws
    if (this.closed) return
    if (!ws || !this.ready || ws.readyState !== WebSocket.OPEN) return this.nudge()
    const sentAt = Date.now()
    ws.send('ping')
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.pongTimer = setTimeout(() => {
      if (this.ws === ws && this.lastPong < sentAt) this.abandon(ws)
    }, PROBE_TIMEOUT)
  }

  private open() {
    this.retryTimer = null
    this.handlers.status('connecting')
    const ws = new WebSocket(this.url())
    this.ws = ws
    this.ready = false
    this.openedAt = Date.now()
    this.openTimer = setTimeout(() => {
      if (this.ws === ws && !this.ready) this.abandon(ws)
    }, CONNECT_TIMEOUT)

    ws.onopen = () => {
      ws.send(JSON.stringify(this.hello()))
      this.lastPong = Date.now()
      this.pingTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        const sentAt = Date.now()
        ws.send('ping')
        if (this.pongTimer) clearTimeout(this.pongTimer)
        this.pongTimer = setTimeout(() => {
          if (this.ws === ws && this.lastPong < sentAt) this.abandon(ws)
        }, PONG_TIMEOUT)
      }, PING_EVERY)
    }

    ws.onmessage = (event) => {
      this.lastPong = Date.now()
      if (event.data === 'pong') return
      let msg: In
      try {
        msg = JSON.parse(event.data)
      } catch (err) {
        console.error('mensagem inválida do servidor', err)
        return
      }
      // A primeira resposta (o `ready`): a conexão vale de verdade. A espera entre tentativas
      // só zera aqui, pra uma conexão que o servidor fecha logo depois de abrir não virar laço.
      if (!this.ready) {
        this.ready = true
        this.retry = 0
        if (this.openTimer) clearTimeout(this.openTimer)
        this.openTimer = null
        this.handlers.status('open')
      }
      try {
        this.handlers.message(msg)
      } catch (err) {
        console.error('erro tratando mensagem do servidor', (msg as { t?: string })?.t, err)
      }
    }

    ws.onclose = (event) => this.lost(ws, event.code)
  }

  /** Conexão morta que o sistema ainda não fechou: larga ela e reconecta já, sem esperar o fechamento. */
  private abandon(ws: WebSocket) {
    ws.onclose = null
    ws.onmessage = null
    try {
      ws.close(4000, 'sem pong')
    } catch {
      // já estava fechando
    }
    this.lost(ws, 4000)
  }

  private lost(ws: WebSocket, code: number) {
    if (this.ws !== ws) return
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    if (this.openTimer) clearTimeout(this.openTimer)
    this.pingTimer = this.pongTimer = this.openTimer = null
    this.ws = null
    this.ready = false
    if (this.closed) return
    // Códigos próprios do servidor: não adianta tentar de novo.
    if (code === 4001) return this.stop('unauthorized')
    if (code === 4003) return this.stop('not-member')
    if (code === 4004) return this.stop('gone')
    this.handlers.status('offline')
    // A queda comum é o Cloudflare trocando a conexão de lugar: a primeira tentativa vai
    // na hora (espalhada em até 300 ms, pra todo mundo não chegar no mesmo instante).
    const delay = this.retry === 0 ? Math.random() * 300 : RETRY_DELAYS[Math.min(this.retry - 1, RETRY_DELAYS.length - 1)] * (0.75 + Math.random() / 2)
    this.retry++
    this.retryTimer = setTimeout(() => this.open(), delay)
  }

  private stop(reason: CloseReason) {
    this.closed = true
    this.handlers.status('offline')
    this.handlers.closed(reason)
  }

  get isOpen(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN
  }

  send(msg: Out): boolean {
    if (!this.isOpen) return false
    this.ws!.send(JSON.stringify(msg))
    return true
  }

  close() {
    this.closed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.openTimer) clearTimeout(this.openTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.ws?.close(1000)
    this.ws = null
    this.ready = false
  }
}
