import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { dmChannelId } from '../../shared/protocol'
import { call, guildSocket, homeSocket, post, tick, upload, world } from './helpers'

// Correções da auditoria da 1.18 (uma por teste, com o cenário que dava errado).

const MINUTE = 60_000
const KEY = 'chave-do-app-do-duarte-1'

describe('reenvio depois de uma queda', () => {
  it('mensagem só com anexo: o reenvio com o mesmo nonce confirma (antes dizia que o anexo não existia mais)', async () => {
    const { guild, friend, a, b, text } = await world()
    const up = await upload(`/api/g/${guild.id}/files?channel=${text.id}`, friend.token, 'conteúdo', 'nota.txt')
    expect(up.status).toBe(200)
    b.send({ t: 'chat.send', channelId: text.id, content: '', attachmentIds: [up.body.id], nonce: 'anexo' })
    const first = (await b.next('chat.message', (m) => m.nonce === 'anexo')).message
    expect(first.attachments.map((x) => x.name)).toEqual(['nota.txt'])
    await a.next('chat.message')
    // A confirmação se perdeu e o app manda de novo: o anexo já é da mensagem, não está mais "solto".
    b.drain()
    b.send({ t: 'chat.send', channelId: text.id, content: '', attachmentIds: [up.body.id], nonce: 'anexo' })
    expect((await b.next('chat.message', (m) => m.nonce === 'anexo')).message.id).toBe(first.id)
    await b.nothing('error')
    await a.nothing('chat.message')
  })

  it('conversa privada: confirmar o reenvio de uma mensagem antiga não volta a conversa pra ela nem zera as não lidas', async () => {
    const { owner, friend } = await world()
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    const homeB = await homeSocket(friend.user.id, friend.token)
    await homeB.next('ready')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    homeA.send({ t: 'dm.send', channelId, content: 'primeira', attachmentIds: [], nonce: 'n1' })
    const m1 = (await homeA.next('dm.message', (m) => m.nonce === 'n1')).message
    await homeB.next('dm.message')
    homeB.send({ t: 'dm.send', channelId, content: 'resposta', attachmentIds: [], nonce: 'n2' })
    const m2 = (await homeA.next('dm.message', (m) => m.message.content === 'resposta')).message
    // O app do Lucas não viu a confirmação da primeira (caiu) e reenvia depois de a resposta chegar.
    homeA.drain()
    homeA.send({ t: 'dm.send', channelId, content: 'primeira', attachmentIds: [], nonce: 'n1' })
    expect((await homeA.next('dm.message', (m) => m.nonce === 'n1')).message.id).toBe(m1.id)
    const again = await homeSocket(owner.user.id, owner.token)
    const dm = (await again.next('ready')).dms.find((d) => d.id === channelId)!
    expect(dm).toMatchObject({ lastMessageId: m2.id, unread: 1, lastReadId: m1.id })
  })
})

describe('call', () => {
  it('saiu da call com a conexão caída: o app diz que não está em call e o servidor não põe de volta', async () => {
    const { guild, friend, a, b, voice } = await world()
    b.close()
    const first = await guildSocket(guild.id, friend.token, { key: KEY })
    const ready = await first.next('ready')
    first.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.some((x) => x.connId === ready.connId))
    // Cai sem avisar (o servidor espera voltar), e a pessoa clica em "sair" nesse meio-tempo.
    first.drop()
    await tick(100)
    a.drain()
    const back = await guildSocket(guild.id, friend.token, { key: KEY, voice: null })
    const again = await back.next('ready')
    expect(again.connId).toBe(ready.connId)
    expect(again.resumed).toBe(false)
    expect(again.voice).toEqual([])
    // Ninguém manda o app sair de uma call em que ele já não está.
    await back.nothing('voice.forced')
    expect((await a.next('voice.state')).members).toEqual([])
  })

  it('dizendo a sala em que está (ou sem dizer nada, como o app antigo), volta na call como antes', async () => {
    const { guild, friend, a, b, voice } = await world()
    b.close()
    for (const claim of [{ voice: voice.id }, {}]) {
      const first = await guildSocket(guild.id, friend.token, { key: KEY })
      const ready = await first.next('ready')
      first.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
      await a.next('voice.state', (m) => m.members.some((x) => x.connId === ready.connId))
      first.drop()
      await tick(100)
      const back = await guildSocket(guild.id, friend.token, { key: KEY, ...claim })
      const again = await back.next('ready')
      expect(again.resumed).toBe(true)
      expect(again.voice.map((v) => v.connId)).toEqual([ready.connId])
      back.send({ t: 'voice.leave' })
      await a.next('voice.state', (m) => m.members.length === 0)
      back.close()
      await tick(50)
      a.drain()
    }
  })

  it('entrar na call puxa a varredura de minuto em minuto (ela é que mantém a call em dia pra um reinício)', async () => {
    const { guild, a, voice } = await world()
    const stub = env.GUILD.get(env.GUILD.idFromName(guild.id))
    const alarmIn = async () => (await runInDurableObject(stub, (_, state) => state.storage.getAlarm()))! - Date.now()
    // Depois de uma varredura sem ninguém em call, a próxima fica longe.
    await runDurableObjectAlarm(stub)
    expect(await alarmIn()).toBeGreaterThan(4 * MINUTE)
    a.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.length === 1)
    expect(await alarmIn()).toBeLessThanOrEqual(MINUTE)
  })

  it('a limpeza pesada lembra quando rodou, mesmo com o servidor dormindo entre um alarme e outro', async () => {
    const { guild } = await world()
    const stub = env.GUILD.get(env.GUILD.idFromName(guild.id))
    const cleanedAt = () =>
      runInDurableObject(stub, (_, state) => Number(state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'cleaned_at'").toArray()[0]?.value ?? 0))
    const before = Date.now()
    await runDurableObjectAlarm(stub)
    const first = await cleanedAt()
    expect(first).toBeGreaterThanOrEqual(before)
    // O objeto "acorda" de novo (a memória zerou) e o alarme seguinte não refaz a limpeza.
    await runInDurableObject(stub, (instance) => {
      ;(instance as unknown as { cleanedAt: number }).cleanedAt = 0
    })
    await tick(20)
    await runDurableObjectAlarm(stub)
    expect(await cleanedAt()).toBe(first)
  })
})

describe('custo de pedidos', () => {
  it('tirar a foto ou o banner sem ter nenhum não espalha nada pros servidores', async () => {
    const { friend, a } = await world()
    a.drain()
    for (let i = 0; i < 3; i++) {
      expect((await call('DELETE', '/api/me/avatar', undefined, friend.token)).status).toBe(200)
      expect((await call('DELETE', '/api/me/banner', undefined, friend.token)).status).toBe(200)
    }
    await a.nothing('member.upsert')
    await a.nothing('user.upsert')
  })

  it('incidente do app: um a cada 10 min por pessoa, mesmo com várias conexões', async () => {
    const { owner } = await world()
    const one = await homeSocket(owner.user.id, owner.token)
    await one.next('ready')
    const two = await homeSocket(owner.user.id, owner.token)
    await two.next('ready')
    one.send({ t: 'incident', kind: 'send-limit', detail: 'a' })
    two.send({ t: 'incident', kind: 'send-limit', detail: 'b' })
    one.send({ t: 'incident', kind: 'signal-loop', detail: 'c' })
    await tick(200)
    const { incidents } = (await call<{ incidents: { kind: string }[] }>('GET', '/api/admin', undefined, owner.token)).body
    expect(incidents.filter((i) => i.kind.startsWith('app:')).map((i) => i.kind)).toEqual(['app:send-limit'])
  })
})

describe('mídia pelo Cloudflare', () => {
  it('sessão no SFU só pra quem está numa sala que passa pelo Cloudflare', async () => {
    const { guild, owner, friend, a, voice } = await world()
    const open = (token: string, body: unknown) => post('/api/media/sessions', body, token)
    // Sem dizer a sala (app até a 1.17, ou um script): recusado antes de qualquer coisa.
    expect((await open(friend.token, {})).status).toBe(403)
    // Sala direta: recusado.
    expect((await open(friend.token, { guild: guild.id, channel: voice.id })).status).toBe(403)
    // O dono do Resenha passa a sala pelo Cloudflare: quem pode entrar nela passa da conferência
    // (e aqui para no "SFU não configurado", que é como os testes rodam).
    a.send({ t: 'channel.update', id: voice.id, relay: true })
    await a.next('channel.upsert', (m) => m.channel.relay === true)
    expect((await open(friend.token, { guild: guild.id, channel: voice.id })).status).toBe(503)
    expect((await open(owner.token, { guild: guild.id, channel: voice.id })).status).toBe(503)
    // Sala de outro servidor, canal inventado, ou lixo no lugar dos ids: recusado.
    expect((await open(friend.token, { guild: guild.id, channel: 'nao-existe' })).status).toBe(403)
    expect((await open(friend.token, { guild: 'outro', channel: voice.id })).status).toBe(403)
    expect((await open(friend.token, { guild: { $ne: 1 }, channel: [voice.id] })).status).toBe(403)
  })
})
