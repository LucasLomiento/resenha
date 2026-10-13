import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RoutePicker, type RouteReading } from '../src/renderer/lib/route.ts'
import type { IpFamily } from '../src/renderer/lib/sdp.ts'

/**
 * Simula as leituras de 2 em 2 s: o caminho em uso responde a cada leitura e o reserva
 * (da outra família) a cada ~25 s, como o ICE do Chromium faz. Sem rota presa, o Chromium
 * fica em `natural`; presa, só a família escolhida existe (se `pinWorks`, ela pega).
 */
function run(
  picker: RoutePicker,
  seconds: number,
  start: number,
  natural: IpFamily | null,
  ping: Record<IpFamily, number | null>,
  pinWorks = true,
): { at: number; pick: IpFamily | null }[] {
  const picks: { at: number; pick: IpFamily | null }[] = []
  const last: Partial<Record<IpFamily, { rtt: number; at: number }>> = {}
  for (let t = start; t < start + seconds * 1000; t += 2000) {
    const family = natural && picker.pinned && pinWorks ? picker.pinned : natural
    for (const f of ['ipv4', 'ipv6'] as const) {
      const rtt = ping[f]
      if (rtt == null || (picker.pinned && f !== picker.pinned)) continue
      const due = f === family || !last[f] || t - last[f]!.at >= 25_000
      if (due) last[f] = { rtt, at: t }
    }
    const reading: RouteReading = { now: t, family, paths: { ...last } }
    const pick = picker.update(reading)
    if (pick !== undefined) picks.push({ at: t, pick })
  }
  return picks
}

test('IPv6 bem pior que o IPv4: prende no IPv4 em menos de um minuto', () => {
  const picker = new RoutePicker()
  const picks = run(picker, 180, 0, 'ipv6', { ipv4: 30, ipv6: 120 })
  assert.equal(picks.length, 1)
  assert.equal(picks[0].pick, 'ipv4')
  assert.ok(picks[0].at < 60_000, `trocou em ${picks[0].at} ms`)
})

test('diferença pequena não vale uma troca', () => {
  const picker = new RoutePicker()
  assert.deepEqual(run(picker, 300, 0, 'ipv6', { ipv4: 30, ipv6: 40 }), [])
})

test('só uma família (o outro PC não tem IPv6): nada muda', () => {
  const picker = new RoutePicker()
  assert.deepEqual(run(picker, 300, 0, 'ipv4', { ipv4: 120, ipv6: null }), [])
})

test('pelo Cloudflare (sem caminho direto em uso): nada muda', () => {
  const picker = new RoutePicker()
  assert.deepEqual(run(picker, 300, 0, null, { ipv4: 30, ipv6: 120 }), [])
})

test('presa no IPv4 e ele não pega: solta depois de uns segundos', () => {
  const picker = new RoutePicker()
  const picks = run(picker, 300, 0, 'ipv6', { ipv4: 30, ipv6: 120 }, false)
  assert.deepEqual(picks.map((p) => p.pick), ['ipv4', null], 'tenta uma vez e não fica tentando de minuto em minuto')
  assert.ok(picks[1].at - picks[0].at <= 20_000, `soltou ${picks[1].at - picks[0].at} ms depois`)
})

test('presa no IPv4: fica presa mesmo se ele piorar (cada troca custa um segundo sem som)', () => {
  const picker = new RoutePicker()
  const [first] = run(picker, 90, 0, 'ipv6', { ipv4: 30, ipv6: 120 })
  assert.equal(first.pick, 'ipv4')
  assert.deepEqual(run(picker, 600, first.at + 2000, 'ipv6', { ipv4: 150, ipv6: 120 }), [])
})
