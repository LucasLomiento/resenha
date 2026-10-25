// Orçamento de cada conexão (ver "Freios" na ARQUITETURA).
//
// O plano grátis do Cloudflare dá 100 mil pedidos de Durable Object por dia pra plataforma
// inteira: cada RPC entre objetos é um pedido, cada alarme também, e cada mensagem que chega
// pelo WebSocket conta 1/20. Em 25/10/2026 uma chamada privada em laço gastou isso sozinha. Aqui
// cada mensagem custa o que ela causa, em vigésimos de pedido (a mensagem em si é 1, cada RPC
// que ela gera é 20), e cada conexão tem um teto em 10 min, em 1 h e em 1 dia. Passou, o que
// ela manda é ignorado (sai barato: só o 1/20 da mensagem), e o app que entende o 4008 pausa.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Um pedido na cota, em vigésimos (o preço de uma mensagem de WebSocket). */
export const REQUEST = 20

/**
 * Tetos por conexão, em pedidos. Uso de verdade fica muito abaixo: o grupo inteiro (5 pessoas)
 * gastava umas 300 por dia em mensagens. O mais caro que alguém faz de propósito é digitar sem
 * parar numa conversa privada (o app avisa a cada 6 s, 2 RPCs cada: 200 pedidos em 10 min). O
 * de 10 min fica acima do freio da sinalização (300 sinais = 600 pedidos), que dispara antes e
 * tira a conexão da call (só ignorar deixaria o app antigo mandando sem parar).
 */
export const LIMITS = [
  { window: 10 * MINUTE, max: 1000 * REQUEST },
  { window: HOUR, max: 2500 * REQUEST },
  { window: DAY, max: 6000 * REQUEST },
] as const

/**
 * Gasto de uma conexão: começo e total de cada janela de `LIMITS`, em sequência
 * (vai no attachment do WebSocket, que sobrevive à hibernação).
 */
export type Spent = number[]

/**
 * Gasta `cost` (em vigésimos) se couber em todas as janelas. `over`: a primeira janela que
 * estourou (-1 = coube). `essential`: conta mesmo passando (sair da call não pode ser barrado).
 */
export function spend(
  spent: Spent | undefined,
  cost: number,
  now: number,
  essential = false,
  limits: readonly { window: number; max: number }[] = LIMITS,
): { spent: Spent; over: number } {
  const next: Spent = []
  let over = -1
  for (let i = 0; i < limits.length; i++) {
    let start = spent?.[2 * i] ?? now
    let used = spent?.[2 * i + 1] ?? 0
    if (now - start >= limits[i].window) {
      start = now
      used = 0
    }
    if (over === -1 && used + cost > limits[i].max) over = i
    next.push(start, used)
  }
  if (over !== -1 && !essential) return { spent: next, over }
  for (let i = 0; i < limits.length; i++) next[2 * i + 1] += cost
  return { spent: next, over }
}

/** O maior gasto de cada janela entre dois registros (uma conexão que voltou herda o que já gastou). */
export function merge(a: Spent | undefined, b: Spent | undefined): Spent | undefined {
  if (!a) return b
  if (!b) return a
  const out: Spent = []
  for (let i = 0; i < Math.max(a.length, b.length); i += 2) {
    // A janela que começou antes e ainda vale é a que manda; com o total maior das duas.
    out.push(Math.min(a[i] ?? Infinity, b[i] ?? Infinity), Math.max(a[i + 1] ?? 0, b[i + 1] ?? 0))
  }
  return out
}

/** Nome da janela (pro registro de incidentes). */
export function windowName(i: number): string {
  return ['10min', '1h', '1d'][i] ?? String(i)
}

/** Dia (UTC) de um instante, pra cota diária, que vira à meia-noite UTC como a do Cloudflare. */
export function utcDay(now: number): number {
  return Math.floor(now / DAY)
}

/**
 * Sinalização de uma conexão em 5 min (Home: chamada privada; Guild: call do servidor). Uma
 * call normal manda poucas dezenas (entrar, tela, câmera, troca de rota); um app em laço manda
 * várias por segundo sem parar. Passou disso, a conexão sai da call.
 */
export const SIGNAL_RUNAWAY = 300
export const SIGNAL_RUNAWAY_WINDOW = 5 * MINUTE

/**
 * Fechamento "pausa": o app que mandou a versão no `auth` espera uns minutos antes de
 * reconectar (ver `lib/ws.ts`). Só vai pra ele: app antigo trata como queda e volta na hora,
 * e cada reconexão custa mais que ignorar as mensagens.
 */
export const CLOSE_PAUSE = 4008

/**
 * Contagem da sinalização de uma conexão numa janela, pro incidente quando o freio dispara:
 * quantas de cada tipo (e de cada descrição), e quantos ids de conexão P2P (`pc`/`ack`)
 * diferentes apareceram. Só contagens: nada de SDP, candidato ou IP sai daqui.
 */
export class SignalTally {
  private start = 0
  private total = 0
  private kinds = new Map<string, number>()
  private descriptions = new Map<string, number>()
  private pcs = new Set<string>()
  private acks = new Set<string>()

  add(data: unknown, now: number, window = SIGNAL_RUNAWAY_WINDOW) {
    if (now - this.start >= window) {
      this.start = now
      this.total = 0
      this.kinds.clear()
      this.descriptions.clear()
      this.pcs.clear()
      this.acks.clear()
    }
    this.total++
    const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
    const kind = typeof d.kind === 'string' && /^[\w-]{1,24}$/.test(d.kind) ? d.kind : 'outro'
    this.kinds.set(kind, (this.kinds.get(kind) ?? 0) + 1)
    if (kind === 'description') {
      const desc = d.description && typeof d.description === 'object' ? (d.description as Record<string, unknown>) : {}
      const type = typeof desc.type === 'string' && /^[a-z]{1,16}$/.test(desc.type) ? desc.type : 'outro'
      this.descriptions.set(type, (this.descriptions.get(type) ?? 0) + 1)
    }
    if (typeof d.pc === 'string' && this.pcs.size < 1000) this.pcs.add(d.pc.slice(0, 64))
    if (typeof d.ack === 'string' && this.acks.size < 1000) this.acks.add(d.ack.slice(0, 64))
  }

  /** Ex.: "301 em 84s: candidate=250 description=40 watch=11 (offer=20 answer=20); pc=37 ack=36". */
  detail(now: number): string {
    const kinds = [...this.kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`)
    const descriptions = [...this.descriptions].map(([k, n]) => `${k}=${n}`)
    const desc = descriptions.length ? ` (${descriptions.join(' ')})` : ''
    const seconds = Math.round((now - this.start) / 1000)
    return `${this.total} em ${seconds}s: ${kinds.join(' ')}${desc}; pc=${this.pcs.size} ack=${this.acks.size}`
  }
}
