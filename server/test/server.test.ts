import { SELF, abortAllDurableObjects, env, evictAllDurableObjects, runInDurableObject } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { dmChannelId, type AuthResponse, type ClientMessage, type ServerMessage } from '../../shared/protocol'
import { signFileUrl, verifyFileSignature } from '../src/auth'

const BASE = 'https://resenha.test'

// Todos os testes falam com o mesmo Durable Object ("main"); zera entre um e outro.
afterEach(async () => {
  const stub = env.SPACE.get(env.SPACE.idFromName('main'))
  await runInDurableObject(stub, (_, state) => state.storage.deleteAll())
  await abortAllDurableObjects()
})

async function api<T = any>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await SELF.fetch(BASE + path, init)
  return { status: res.status, body: (await res.json()) as T }
}

function post(path: string, body: unknown, token?: string) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

async function register(name: string, invite?: string): Promise<AuthResponse> {
  const res = await post('/api/register', { name, password: 'senha123', invite })
  expect(res.status).toBe(200)
  return res.body
}

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>

/** Cliente WebSocket de teste: guarda tudo que chega e deixa esperar por tipo. */
class Client {
  private inbox: ServerMessage[] = []
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = []
  closeCode: number | null = null

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data as string) as ServerMessage
      const i = this.waiters.findIndex((w) => w.match(msg))
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg)
      else this.inbox.push(msg)
    })
    ws.addEventListener('close', (event) => {
      this.closeCode = event.code
    })
  }

  /** Conecta e se autentica pela primeira mensagem (como o app faz desde a 0.5). */
  static async open(token: string, opts: { legacy?: boolean; skipAuth?: boolean } = {}): Promise<Client> {
    const url = opts.legacy ? `${BASE}/ws?token=${encodeURIComponent(token)}` : `${BASE}/ws`
    const res = await SELF.fetch(url, { headers: { Upgrade: 'websocket' } })
    const ws = res.webSocket!
    ws.accept()
    const client = new Client(ws)
    if (!opts.legacy && !opts.skipAuth) client.send({ t: 'auth', token })
    return client
  }

  next<T extends ServerMessage['t']>(t: T, where: (m: Of<T>) => boolean = () => true): Promise<Of<T>> {
    const match = (m: ServerMessage) => m.t === t && where(m as Of<T>)
    const i = this.inbox.findIndex(match)
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as Of<T>)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`esperando ${t}`)), 2000)
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m as Of<T>)
        },
      })
    })
  }

  /** Confirma que nada desse tipo chegou (espera um pouco antes de olhar). */
  async nothing(t: ServerMessage['t']) {
    await new Promise((r) => setTimeout(r, 150))
    expect(this.inbox.filter((m) => m.t === t)).toEqual([])
  }

  send(msg: ClientMessage) {
    this.ws.send(JSON.stringify(msg))
  }

  close() {
    this.ws.close(1000)
  }
}

async function channelIds(token: string) {
  const c = await Client.open(token)
  const ready = await c.next('ready')
  c.close()
  return {
    text: ready.channels.find((ch) => ch.kind === 'text')!.id,
    voice: ready.channels.find((ch) => ch.kind === 'voice')!.id,
  }
}

/** Admin + um amigo, os dois conectados. */
async function setup() {
  const admin = await register('Lucas')
  const a = await Client.open(admin.token)
  const ready = await a.next('ready')
  a.send({ t: 'invite.create' })
  const { code } = await a.next('invite.created')
  const friend = await register('Amigo', code)
  const b = await Client.open(friend.token)
  const readyB = await b.next('ready')
  const text = ready.channels.find((c) => c.kind === 'text')!
  const voice = ready.channels.find((c) => c.kind === 'voice')!
  return { admin, friend, a, b, connA: ready.connId, connB: readyB.connId, text, voice }
}

describe('contas', () => {
  it('a primeira conta vira admin e as próximas precisam de convite', async () => {
    expect((await api('/api/status')).body).toEqual({ needsInvite: false })
    const admin = await register('Lucas')
    expect(admin.user.admin).toBe(true)
    expect((await api('/api/status')).body).toEqual({ needsInvite: true })

    expect((await post('/api/register', { name: 'Outro', password: 'senha123' })).status).toBe(403)
    expect((await post('/api/register', { name: 'Outro', password: 'senha123', invite: 'chute' })).status).toBe(403)
  })

  it('convite só vale uma vez e apelido não repete', async () => {
    const admin = await register('Lucas')
    const a = await Client.open(admin.token)
    await a.next('ready')
    a.send({ t: 'invite.create' })
    const { code } = await a.next('invite.created')

    expect((await post('/api/register', { name: 'lucas', password: 'senha123', invite: code })).status).toBe(409)
    const friend = await register('Amigo', code)
    expect(friend.user.admin).toBe(false)
    expect((await post('/api/register', { name: 'Terceiro', password: 'senha123', invite: code })).status).toBe(403)
    a.close()
  })

  it('login confere a senha e logout derruba a sessão', async () => {
    await register('Lucas')
    expect((await post('/api/login', { name: 'Lucas', password: 'errada' })).status).toBe(401)
    const ok = await post('/api/login', { name: 'lucas', password: 'senha123' })
    expect(ok.status).toBe(200)
    const token = ok.body.token as string

    expect((await api('/api/ice', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200)
    await post('/api/logout', {}, token)
    expect((await api('/api/ice', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
  })

  it('WebSocket com token inválido fecha com 4001', async () => {
    const c = await Client.open('token-que-nao-existe')
    await new Promise((r) => setTimeout(r, 100))
    expect(c.closeCode).toBe(4001)
  })

  it('sem autenticar, a conexão não recebe nada e é derrubada ao tentar falar', async () => {
    const admin = await register('Lucas')
    const a = await Client.open(admin.token)
    await a.next('ready')
    const intruso = await Client.open('', { skipAuth: true })
    a.send({ t: 'chat.send', channelId: (await channelIds(admin.token)).text, content: 'segredo', attachmentIds: [], nonce: 's' })
    await a.next('chat.message')
    await intruso.nothing('chat.message')
    intruso.send({ t: 'typing', channelId: 'x' })
    await new Promise((r) => setTimeout(r, 100))
    expect(intruso.closeCode).toBe(4001)
  })

  it('versões antigas (token na URL) ainda conectam', async () => {
    const admin = await register('Lucas')
    const c = await Client.open(admin.token, { legacy: true })
    expect((await c.next('ready')).me.name).toBe('Lucas')
  })
})

describe('chat', () => {
  it('mensagem chega pra todo mundo e fica no histórico', async () => {
    const { a, b, text } = await setup()
    a.send({ t: 'chat.send', channelId: text.id, content: '  salve  ', attachmentIds: [], nonce: 'n1' })
    const got = await b.next('chat.message')
    expect(got.message.content).toBe('salve')
    expect((await a.next('chat.message')).nonce).toBe('n1')

    b.send({ t: 'chat.history', reqId: 'h1', channelId: text.id })
    const history = await b.next('chat.history')
    expect(history.messages.map((m) => m.content)).toEqual(['salve'])
    expect(history.hasMore).toBe(false)
  })

  it('histórico pagina do mais novo pro mais velho', async () => {
    const { a, text } = await setup()
    for (let i = 0; i < 55; i++) {
      a.send({ t: 'chat.send', channelId: text.id, content: `m${i}`, attachmentIds: [], nonce: `${i}` })
    }
    await a.next('chat.message', (m) => m.message.content === 'm54')

    a.send({ t: 'chat.history', reqId: 'p1', channelId: text.id })
    const page1 = await a.next('chat.history', (m) => m.reqId === 'p1')
    expect(page1.messages).toHaveLength(50)
    expect(page1.messages.at(-1)!.content).toBe('m54')
    expect(page1.hasMore).toBe(true)

    a.send({ t: 'chat.history', reqId: 'p2', channelId: text.id, before: page1.messages[0].id })
    const page2 = await a.next('chat.history', (m) => m.reqId === 'p2')
    expect(page2.messages.map((m) => m.content)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
    expect(page2.hasMore).toBe(false)
  })

  it('só o autor edita; autor ou admin apagam', async () => {
    const { a, b, text } = await setup()
    b.send({ t: 'chat.send', channelId: text.id, content: 'oi', attachmentIds: [], nonce: 'x' })
    const { message } = await a.next('chat.message')

    a.send({ t: 'chat.edit', id: message.id, content: 'hackeado' })
    await b.nothing('chat.edited')

    b.send({ t: 'chat.edit', id: message.id, content: 'oi!' })
    expect((await a.next('chat.edited')).message.content).toBe('oi!')

    a.send({ t: 'chat.delete', id: message.id })
    expect((await b.next('chat.deleted')).id).toBe(message.id)
  })

  it('anexo sobe, vira link assinado e entra na mensagem', async () => {
    const { admin, a, b, text } = await setup()
    const upload = await api('/api/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Content-Type': 'text/plain',
        'X-File-Name': encodeURIComponent('notas da call.txt'),
      },
      body: 'conteúdo do arquivo',
    })
    expect(upload.status).toBe(200)
    const attachment = upload.body

    a.send({ t: 'chat.send', channelId: text.id, content: '', attachmentIds: [attachment.id], nonce: 'f' })
    const { message } = await b.next('chat.message')
    expect(message.attachments).toHaveLength(1)
    expect(message.attachments[0].name).toBe('notas da call.txt')

    const file = await SELF.fetch(BASE + message.attachments[0].url)
    expect(file.status).toBe(200)
    expect(await file.text()).toBe('conteúdo do arquivo')

    const tampered = message.attachments[0].url.replace(/sig=./, 'sig=A')
    expect((await SELF.fetch(BASE + tampered)).status).toBe(403)
  })
})

describe('mensagens privadas', () => {
  it('chegam só pros dois, e um terceiro não lê nem escreve', async () => {
    const { admin, friend, a, b } = await setup()
    a.send({ t: 'invite.create' })
    const { code } = await a.next('invite.created')
    const third = await register('Terceiro', code)
    const c = await Client.open(third.token)
    await c.next('ready')

    const dm = dmChannelId(admin.user.id, friend.user.id)
    a.send({ t: 'chat.send', channelId: dm, content: 'só entre nós', attachmentIds: [], nonce: 'p' })
    expect((await b.next('chat.message')).message.channelId).toBe(dm)
    await a.next('chat.message')
    await c.nothing('chat.message')

    c.send({ t: 'chat.history', reqId: 'x', channelId: dm })
    await c.nothing('chat.history')
    c.send({ t: 'chat.send', channelId: dm, content: 'intruso', attachmentIds: [], nonce: 'i' })
    expect((await c.next('error')).message).toBe('Canal não existe.')

    b.send({ t: 'typing', channelId: dm })
    expect((await a.next('typing')).channelId).toBe(dm)
    await c.nothing('typing')

    b.send({ t: 'chat.history', reqId: 'h', channelId: dm })
    expect((await b.next('chat.history')).messages.map((m) => m.content)).toEqual(['só entre nós'])
  })

  it('não dá pra abrir conversa consigo mesmo nem com quem não existe', async () => {
    const { admin, a } = await setup()
    a.send({ t: 'chat.send', channelId: dmChannelId(admin.user.id, 'zzzz'), content: 'oi', attachmentIds: [], nonce: 'n' })
    expect((await a.next('error')).message).toBe('Canal não existe.')
    a.send({ t: 'chat.send', channelId: `dm:${admin.user.id}:${admin.user.id}`, content: 'oi', attachmentIds: [], nonce: 'm' })
    expect((await a.next('error')).message).toBe('Canal não existe.')
  })
})

describe('anexos no próprio servidor', () => {
  async function upload(token: string, body: Uint8Array | string, name: string, type = 'application/octet-stream') {
    return api('/api/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) },
      body,
    })
  }

  it('arquivo de vários pedaços volta igual, com Range, e some ao apagar a mensagem', async () => {
    const { admin, a, b, text } = await setup()
    const data = new Uint8Array(2.5 * 1024 * 1024)
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) % 251
    const up = await upload(admin.token, data, 'clipe.bin')
    expect(up.status).toBe(200)
    expect(up.body.size).toBe(data.length)

    const whole = await SELF.fetch(BASE + up.body.url)
    expect(whole.status).toBe(200)
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(data)

    // Um pedaço que atravessa a fronteira de 1 MB entre dois blocos.
    const start = 1024 * 1024 - 10
    const part = await SELF.fetch(BASE + up.body.url, { headers: { Range: `bytes=${start}-${start + 19}` } })
    expect(part.status).toBe(206)
    expect(part.headers.get('Content-Range')).toBe(`bytes ${start}-${start + 19}/${data.length}`)
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(data.slice(start, start + 20))

    a.send({ t: 'chat.send', channelId: text.id, content: 'clipe', attachmentIds: [up.body.id], nonce: 'c' })
    const { message } = await b.next('chat.message')
    a.send({ t: 'chat.delete', id: message.id })
    await b.next('chat.deleted')
    expect((await SELF.fetch(BASE + up.body.url)).status).toBe(404)
    const stub = env.SPACE.get(env.SPACE.idFromName('main'))
    const left = await runInDurableObject(stub, (_, state) => state.storage.sql.exec('SELECT COUNT(*) AS n FROM file_chunks').one().n)
    expect(left).toBe(0)
  })

  it('recusa arquivo acima do limite e envio sem login', async () => {
    const { admin } = await setup()
    const big = await api('/api/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.token}`, 'Content-Length': String(30 * 1024 * 1024) },
      body: 'x',
    })
    expect(big.status).toBe(413)
    expect((await upload('token-falso', 'oi', 'a.txt')).status).toBe(401)
  })

  it('não aceita alguém se passar por outro usuário pelo cabeçalho interno', async () => {
    const { friend } = await setup()
    const res = await api('/api/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${friend.token}`, 'X-Resenha-User': 'outro-id', 'X-File-Name': 'a.txt' },
      body: 'oi',
    })
    expect(res.status).toBe(200)
    const stub = env.SPACE.get(env.SPACE.idFromName('main'))
    const uploader = await runInDurableObject(stub, (_, state) =>
      state.storage.sql.exec('SELECT uploader_id FROM attachments WHERE id = ?', res.body.id).one().uploader_id,
    )
    expect(uploader).toBe(friend.user.id)
  })
})

describe('voz e sinalização', () => {
  it('entrar na call avisa todo mundo e a sinalização só vai pro destino', async () => {
    const { admin, a, b, connA, connB, voice } = await setup()
    const c = await Client.open(admin.token) // segunda conexão, fora da call
    const readyC = await c.next('ready')

    a.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    b.send({ t: 'voice.join', channelId: voice.id, muted: true, deafened: false })
    const state = await c.next('voice.state', (m) => m.members.length === 2)
    expect(state.members.find((m) => m.connId === connB)?.muted).toBe(true)

    a.send({ t: 'rtc.signal', to: connB, data: { kind: 'watch' } })
    const signal = await b.next('rtc.signal')
    expect(signal).toEqual({ t: 'rtc.signal', from: connA, data: { kind: 'watch' } })

    // Quem não está na call não manda nem recebe sinalização.
    c.send({ t: 'rtc.signal', to: connB, data: { kind: 'watch' } })
    a.send({ t: 'rtc.signal', to: readyC.connId, data: { kind: 'watch' } })
    await b.nothing('rtc.signal')
    await c.nothing('rtc.signal')
  })

  it('a call sobrevive à hibernação do Durable Object', async () => {
    const { a, b, connA, connB, voice } = await setup()
    a.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    b.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.length === 2)

    await evictAllDurableObjects()

    a.send({ t: 'rtc.signal', to: connB, data: { kind: 'unwatch' } })
    expect((await b.next('rtc.signal')).from).toBe(connA)
    b.send({ t: 'voice.update', muted: true, deafened: false, sharing: true, camera: true })
    const state = await a.next('voice.state', (m) => m.members.some((x) => x.sharing))
    expect(state.members).toHaveLength(2)
    expect(state.members.find((x) => x.connId === connB)?.camera).toBe(true)
  })

  it('cair da conexão tira da call', async () => {
    const { a, b, connB, voice } = await setup()
    a.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    b.send({ t: 'voice.join', channelId: voice.id, muted: false, deafened: false })
    await a.next('voice.state', (m) => m.members.length === 2)

    b.close()
    const after = await a.next('voice.state', (m) => m.members.length === 1)
    expect(after.members.some((m) => m.connId === connB)).toBe(false)
  })
})

describe('URL assinada', () => {
  it('vence depois da validade', async () => {
    const now = Date.UTC(2026, 9, 5)
    const url = new URL(await signFileUrl('k', 'abc', 'a.png', now), BASE)
    const exp = url.searchParams.get('exp')
    const sig = url.searchParams.get('sig')
    expect(await verifyFileSignature('k', 'abc', exp, sig, now)).toBe(true)
    expect(await verifyFileSignature('k', 'abc', exp, sig, now + 30 * 24 * 3600 * 1000)).toBe(false)
    expect(await verifyFileSignature('outra', 'abc', exp, sig, now)).toBe(false)
  })
})
