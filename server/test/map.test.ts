import { env, evictAllDurableObjects, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { MAX_MAP_PINS, P } from '../../shared/protocol'
import { cleanPoint, cleanStreet, cleanView } from '../src/map'
import { guildSocket, invite, signup, tick, world } from './helpers'

// Nos testes a espera por quem caiu é de 400 ms (RESUME_GRACE_MS no vitest.config).
const GRACE = 400
const CURITIBA = { lng: -49.2733, lat: -25.4284, zoom: 12, bearing: 0, pitch: 0 }
const PRAIA = { lng: -48.548, lat: -27.5954, zoom: 14.5, bearing: 30, pitch: 45 }

/** Lucas e Duarte com o mapa aberto. */
async function onMap() {
  const w = await world()
  w.a.send({ t: 'map.join' })
  await w.a.next('map.state')
  w.b.send({ t: 'map.join' })
  await w.b.next('map.state')
  await w.a.next('map.viewers', (m) => m.viewers.length === 2)
  w.a.drain()
  w.b.drain()
  return w
}

describe('mapa compartilhado', () => {
  it('entrar: chega o estado, e todo mundo do servidor vê quem está no mapa', async () => {
    const { owner, guild, a, b, readyA } = await world()
    expect(readyA.mapViewers).toEqual([])
    a.send({ t: 'map.join' })
    const me = { connId: readyA.connId, userId: owner.user.id }
    expect(await a.next('map.state')).toMatchObject({ view: null, pins: [], viewers: [me] })
    // Duarte não abriu o mapa, mas a lista de canais dele mostra quem está lá.
    expect((await b.next('map.viewers')).viewers).toEqual([me])
    // Quem conecta depois já sabe no `ready`.
    const c = await guildSocket(guild.id, owner.token)
    expect((await c.next('ready')).mapViewers).toEqual([me])
    // Entrar de novo (o app reconectou) só manda o estado: ninguém vê entrar outra vez.
    a.send({ t: 'map.join' })
    await a.next('map.state')
    await b.nothing('map.viewers')
  })

  it('vista e cursor vão só pra quem está no mapa, com quem mandou', async () => {
    const { owner, a, b, readyA } = await world()
    a.send({ t: 'map.join' })
    await a.next('map.state')
    a.send({ t: 'map.view', view: CURITIBA })
    a.send({ t: 'map.cursor', lng: -49.3, lat: -25.4 })
    await b.nothing('map.view')
    await b.nothing('map.cursor')

    // Quem abre o mapa começa onde os outros estão.
    b.send({ t: 'map.join' })
    expect((await b.next('map.state')).view).toEqual(CURITIBA)
    a.send({ t: 'map.view', view: PRAIA })
    expect(await b.next('map.view')).toMatchObject({ view: PRAIA, connId: readyA.connId, userId: owner.user.id })
    a.send({ t: 'map.cursor', lng: -48.5, lat: -27.6 })
    expect(await b.next('map.cursor')).toMatchObject({ connId: readyA.connId, lng: -48.5, lat: -27.6 })
    a.send({ t: 'map.cursor', lng: null, lat: null })
    expect(await b.next('map.cursor')).toMatchObject({ lng: null, lat: null })
    // Não volta pra quem mandou, e coisa inválida não passa.
    await a.nothing('map.view')
    await a.nothing('map.cursor')
    a.send({ t: 'map.view', view: { ...PRAIA, lat: 'x' } as never })
    a.send({ t: 'map.cursor', lng: 'x' as never, lat: 1 })
    await b.nothing('map.view')
    await b.nothing('map.cursor')
  })

  it('a vista fica guardada: quem abre depois começa nela, mesmo com o servidor hibernando', async () => {
    const { a, b } = await world()
    a.send({ t: 'map.join' })
    await a.next('map.state')
    a.send({ t: 'map.view', view: CURITIBA })
    a.send({ t: 'map.view', view: PRAIA })
    // Saiu o último: a vista vai pro banco na hora.
    a.send({ t: 'map.leave' })
    await b.next('map.viewers', (m) => m.viewers.length === 0)
    await evictAllDurableObjects()
    b.send({ t: 'map.join' })
    expect((await b.next('map.state')).view).toEqual(PRAIA)
  })

  it('sair do mapa ou fechar o app tira da lista, e quem saiu não recebe mais nada', async () => {
    const { friend, a, b, readyB } = await onMap()
    a.send({ t: 'map.leave' })
    expect((await b.next('map.viewers')).viewers).toEqual([{ connId: readyB.connId, userId: friend.user.id }])
    expect((await a.next('map.viewers')).viewers).toHaveLength(1)
    b.send({ t: 'map.view', view: CURITIBA })
    b.send({ t: 'map.cursor', lng: 1, lat: 1 })
    b.send({ t: 'map.pin.add', lng: 1, lat: 1, label: 'Casa', color: 0x8b7bff })
    await b.next('map.pin')
    await a.nothing('map.view')
    await a.nothing('map.cursor')
    await a.nothing('map.pin')
    b.close()
    expect((await a.next('map.viewers')).viewers).toEqual([])
  })

  it('marcadores: todo mundo vê; quem marcou apaga, os outros só com permissão de moderar', async () => {
    const { friend, guild, a, b } = await onMap()
    b.send({ t: 'map.pin.add', lng: -49.2733, lat: -25.4284, label: '  Padaria   do Zé ', color: 0x36d6ad })
    const added = (await a.next('map.pin')).pin
    expect(added).toMatchObject({ authorId: friend.user.id, label: 'Padaria do Zé', color: 0x36d6ad, lng: -49.2733, lat: -25.4284 })
    expect((await b.next('map.pin')).pin.id).toBe(added.id)

    // Rótulo vazio ou grande demais, cor ou lugar inválidos: recusado.
    for (const bad of [
      { label: '', color: 0 },
      { label: 'x'.repeat(61), color: 0 },
      { label: 'ok', color: 0x1000000 },
      { label: 'ok', color: 0, lat: 91 },
    ]) {
      b.send({ t: 'map.pin.add', lng: 0, lat: 0, ...bad })
      expect((await b.next('error')).message).toBe('Marcador inválido.')
    }

    // Um terceiro sem cargo não apaga o marcador dos outros.
    const code = await invite(a)
    const third = await signup('ze', code, 'Zé')
    const c = await guildSocket(guild.id, third.token)
    await c.next('ready')
    c.send({ t: 'map.pin.remove', id: added.id })
    expect((await c.next('error')).message).toMatch(/Só quem marcou/)

    // O dono (administrador) apaga o de qualquer um; quem marcou apaga o seu.
    a.send({ t: 'map.pin.remove', id: added.id })
    expect((await b.next('map.pin.removed')).id).toBe(added.id)
    a.send({ t: 'map.pin.add', lng: 1, lat: 2, label: 'Do dono', color: 0xffc35a })
    const own = (await b.next('map.pin')).pin
    a.send({ t: 'map.pin.remove', id: own.id })
    await b.next('map.pin.removed', (m) => m.id === own.id)

    // Moderador (cargo com "apagar mensagens") também apaga.
    b.send({ t: 'map.pin.add', lng: 3, lat: 4, label: 'Do Duarte', color: 0xff7a93 })
    const theirs = (await a.next('map.pin', (m) => m.pin.label === 'Do Duarte')).pin
    a.send({ t: 'role.create', name: 'Mod' })
    const mod = (await a.next('roles', (m) => m.roles.some((r) => r.name === 'Mod'))).roles.find((r) => r.name === 'Mod')!
    a.send({ t: 'role.update', id: mod.id, permissions: P.MANAGE_MESSAGES })
    a.send({ t: 'member.roles', userId: third.user.id, roles: [mod.id] })
    await c.next('member.upsert', (m) => m.member.userId === third.user.id && m.member.roles.includes(mod.id))
    c.send({ t: 'map.pin.remove', id: theirs.id })
    await b.next('map.pin.removed', (m) => m.id === theirs.id)

    // Quem abre o mapa recebe os que sobraram.
    c.send({ t: 'map.join' })
    expect((await c.next('map.state')).pins).toEqual([])
  })

  it(`no máximo ${MAX_MAP_PINS} marcadores por servidor`, async () => {
    const { guild, a, b } = await onMap()
    await runInDurableObject(env.GUILD.get(env.GUILD.idFromName(guild.id)), (_, state) => {
      for (let i = 0; i < MAX_MAP_PINS - 1; i++) {
        state.storage.sql.exec(
          'INSERT INTO map_pins (id, author_id, lng, lat, label, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          `p${String(i).padStart(4, '0')}`,
          'alguem',
          0,
          0,
          `Lugar ${i}`,
          0,
          Date.now(),
        )
      }
    })
    b.send({ t: 'map.pin.add', lng: 1, lat: 1, label: 'O último', color: 0 })
    await a.next('map.pin')
    b.send({ t: 'map.pin.add', lng: 1, lat: 1, label: 'Um a mais', color: 0 })
    expect((await b.next('error')).message).toMatch(/já tem 200 marcadores/)
    b.send({ t: 'map.join' })
    expect((await b.next('map.state')).pins).toHaveLength(MAX_MAP_PINS)
  })

  it('castigo: vê o mapa, mas não mexe no dos outros nem marca', async () => {
    const { friend, a, b } = await onMap()
    a.send({ t: 'member.timeout', userId: friend.user.id, minutes: 10, reason: '' })
    await b.next('member.upsert', (m) => m.member.timeoutUntil !== null)
    a.drain()
    b.send({ t: 'map.view', view: CURITIBA })
    b.send({ t: 'map.cursor', lng: 1, lat: 1 })
    await a.nothing('map.view')
    await a.nothing('map.cursor')
    b.send({ t: 'map.pin.add', lng: 1, lat: 1, label: 'Não pode', color: 0 })
    expect((await b.next('error')).message).toMatch(/castigo/)
    // Mas continua vendo o que os outros fazem.
    a.send({ t: 'map.view', view: PRAIA })
    expect((await b.next('map.view')).view).toEqual(PRAIA)
  })

  it('arrastar não esbarra no limite geral de mensagens', async () => {
    const { a, b } = await onMap()
    for (let i = 0; i < 150; i++) a.send({ t: 'map.view', view: { ...CURITIBA, zoom: 10 + i / 100 } })
    await b.next('map.view', (m) => m.view.zoom === 11.49)
    await a.nothing('error')
  })

  it('caiu sem avisar e voltou: continua no mapa pros outros; não voltou, sai', async () => {
    const w = await world()
    w.b.close()
    const key = 'chave-do-app-do-duarte-1'
    const b = await guildSocket(w.guild.id, w.friend.token, { key })
    const readyB = await b.next('ready')
    b.send({ t: 'map.join' })
    await b.next('map.state')
    await w.a.next('map.viewers', (m) => m.viewers.length === 1)
    w.a.send({ t: 'map.join' })
    await w.a.next('map.state')

    b.drop()
    await tick(60)
    await w.a.nothing('map.viewers')
    const back = await guildSocket(w.guild.id, w.friend.token, { key })
    const ready = await back.next('ready')
    // Mesmo connId, ainda no mapa: o app confirma com `map.join` e ninguém viu sair e entrar.
    expect(ready.mapViewers?.some((v) => v.connId === readyB.connId)).toBe(true)
    back.send({ t: 'map.join' })
    expect((await back.next('map.state')).viewers).toHaveLength(2)
    await tick(GRACE + 100)
    await w.a.nothing('map.viewers')
    w.a.send({ t: 'map.view', view: CURITIBA })
    expect((await back.next('map.view')).view).toEqual(CURITIBA)

    // Caiu de novo e não voltou: depois da espera, sai do mapa.
    back.drop()
    const left = await w.a.next('map.viewers', (m) => m.viewers.length === 1)
    expect(left.viewers[0].userId).toBe(w.owner.user.id)
  })

  it('Street View: todo mundo vê onde a pessoa está olhando; fechar ou sair do mapa tira', async () => {
    const { a, b, readyA, owner } = await onMap()
    const spot = { lng: -49.2733, lat: -25.4284, heading: 90 }
    a.send({ t: 'map.street', at: spot })
    const seen = await b.next('map.viewers', (m) => m.viewers.some((v) => v.street))
    expect(seen.viewers.find((v) => v.connId === readyA.connId)).toEqual({ connId: readyA.connId, userId: owner.user.id, street: spot })
    a.send({ t: 'map.street', at: null })
    const closed = await b.next('map.viewers')
    expect(closed.viewers.find((v) => v.connId === readyA.connId)?.street).toBeUndefined()
    // Lugar inválido não muda nada; fora do mapa também não.
    a.send({ t: 'map.street', at: { lng: 'x', lat: 0, heading: 0 } as never })
    await b.nothing('map.viewers')
    a.send({ t: 'map.street', at: spot })
    await b.next('map.viewers', (m) => m.viewers.some((v) => v.street))
    a.send({ t: 'map.leave' })
    expect((await b.next('map.viewers')).viewers.some((v) => v.street)).toBe(false)
    a.send({ t: 'map.street', at: spot })
    await b.nothing('map.viewers')
  })

  it('expulso sai do mapa na hora', async () => {
    const { friend, a } = await onMap()
    a.send({ t: 'member.kick', userId: friend.user.id, reason: '' })
    await a.next('map.viewers', (m) => m.viewers.length === 1 && m.viewers[0].userId !== friend.user.id)
  })
})

describe('mapa: validação', () => {
  it('vista e ponto', () => {
    expect(cleanView({ lng: 190, lat: -25, zoom: 30, bearing: 270, pitch: 120 })).toEqual({ lng: -170, lat: -25, zoom: 24, bearing: -90, pitch: 85 })
    expect(cleanView({ lng: 0, lat: 0, zoom: 1, bearing: 0 })).toBeNull()
    expect(cleanView({ lng: Number.NaN, lat: 0, zoom: 1, bearing: 0, pitch: 0 })).toBeNull()
    expect(cleanView('x')).toBeNull()
    expect(cleanPoint(-49.123456789, 89.9)).toEqual({ lng: -49.123457, lat: 85.06 })
    expect(cleanPoint(0, 91)).toBeNull()
    expect(cleanPoint(Infinity, 0)).toBeNull()
    expect(cleanStreet({ lng: -49.1, lat: -25.4, heading: -90 })).toEqual({ lng: -49.1, lat: -25.4, heading: 270 })
    expect(cleanStreet({ lng: -49.1, lat: -25.4 })).toBeNull()
  })
})
