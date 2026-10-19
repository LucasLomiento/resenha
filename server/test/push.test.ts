import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { dmChannelId } from '../../shared/protocol'
import { PUSH_TEXT, Pusher, pushBody, signedAssertion, type PushMessage } from '../src/push'
import { homeSocket, login, post, tick, world } from './helpers'

const TOKEN_A = 'aparelho-do-duarte:APA91b-token-de-teste-1'
const TOKEN_B = 'aparelho-velho-desinstalado:APA91b-token-2'
const TOKEN_C = 'aparelho-de-outro-projeto:APA91b-token-3'

/** Conta de serviço de mentira, com uma chave RSA de verdade (a assinatura é conferida). */
async function serviceAccount() {
  const keys = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', keys.privateKey)) as ArrayBuffer)
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8)).replace(/.{64}/g, '$&\n')}\n-----END PRIVATE KEY-----\n`
  // Cada teste com uma conta própria (o token de acesso fica guardado por conta).
  const email = `push-${crypto.randomUUID()}@resenha-teste.iam.gserviceaccount.com`
  return { json: JSON.stringify({ project_id: 'resenha-teste', client_email: email, private_key: pem }), publicKey: keys.publicKey, email }
}

/** Google e Firebase de mentira: troca o JWT por um token e guarda os pushes. */
function fakeGoogle(dead: string[] = [], rejected: string[] = []) {
  const sent: { token: string; message: any; auth: string | null }[] = []
  let exchanges = 0
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === 'https://oauth2.googleapis.com/token') {
      exchanges++
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
      return Response.json({ access_token: 'acesso-123', expires_in: 3599 })
    }
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/resenha-teste/messages:send')
    const { message } = JSON.parse(String(init?.body))
    sent.push({ token: message.token, message, auth: new Headers(init?.headers).get('Authorization') })
    if (dead.includes(message.token)) return Response.json({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 })
    if (rejected.includes(message.token)) return Response.json({ error: { status: 'PERMISSION_DENIED', details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } }, { status: 403 })
    return Response.json({ name: 'projects/resenha-teste/messages/1' })
  }) as typeof fetch
  return { impl, sent, exchanges: () => exchanges }
}

const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))

describe('push: Firebase (unidade)', () => {
  it('assina o JWT da conta de serviço (RS256) com o escopo do FCM', async () => {
    const account = await serviceAccount()
    const jwt = await signedAssertion(JSON.parse(account.json), 1_800_000_000_000)
    const [header, claims, signature] = jwt.split('.')
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decode(claims)).toEqual({
      iss: account.email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    })
    const bytes = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', account.publicKey, bytes, new TextEncoder().encode(`${header}.${claims}`))
    expect(ok).toBe(true)
  })

  it('manda pra cada aparelho, guarda o token de acesso e devolve os que morreram e os recusados', async () => {
    const account = await serviceAccount()
    const google = fakeGoogle([TOKEN_B], [TOKEN_C])
    const pusher = new Pusher(account.json, google.impl)
    const message: PushMessage = { title: 'Duarte', body: 'oi', data: { kind: 'dm', channelId: 'dm:a:b' }, tag: 'dm:dm:a:b', kind: 'message' }
    // Token de outro projeto do Firebase (SENDER_ID_MISMATCH) nunca vai valer: sai junto com o desinstalado.
    expect(await pusher.send([TOKEN_A, TOKEN_B, TOKEN_C], message)).toEqual({ dead: [TOKEN_B, TOKEN_C], failed: [] })
    expect(await pusher.send([TOKEN_A], { ...message, kind: 'call' })).toEqual({ dead: [], failed: [] })
    expect(google.exchanges()).toBe(1)
    expect(google.sent).toHaveLength(4)
    expect(google.sent[0]).toMatchObject({
      token: TOKEN_A,
      auth: 'Bearer acesso-123',
      message: {
        notification: { title: 'Duarte', body: 'oi' },
        data: { kind: 'dm', channelId: 'dm:a:b' },
        android: { priority: 'high', notification: { tag: 'dm:dm:a:b', channel_id: 'messages', icon: 'ic_stat_resenha' } },
      },
    })
    expect(google.sent[3].message.android).toMatchObject({ ttl: '30s', notification: { channel_id: 'calls' } })
  })

  it('sem a chave (ou com uma quebrada), não manda nada', async () => {
    const google = fakeGoogle()
    for (const secret of [undefined, '', '{"project_id":"x"}', 'não é json']) {
      const pusher = new Pusher(secret, google.impl)
      expect(pusher.enabled).toBe(false)
      expect(await pusher.send([TOKEN_A], { title: 't', body: 'b', data: {}, tag: 't', kind: 'message' })).toEqual({ dead: [], failed: [] })
    }
    expect(google.sent).toHaveLength(0)
  })

  it('texto do aviso: menções com nome, anexo e mensagem de voz', () => {
    const names = { user: (id: string) => (id === 'u1' ? 'Duarte' : null) }
    expect(pushBody('oi <@u1> e <@u9>, olha <#c1> <@&r1>', [], names, PUSH_TEXT.pt)).toBe('oi @Duarte e @…, olha #… @…')
    const all = { ...names, role: (id: string) => (id === 'r1' ? 'mods' : null), channel: (id: string) => (id === 'c1' ? 'geral' : null) }
    expect(pushBody('olha <#c1> <@&r1>', [], all, PUSH_TEXT.pt)).toBe('olha #geral @mods')
    // Spoiler não aparece na tela de bloqueio.
    expect(pushBody('o final é ||ele morre||', [], names, PUSH_TEXT.pt)).toBe('o final é ▒▒▒')
    expect(pushBody('', [{ name: 'foto.webp' }], names, PUSH_TEXT.pt)).toBe('📎 foto.webp')
    expect(pushBody('', [{ name: 'mensagem-de-voz-123.mp3' }], names, PUSH_TEXT.en)).toBe('Sent a voice message')
    expect(pushBody('a'.repeat(400), [], names, PUSH_TEXT.pt)).toHaveLength(300)
  })
})

/** Liga o push no Home de alguém, com o Firebase de mentira (a chave vem do teste, não do ambiente). */
async function fakePush(userId: string, dead: string[] = []) {
  const account = await serviceAccount()
  const google = fakeGoogle(dead)
  await runInDurableObject(env.HOME.get(env.HOME.idFromName(userId)), (instance) => {
    ;(instance as unknown as { pusher: Pusher }).pusher = new Pusher(account.json, google.impl)
  })
  return google
}

/** Espera os pushes chegarem (o envio sai depois da mensagem). */
async function until(check: () => boolean, ms = 2000) {
  for (let waited = 0; waited < ms && !check(); waited += 20) await tick(20)
}

describe('push: quando o celular recebe', () => {
  it('mensagem privada e ligação vão pro celular; só o computador com a pessoa olhando segura; "Não perturbe" também', async () => {
    const { owner, friend } = await world()
    const google = await fakePush(friend.user.id)
    const phone = await homeSocket(friend.user.id, friend.token, { mobile: true })
    await phone.next('ready')
    phone.send({ t: 'push.token', token: TOKEN_A, locale: 'pt', preview: true })
    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    const channelId = dmChannelId(owner.user.id, friend.user.id)

    homeA.send({ t: 'dm.send', channelId, content: 'oi <@' + friend.user.id + '>', attachmentIds: [], nonce: '1' })
    await until(() => google.sent.length === 1)
    expect(google.sent[0].message).toMatchObject({
      notification: { title: 'Lucas', body: 'oi @…' },
      data: { kind: 'dm', channelId },
      android: { notification: { tag: `dm:${channelId}` } },
    })

    homeA.send({ t: 'call.ring', channelId, video: true })
    await until(() => google.sent.length === 2)
    expect(google.sent[1].message).toMatchObject({
      notification: { title: 'Lucas está fazendo uma chamada de vídeo', body: 'Toque pra atender' },
      data: { kind: 'call', channelId },
      android: { notification: { channel_id: 'calls' } },
    })
    homeA.send({ t: 'call.hangup', channelId })

    // Computador aberto, mas ninguém olhando (outra janela, ou a pessoa longe): o celular avisa.
    const desktop = await homeSocket(friend.user.id, friend.token)
    await desktop.next('ready')
    homeA.send({ t: 'dm.send', channelId, content: 'tá aí?', attachmentIds: [], nonce: '2' })
    await until(() => google.sent.length === 3)

    // Olhando o app no computador: o aviso fica lá, o celular não toca.
    desktop.send({ t: 'attention', on: true })
    await tick(100)
    homeA.send({ t: 'dm.send', channelId, content: 'tá vendo?', attachmentIds: [], nonce: '3' })
    await desktop.next('dm.message', (m) => m.message.content === 'tá vendo?')
    // O celular dizendo que "olha" não conta (só o computador segura).
    phone.send({ t: 'attention', on: true })
    // Saiu da frente do computador: o celular volta a receber.
    desktop.send({ t: 'attention', on: false })
    await tick(100)
    homeA.send({ t: 'dm.send', channelId, content: 'acorda', attachmentIds: [], nonce: '4' })
    await until(() => google.sent.length === 4)
    expect(google.sent.map((s) => s.message.notification.body)).toEqual(['oi @…', 'Toque pra atender', 'tá aí?', 'acorda'])

    // Voltando (a conexão caiu e reconectou) já olhando: segura desde o começo.
    desktop.drop()
    const back = await homeSocket(friend.user.id, friend.token, { attention: true })
    await back.next('ready')
    homeA.send({ t: 'dm.send', channelId, content: 'voltou?', attachmentIds: [], nonce: '5' })
    await back.next('dm.message', (m) => m.message.content === 'voltou?')
    back.send({ t: 'attention', on: false })
    await tick(100)

    // "Não perturbe" escolhido: nada. (Espera o limite de 5 mensagens em 5 s de quem manda.)
    phone.send({ t: 'presence', status: 'dnd', text: null })
    await tick(5500)
    homeA.send({ t: 'dm.send', channelId, content: 'psiu', attachmentIds: [], nonce: '6' })
    await homeA.next('dm.message', (m) => m.message.content === 'psiu')
    await tick(200)
    expect(google.sent).toHaveLength(4)
  }, 15_000)

  it('idioma e "esconder o texto" de cada aparelho; token morto sai; sair da conta para o push', async () => {
    const { owner, friend } = await world()
    const google = await fakePush(friend.user.id, [TOKEN_B])
    const phone = await homeSocket(friend.user.id, friend.token, { mobile: true })
    await phone.next('ready')
    phone.send({ t: 'push.token', token: TOKEN_A, locale: 'en', preview: false })
    // Outro celular (outra sessão), com um token que o Firebase já não conhece.
    const other = await login('duarte')
    const oldPhone = await homeSocket(friend.user.id, other.body.token, { mobile: true })
    await oldPhone.next('ready')
    oldPhone.send({ t: 'push.token', token: TOKEN_B })
    // Token que não parece token: ignorado.
    oldPhone.send({ t: 'push.token', token: 'x' })
    oldPhone.send({ t: 'push.token', token: TOKEN_B })
    await tick(100)

    const homeA = await homeSocket(owner.user.id, owner.token)
    await homeA.next('ready')
    homeA.send({ t: 'dm.open', userId: friend.user.id, reqId: 'o' })
    await homeA.next('dm.channel')
    const channelId = dmChannelId(owner.user.id, friend.user.id)
    homeA.send({ t: 'dm.send', channelId, content: 'segredo', attachmentIds: [], nonce: '1' })
    await until(() => google.sent.length === 2)
    const byToken = Object.fromEntries(google.sent.map((s) => [s.token, s.message.notification]))
    expect(byToken[TOKEN_A]).toEqual({ title: 'Lucas', body: 'New message' })
    expect(byToken[TOKEN_B]).toEqual({ title: 'Lucas', body: 'segredo' })

    // O token morto saiu: a próxima só vai pro aparelho que vale.
    homeA.send({ t: 'dm.send', channelId, content: 'de novo', attachmentIds: [], nonce: '2' })
    await until(() => google.sent.length === 3)
    expect(google.sent[2].token).toBe(TOKEN_A)

    // Saiu da conta no celular: aquele aparelho para de receber.
    await post('/api/logout', {}, friend.token)
    homeA.send({ t: 'dm.send', channelId, content: 'sumiu?', attachmentIds: [], nonce: '3' })
    await homeA.next('dm.message', (m) => m.message.content === 'sumiu?')
    await tick(200)
    expect(google.sent).toHaveLength(3)
  })

  it('aviso de teste: vai só pro aparelho que pediu, mesmo com o computador olhando, e diz o que houve', async () => {
    const { friend } = await world()
    const google = await fakePush(friend.user.id, [TOKEN_B])
    const phone = await homeSocket(friend.user.id, friend.token, { mobile: true })
    await phone.next('ready')
    // Sem token deste aparelho ainda: avisa na hora.
    phone.send({ t: 'push.test' })
    expect((await phone.next('push.test')).result).toBe('no-device')

    phone.send({ t: 'push.token', token: TOKEN_A, locale: 'es' })
    const desktop = await homeSocket(friend.user.id, friend.token, { attention: true })
    await desktop.next('ready')
    phone.send({ t: 'push.test' })
    expect((await phone.next('push.test')).result).toBe('sent')
    expect(google.sent).toHaveLength(1)
    expect(google.sent[0]).toMatchObject({ token: TOKEN_A, message: { notification: { title: 'Aviso de prueba' }, data: { kind: 'test' } } })

    // Outro celular, com um token que o Firebase já esqueceu: o teste conta, e o token sai.
    const other = await login('duarte')
    const oldPhone = await homeSocket(friend.user.id, other.body.token, { mobile: true })
    await oldPhone.next('ready')
    oldPhone.send({ t: 'push.token', token: TOKEN_B })
    oldPhone.send({ t: 'push.test' })
    expect((await oldPhone.next('push.test')).result).toBe('dead')
    oldPhone.send({ t: 'push.test' })
    expect((await oldPhone.next('push.test')).result).toBe('no-device')
  })

  it('servidor: segue o nível de aviso (todas, só menções, nada, silenciado)', async () => {
    const { owner, friend, a, b, text } = await world()
    const google = await fakePush(friend.user.id)
    const phone = await homeSocket(friend.user.id, friend.token, { mobile: true })
    await phone.next('ready')
    phone.send({ t: 'push.token', token: TOKEN_A })
    await tick(50)

    // Padrão: todas as mensagens.
    a.send({ t: 'chat.send', channelId: text.id, content: 'bom dia', attachmentIds: [], nonce: '1' })
    await until(() => google.sent.length === 1)
    expect(google.sent[0].message).toMatchObject({
      notification: { title: `Lucas em #${text.name} · Turma`, body: 'bom dia' },
      data: { kind: 'channel', channelId: text.id },
    })

    // Só menções: mensagem comum não vai; a que menciona vai (com o nome no lugar do <@id>).
    b.send({ t: 'notify.update', settings: { level: 'mentions', mutedUntil: null, channels: {} } })
    await b.next('notify.settings')
    a.send({ t: 'chat.send', channelId: text.id, content: 'alguém?', attachmentIds: [], nonce: '2' })
    a.send({ t: 'chat.send', channelId: text.id, content: `<@${friend.user.id}> bora`, attachmentIds: [], nonce: '3' })
    await until(() => google.sent.length === 2)
    expect(google.sent[1].message.notification.body).toBe('@Duarte bora')

    // Servidor silenciado: nem menção.
    b.send({ t: 'notify.update', settings: { level: 'all', mutedUntil: Date.now() + 60_000, channels: {} } })
    await b.next('notify.settings')
    a.send({ t: 'chat.send', channelId: text.id, content: `<@${friend.user.id}> oi`, attachmentIds: [], nonce: '4' })
    await a.next('chat.message', (m) => m.nonce === '4')
    // Quem escreveu não recebe push da própria mensagem.
    const ownerPush = await fakePush(owner.user.id)
    const ownerPhone = await homeSocket(owner.user.id, owner.token, { mobile: true })
    await ownerPhone.next('ready')
    ownerPhone.send({ t: 'push.token', token: TOKEN_B })
    await tick(50)
    a.send({ t: 'chat.send', channelId: text.id, content: 'só eu', attachmentIds: [], nonce: '5' })
    await a.next('chat.message', (m) => m.nonce === '5')
    await tick(200)
    expect(google.sent).toHaveLength(2)
    expect(ownerPush.sent).toHaveLength(0)
  })
})
