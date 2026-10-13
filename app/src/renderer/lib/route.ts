// Rota da conexão direta (P2P): por IPv4 ou por IPv6. Quando os dois PCs têm os dois, o
// Chromium prefere o IPv6 mesmo que o caminho dele entre as operadoras seja bem pior (o ping
// pula de ~30 pra 120+ ms). Os dois caminhos são testados pelo próprio ICE (o que não está
// em uso recebe um teste de tempos em tempos); aqui se decide quando vale prender a conexão
// no outro. Prender refaz a conexão (o som some por ~1 s), então é uma vez por call: presa,
// não se mede mais a outra família, e só solta se a escolhida parar de funcionar.
// Nunca passa pelo Cloudflare: sala direta continua direta.

import type { IpFamily } from './sdp'

export interface PathSample {
  /** Ping (ms) do melhor par direto dessa família. */
  rtt: number
  /** Quando foi medido (o ICE manda o teste; cada resposta nova vira uma amostra). */
  at: number
}

export interface RouteReading {
  now: number
  /** Família do caminho em uso (null: pelo TURN, ou ainda sem caminho). */
  family: IpFamily | null
  /** Última amostra de cada família com caminho direto funcionando. */
  paths: Partial<Record<IpFamily, PathSample>>
}

/** Amostra mais velha que isso não conta. */
const FRESH = 90_000
/** Entre uma troca e outra, no mínimo isso (cada troca refaz a conexão). */
const HOLD = 60_000
/** Presa numa família que não pegou (ou parou): solta depois disso fora dela. */
const DEAD_PIN = 10_000
/** A família que não pegou fica de fora esse tempo (sem ficar tentando de minuto em minuto). */
const BLOCK = 10 * 60_000
/** Peso da amostra nova na média. */
const ALPHA = 0.3

/** Quanto o outro caminho tem que ganhar pra valer a troca. */
function worthIt(current: number, other: number): boolean {
  return current - other >= Math.max(15, current * 0.25)
}

const otherFamily = (family: IpFamily): IpFamily => (family === 'ipv4' ? 'ipv6' : 'ipv4')

/**
 * Uma por conexão direta. `update` recebe a leitura das estatísticas (a cada 2 s) e devolve
 * a família pra prender, null pra soltar (as duas valem) ou undefined (fica como está).
 */
export class RoutePicker {
  /** Família presa agora (null: as duas, como o Chromium preferir). */
  pinned: IpFamily | null = null
  private avg: Partial<Record<IpFamily, { rtt: number; at: number; n: number }>> = {}
  private seen: Partial<Record<IpFamily, number>> = {}
  private changedAt = -Infinity
  /** Desde quando a conexão está fora da família presa (null: está nela). */
  private offSince: number | null = null
  private blockedUntil: Partial<Record<IpFamily, number>> = {}

  update({ now, family, paths }: RouteReading): IpFamily | null | undefined {
    for (const f of ['ipv4', 'ipv6'] as const) {
      const sample = paths[f]
      if (!sample || sample.at <= (this.seen[f] ?? 0)) continue
      this.seen[f] = sample.at
      const prev = this.avg[f]
      this.avg[f] =
        prev && now - prev.at < FRESH
          ? { rtt: prev.rtt + ALPHA * (sample.rtt - prev.rtt), at: sample.at, n: prev.n + 1 }
          : { rtt: sample.rtt, at: sample.at, n: 1 }
    }
    const fresh = (f: IpFamily) => {
      const a = this.avg[f]
      return a && now - a.at < FRESH ? a : null
    }

    if (this.pinned) {
      // O caminho escolhido não pegou (ou parou): solta, e não tenta ele de novo por um tempo.
      if (family === this.pinned) this.offSince = null
      else this.offSince ??= now
      if (this.offSince === null || now - this.offSince < DEAD_PIN) return undefined
      this.blockedUntil[this.pinned] = now + BLOCK
      return this.change(null, now)
    }

    if (!family || now - this.changedAt < HOLD) return undefined
    const current = fresh(family)
    const other = fresh(otherFamily(family))
    if (!current || !other || current.n < 5 || other.n < 2 || !worthIt(current.rtt, other.rtt)) return undefined
    if (now < (this.blockedUntil[otherFamily(family)] ?? 0)) return undefined
    return this.change(otherFamily(family), now)
  }

  private change(family: IpFamily | null, now: number): IpFamily | null {
    this.pinned = family
    this.changedAt = now
    this.offSince = null
    return family
  }
}
