import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { P, type Message, type NewPoll } from '../../shared/protocol'
import { type GuildSocket, tick, world } from './helpers'

const votes = (m: { poll?: { options: { userIds: string[] }[] } }) => m.poll!.options.map((o) => o.userIds)

async function ask(from: GuildSocket, seen: GuildSocket, channelId: string, content: string, poll: Partial<NewPoll>, nonce = 'p'): Promise<Message> {
  from.send({ t: 'chat.send', channelId, content, attachmentIds: [], nonce, poll: { options: ['Pizza', 'Hambúrguer'], multiple: false, hours: 0, ...poll } })
  return (await seen.next('chat.message', (m) => m.message.content === content)).message
}

describe('enquetes', () => {
  it('cria com a pergunta no texto, as opções limpas e o prazo; vem no histórico e na busca', async () => {
    const { a, b, text } = await world()
    const before = Date.now()
    const msg = await ask(a, b, text.id, 'Onde vamos comer?', { options: ['  Pizza  ', 'Hambúrguer​', 'Sushi 🍣'], hours: 24 })
    expect(msg.content).toBe('Onde vamos comer?')
    expect(msg.poll).toMatchObject({ multiple: false, closed: false })
    expect(msg.poll!.options).toEqual([
      { text: 'Pizza', userIds: [] },
      { text: 'Hambúrguer', userIds: [] },
      { text: 'Sushi 🍣', userIds: [] },
    ])
    expect(msg.poll!.closesAt).toBeGreaterThanOrEqual(before + 24 * 3_600_000)
    expect(msg.poll!.closesAt).toBeLessThan(Date.now() + 24 * 3_600_000 + 1000)

    b.send({ t: 'chat.history', reqId: 'h', channelId: text.id })
    expect((await b.next('chat.history')).messages.at(-1)!.poll!.options.map((o) => o.text)).toEqual(['Pizza', 'Hambúrguer', 'Sushi 🍣'])
    b.send({ t: 'chat.search', reqId: 's', query: 'comer' })
    expect((await b.next('chat.search')).messages[0].poll).toBeTruthy()

    // Mensagem comum continua sem o campo.
    a.send({ t: 'chat.send', channelId: text.id, content: 'normal', attachmentIds: [], nonce: 'n' })
    expect('poll' in (await b.next('chat.message', (m) => m.message.content === 'normal')).message).toBe(false)
  })

  it('recusa enquete sem pergunta, com opções de menos, de mais, vazias, repetidas ou com prazo inventado', async () => {
    const { a, text } = await world()
    const refuse = async (content: string, poll: unknown, match: RegExp) => {
      a.send({ t: 'chat.send', channelId: text.id, content, attachmentIds: [], nonce: 'r', poll: poll as NewPoll })
      const err = await a.next('error')
      expect(err.message).toMatch(match)
      expect(err.nonce).toBe('r')
    }
    await refuse('', { options: ['a', 'b'], multiple: false, hours: 0 }, /pergunta/)
    await refuse('x'.repeat(301), { options: ['a', 'b'], multiple: false, hours: 0 }, /pergunta.*300/)
    await refuse('?', { options: ['só uma'], multiple: false, hours: 0 }, /pelo menos 2/)
    await refuse('?', { options: Array.from({ length: 11 }, (_, i) => `o${i}`), multiple: false, hours: 0 }, /até 10/)
    await refuse('?', { options: ['a', '   '], multiple: false, hours: 0 }, /1 a 80/)
    await refuse('?', { options: ['a', 'x'.repeat(81)], multiple: false, hours: 0 }, /1 a 80/)
    await refuse('?', { options: ['Sim', ' sim '], multiple: false, hours: 0 }, /repetidas/)
    await refuse('?', { options: ['a', 'b'], multiple: false, hours: 5 }, /Prazo/)
    await refuse('?', { options: 'ab' }, /inválida/)
    await refuse('?', 'enquete', /inválida/)
    await a.nothing('chat.message')
  })

  it('voto único: votar, trocar e tirar o voto; todo mundo vê na hora', async () => {
    const { owner, friend, a, b, text } = await world()
    const msg = await ask(a, b, text.id, 'Pizza ou hambúrguer?', {})
    b.send({ t: 'chat.vote', id: msg.id, options: [0] })
    expect(votes(await a.next('chat.poll'))).toEqual([[friend.user.id], []])
    a.send({ t: 'chat.vote', id: msg.id, options: [0] })
    expect(votes(await b.next('chat.poll', (m) => m.poll.options[0].userIds.length === 2))).toEqual([[friend.user.id, owner.user.id], []])
    // Trocar: sai de uma e entra na outra.
    b.send({ t: 'chat.vote', id: msg.id, options: [1] })
    expect(votes(await a.next('chat.poll', (m) => m.poll.options[1].userIds.length === 1))).toEqual([[owner.user.id], [friend.user.id]])
    // Duas numa enquete de voto único, opção que não existe, ou lixo: nada muda.
    b.drain()
    for (const options of [[0, 1], [2], [-1], [0.5], ['0'], 'x', null]) b.send({ t: 'chat.vote', id: msg.id, options: options as number[] })
    await b.nothing('chat.poll')
    // Tirar o voto.
    b.send({ t: 'chat.vote', id: msg.id, options: [] })
    expect(votes(await a.next('chat.poll', (m) => m.poll.options[0].userIds.length === 1 && m.poll.options[1].userIds.length === 0))).toEqual([
      [owner.user.id],
      [],
    ])
    // Votar em mensagem que não é enquete não faz nada.
    a.send({ t: 'chat.send', channelId: text.id, content: 'normal', attachmentIds: [], nonce: 'n' })
    const normal = (await b.next('chat.message', (m) => m.message.content === 'normal')).message
    b.send({ t: 'chat.vote', id: normal.id, options: [0] })
    await b.nothing('chat.poll', (m) => (m as { id?: string }).id === normal.id)
  })

  it('várias opções: marca mais de uma, sem contar a mesma duas vezes', async () => {
    const { friend, a, b, text } = await world()
    const msg = await ask(a, b, text.id, 'Que dias?', { options: ['Sexta', 'Sábado', 'Domingo'], multiple: true })
    expect(msg.poll!.multiple).toBe(true)
    b.send({ t: 'chat.vote', id: msg.id, options: [0, 2, 2, 0] })
    expect(votes(await a.next('chat.poll'))).toEqual([[friend.user.id], [], [friend.user.id]])
    b.send({ t: 'chat.vote', id: msg.id, options: [1] })
    expect(votes(await a.next('chat.poll', (m) => m.poll.options[1].userIds.length === 1))).toEqual([[], [friend.user.id], []])
  })

  it('encerrar: quem criou ou quem modera; depois ninguém vota', async () => {
    const { friend, a, b, text } = await world()
    const mine = await ask(b, a, text.id, 'Enquete do Duarte', {}, 'p1')
    b.send({ t: 'chat.vote', id: mine.id, options: [1] })
    await a.next('chat.poll')
    // O dono (modera as mensagens) encerra a de outra pessoa.
    a.send({ t: 'chat.poll.close', id: mine.id })
    const closed = await b.next('chat.poll', (m) => m.poll.closed)
    expect(votes(closed)).toEqual([[], [friend.user.id]])
    b.drain()
    b.send({ t: 'chat.vote', id: mine.id, options: [0] })
    expect((await b.next('error')).message).toMatch(/encerrada/)
    // Encerrar de novo não avisa ninguém.
    a.send({ t: 'chat.poll.close', id: mine.id })
    await b.nothing('chat.poll')

    // Quem não criou nem modera não encerra.
    const theirs = await ask(a, b, text.id, 'Enquete do Lucas', {}, 'p2')
    b.send({ t: 'chat.poll.close', id: theirs.id })
    await a.nothing('chat.poll', (m) => (m as { id?: string }).id === theirs.id)
    a.send({ t: 'chat.poll.close', id: theirs.id })
    expect((await b.next('chat.poll', (m) => m.id === theirs.id)).poll.closed).toBe(true)
    b.send({ t: 'chat.history', reqId: 'h', channelId: text.id })
    expect((await b.next('chat.history')).messages.filter((m) => m.poll).map((m) => m.poll!.closed)).toEqual([true, true])
  })

  it('passou do prazo: não aceita mais voto', async () => {
    const { guild, a, b, text } = await world()
    const msg = await ask(a, b, text.id, 'Rápida', { hours: 1 })
    b.send({ t: 'chat.vote', id: msg.id, options: [0] })
    await a.next('chat.poll')
    // Uma hora depois (o prazo guardado volta pro passado).
    await runInDurableObject(env.GUILD.get(env.GUILD.idFromName(guild.id)), (_, state) => {
      const row = state.storage.sql.exec<{ poll: string }>('SELECT poll FROM messages WHERE id = ?', msg.id).one()
      state.storage.sql.exec('UPDATE messages SET poll = ? WHERE id = ?', JSON.stringify({ ...JSON.parse(row.poll), closesAt: Date.now() - 1000 }), msg.id)
    })
    b.drain()
    b.send({ t: 'chat.vote', id: msg.id, options: [1] })
    expect((await b.next('error')).message).toMatch(/encerrada/)
    await a.nothing('chat.poll')
  })

  it('enquete não se edita; apagar leva os votos junto', async () => {
    const { guild, a, b, text } = await world()
    const msg = await ask(a, b, text.id, 'Pergunta', {})
    a.send({ t: 'chat.edit', id: msg.id, content: 'Outra pergunta' })
    expect((await a.next('error')).message).toMatch(/Enquete/)
    await b.nothing('chat.edited')
    b.send({ t: 'chat.vote', id: msg.id, options: [0] })
    await a.next('chat.poll')
    const count = () =>
      runInDurableObject(env.GUILD.get(env.GUILD.idFromName(guild.id)), (_, state) =>
        state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM poll_votes').one().n,
      )
    expect(await count()).toBe(1)
    a.send({ t: 'chat.delete', id: msg.id })
    await b.next('chat.deleted')
    expect(await count()).toBe(0)
  })

  it('só vota quem vê o canal; de castigo não vota; reenvio com o mesmo nonce não duplica', async () => {
    const { guild, friend, a, b, text } = await world()
    a.send({ t: 'channel.create', name: 'segredo', kind: 'text', overwrites: [{ id: guild.id, type: 'role', allow: 0, deny: P.VIEW_CHANNEL }] })
    const secret = (await a.next('channel.upsert', (m) => m.channel.name === 'segredo')).channel
    const hidden = await ask(a, a, secret.id, 'Só pra quem vê', {}, 'h')
    b.send({ t: 'chat.vote', id: hidden.id, options: [0] })
    b.send({ t: 'chat.poll.close', id: hidden.id })
    await a.nothing('chat.poll')
    await b.nothing('chat.poll')

    const msg = await ask(a, b, text.id, 'Aberta', {}, 'mesmo')
    a.send({ t: 'chat.send', channelId: text.id, content: 'Aberta', attachmentIds: [], nonce: 'mesmo', poll: { options: ['Pizza', 'Hambúrguer'], multiple: false, hours: 0 } })
    expect((await a.next('chat.message', (m) => m.nonce === 'mesmo' && m.message.id === msg.id)).message.poll).toBeTruthy()
    await tick()
    await b.nothing('chat.message')

    a.send({ t: 'member.timeout', userId: friend.user.id, minutes: 10, reason: '' })
    await b.next('member.upsert', (m) => m.member.timeoutUntil !== null)
    b.send({ t: 'chat.vote', id: msg.id, options: [0] })
    expect((await b.next('error')).message).toMatch(/castigo/)
    await a.nothing('chat.poll')
  })
})
