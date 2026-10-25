export type ConnectionStatus = 'connecting' | 'open' | 'offline'

/** Por que o servidor fechou a conexão de vez (não adianta reconectar). */
export type CloseReason = 'unauthorized' | 'not-member' | 'gone'

const PING_EVERY = 20_000
/** Sem resposta a um ping nesse tempo, a conexão morreu (mesmo que o sistema ainda não tenha avisado). */
const PONG_TIMEOUT = 10_000
/**
 * Espera entre as tentativas seguintes (a primeira é na hora). Depois de algumas, espaça até
 * 1 min: com o servidor fora do ar (a cota do Cloudflare acabou em 25/10/2026), cada app tentando
 * a cada 10 s o dia todo também pesava.
 */
const RETRY_DELAYS = [1000, 2000, 5000, 10_000, 30_000, 60_000]
/**
 * A espera só volta pro começo depois de a conexão ficar de pé esse tempo: uma que o servidor
 * aceita e derruba logo em seguida (de propósito ou com bug) não vira laço de reconexão.
 */
const STABLE_AFTER = 30_000
/** O servidor pausou este app (4008: mandou coisa demais): volta depois disso. */
const PAUSE = 5 * 60_000
/** Fechamento de pausa (ver `server/src/budget.ts`). */
const CLOSE_PAUSE = 4008
/**
 * Teto do que o app manda, mesmo com bug: rajada de até `SEND_BURST` (candidatos da call, o
 * começo de arrastar o mapa), `SEND_RATE` por segundo sustentado, `SEND_HOUR` por hora e
 * `SEND_DAY` por dia. Passou, descarta e avisa no console: no plano grátis do Cloudflare cada
 * mensagem que chega lá é um pedido na cota diária, que é de todo mundo. Fica abaixo do
 * orçamento do servidor (`server/src/budget.ts`), que pausa a conexão.
 */
const SEND_BURST = 150
const SEND_RATE = 2
const SEND_HOUR = 2000
const SEND_DAY = 6000
/** O aviso de descarte (pro registro do dono) sai no máximo a cada 10 min. */
const LIMITED_EVERY = 10 * 60_000
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

export interface ConnectionHandlers<In> {
  message: (msg: In) => void
  status: (status: ConnectionStatus) => void
  /** O servidor fechou de vez: sessão inválida, saiu do servidor ou ele foi excluído. */
  closed: (reason: CloseReason) => void
  /** O limite de envio descartou mensagens (no máximo a cada 10 min): pro registro do dono. */
  limited?: (detail: string) => void
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
  /** Quando a conexão de agora chegou no `ready` (0: ainda não). */
  private readyAt = 0
  /** Pausado pelo servidor (4008) até esse instante: nem a rede voltando apressa. */
  private pausedUntil = 0
  /** Balde do limite de envio (`SEND_BURST`, `SEND_RATE`) e a conta da hora (`SEND_HOUR`). */
  private tokens = SEND_BURST
  private tokensAt = Date.now()
  private hourStart = Date.now()
  private hourSent = 0
  private dayStart = Date.now()
  private daySent = 0
  private dropped = 0
  private limitedAt = 0

  private url: () => string
  /** Primeira mensagem de cada conexão (o `auth` com o token). */
  private hello: () => Out
  private handlers: ConnectionHandlers<In>

  // Sem `private` nos parâmetros: o teste (test/ws.test.mts) roda este arquivo direto no Node.
  constructor(url: () => string, hello: () => Out, handlers: ConnectionHandlers<In>) {
    this.url = url
    this.hello = hello
    this.handlers = handlers
  }

  connect() {
    this.closed = false
    this.open()
  }

  /** A rede voltou (ou o PC acordou): tenta já, sem esperar o próximo intervalo. */
  nudge() {
    if (this.closed || Date.now() < this.pausedUntil) return
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
    if (this.closed || Date.now() < this.pausedUntil) return
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
    this.readyAt = 0
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
      // só zera quando ela cai depois de ficar de pé um tempo (`STABLE_AFTER`, em `lost`).
      if (!this.ready) {
        this.ready = true
        this.readyAt = Date.now()
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
    if (code === CLOSE_PAUSE) {
      const wait = PAUSE * (0.9 + Math.random() / 5)
      console.warn(`o servidor pausou a conexão (coisa demais em pouco tempo): volta em ${Math.round(wait / 1000)} s`)
      this.pausedUntil = Date.now() + wait
      this.retryTimer = setTimeout(() => this.open(), wait)
      return
    }
    // Ficou de pé um tempo: a queda é nova, e a primeira tentativa vai na hora.
    if (this.readyAt && Date.now() - this.readyAt >= STABLE_AFTER) this.retry = 0
    this.readyAt = 0
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

  /** `force`: fora do limite de envio (só o aviso de que o limite descartou mensagens). */
  send(msg: Out, force = false): boolean {
    if (!this.isOpen) return false
    // Passou do limite (só um app com bug chega aqui): conta como enviada, pra quem chamou não
    // guardar e tentar de novo, e fica no console.
    if (!force && !this.take()) return true
    this.ws!.send(JSON.stringify(msg))
    return true
  }

  /** Cabe mais uma no limite de envio? */
  private take(): boolean {
    const now = Date.now()
    this.tokens = Math.min(SEND_BURST, this.tokens + ((now - this.tokensAt) / 1000) * SEND_RATE)
    this.tokensAt = now
    if (now - this.hourStart >= 3_600_000) {
      this.hourStart = now
      this.hourSent = 0
    }
    if (now - this.dayStart >= 86_400_000) {
      this.dayStart = now
      this.daySent = 0
    }
    if (this.tokens >= 1 && this.hourSent < SEND_HOUR && this.daySent < SEND_DAY) {
      this.tokens--
      this.hourSent++
      this.daySent++
      return true
    }
    this.dropped++
    if (now - this.limitedAt >= LIMITED_EVERY) {
      this.limitedAt = now
      const detail = `${this.dropped} descartadas; ${this.hourSent} na hora, ${this.daySent} no dia`
      console.warn(`limite de envio: ${detail}`)
      this.handlers.limited?.(detail)
    }
    return false
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
