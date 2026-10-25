import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newerPeer, peerId, signalRoute } from '../src/renderer/lib/signal-ids.ts'

const id = (at: number, rand = 'abcd') => `${at.toString(36)}.${rand}`

test('ids novas saem em ordem, mesmo criadas no mesmo milissegundo', () => {
  const ids = Array.from({ length: 50 }, () => peerId())
  for (let i = 1; i < ids.length; i++) assert.equal(newerPeer(ids[i], ids[i - 1]), true)
  assert.equal(newerPeer(ids[0], ids[1]), false)
})

test('id de app antigo (só o sorteio) não tem ordem', () => {
  assert.equal(newerPeer('1b9d6bcd-bbfd', id(1000)), null)
  assert.equal(newerPeer(id(1000), '1b9d6bcd-bbfd'), null)
})

test('a quem a sinalização vai', () => {
  const me = id(500, 'mine')
  const peer = (remoteId: string | null, described = false) => ({ id: me, remoteId, described })
  const old = id(100)
  const cur = id(200)
  const next = id(300)

  assert.equal(signalRoute(peer(cur), {}), 'handle', 'app sem as ids')
  assert.equal(signalRoute(undefined, { pc: cur, ack: null }), 'handle', 'primeira conexão com a pessoa')
  assert.equal(signalRoute(peer(null), { pc: cur, ack: null }), 'handle', 'primeira mensagem dela')
  assert.equal(signalRoute(peer(cur), { pc: cur, ack: me }), 'handle')
  assert.equal(signalRoute(peer(cur), { pc: cur, ack: id(400, 'gone') }), 'drop', 'pra uma conexão minha que já não existe')
  assert.equal(signalRoute(peer(cur), { pc: old, ack: null }), 'drop', 'atrasada, de uma conexão mais velha do outro lado')
  assert.equal(signalRoute(peer(cur), { pc: next, ack: me }, [old]), 'follow', 'trocou antes de a gente negociar')
  assert.equal(signalRoute(peer(cur, true), { pc: next, ack: null }), 'recreate', 'trocou depois de a gente negociar')
  assert.equal(signalRoute(peer(cur, true), { pc: next, ack: me }), 'recreate')
  assert.equal(signalRoute(peer(next), { pc: cur, ack: null }, [cur]), 'drop', 'conexão que ele já trocou')
  assert.equal(signalRoute(undefined, { pc: old, ack: null }, [cur]), 'drop', 'mais velha que uma já trocada')
  // App antigo do outro lado: sem ordem, qualquer troca vale.
  assert.equal(signalRoute(peer('aaaaaaaa-0001'), { pc: 'bbbbbbbb-0002', ack: null }), 'follow')
  assert.equal(signalRoute(peer('aaaaaaaa-0001', true), { pc: 'bbbbbbbb-0002', ack: me }), 'recreate')
})

test('a conexão presa da 1.16: aprendeu uma id do outro lado que ele trocou logo depois', () => {
  // B refez a dele (b2) e a primeira coisa que chegou nela foi um candidato da conexão a1 de A,
  // que A trocou por a2 ao ver b2. Até a 1.16, b2 descartava tudo de a2 (que já conhecia b2) e as
  // duas pontas ficavam esperando uma resposta que nunca vinha.
  const a1 = id(100)
  const a2 = id(150)
  const b2 = id(120, 'bbbb')
  assert.equal(signalRoute({ id: b2, remoteId: a1, described: false }, { pc: a2, ack: b2 }), 'follow')
})
