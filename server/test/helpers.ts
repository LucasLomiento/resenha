import { SELF, abortAllDurableObjects, env, listDurableObjectIds, runInDurableObject } from 'cloudflare:test'
import { afterEach, expect } from 'vitest'
import type {
  AuthResponse,
  ClientMessage,
  GuildInfo,
  HomeClientMessage,
  HomeServerMessage,
  ServerMessage,
} from '../../shared/protocol'

export const BASE = 'https://resenha.test'
export const PASSWORD = 'senha-forte-1'

// Cada teste começa do zero: apaga os dados de todos os Durable Objects.
afterEach(async () => {
  await abortAllDurableObjects()
  for (const ns of [env.DIRECTORY, env.GUILD, env.HOME, env.CONVERSATION] as DurableObjectNamespace[]) {
    for (const id of await listDurableObjectIds(ns)) {
      await runInDurableObject(ns.get(id), async (_, state) => {
        await state.storage.deleteAlarm()
        await state.storage.deleteAll()
      })
    }
  }
  await abortAllDurableObjects()
})

export async function api<T = any>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await SELF.fetch(BASE + path, init)
  const text = await res.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    // não é JSON
  }
  return { status: res.status, body }
}

export function call<T = any>(method: string, path: string, body?: unknown, token?: string) {
  return api<T>(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export const post = <T = any>(path: string, body: unknown, token?: string) => call<T>('POST', path, body, token)

export async function signup(username: string, invite?: string, name?: string): Promise<AuthResponse> {
  const res = await post<AuthResponse>('/api/register', { username, name, password: PASSWORD, invite })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

export async function login(username: string, password = PASSWORD) {
  return post<AuthResponse & { error?: string }>('/api/login', { username, password })
}

type Message = { t: string }

/** Cliente WebSocket de teste: guarda tudo que chega e deixa esperar por tipo. */
export class Socket<In extends Message, Out extends Message> {
  private inbox: In[] = []
  private waiters: { match: (m: In) => boolean; resolve: (m: In) => void }[] = []
  closeCode: number | null = null
  private closeWaiters: ((code: number) => void)[] = []

  constructor(private ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data as string) as In
      const i = this.waiters.findIndex((w) => w.match(msg))
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg)
      else this.inbox.push(msg)
    })
    ws.addEventListener('close', (event) => {
      this.closeCode = event.code
      for (const w of this.closeWaiters.splice(0)) w(event.code)
    })
  }

  static async connect<In extends Message, Out extends Message>(path: string): Promise<Socket<In, Out>> {
    const res = await SELF.fetch(BASE + path, { headers: { Upgrade: 'websocket' } })
    if (!res.webSocket) throw new Error(`sem WebSocket em ${path}: ${res.status}`)
    res.webSocket.accept()
    return new Socket<In, Out>(res.webSocket)
  }

  next<T extends In['t']>(t: T, where: (m: Extract<In, { t: T }>) => boolean = () => true): Promise<Extract<In, { t: T }>> {
    const match = (m: In) => m.t === t && where(m as Extract<In, { t: T }>)
    const i = this.inbox.findIndex(match)
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as Extract<In, { t: T }>)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`esperando ${t}`)), 2500)
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m as Extract<In, { t: T }>)
        },
      })
    })
  }

  /** Esquece o que já chegou (pra conferir só o que vem depois). */
  drain() {
    this.inbox = []
  }

  /** Confirma que nada desse tipo chegou (espera um pouco antes de olhar). */
  async nothing(t: In['t'], where: (m: In) => boolean = () => true) {
    await new Promise((r) => setTimeout(r, 150))
    expect(this.inbox.filter((m) => m.t === t && where(m))).toEqual([])
  }

  closed(): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('esperando fechar')), 2500)
      this.closeWaiters.push((code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
  }

  send(msg: Out) {
    this.ws.send(JSON.stringify(msg))
  }

  close() {
    this.ws.close(1000)
  }
}

export type GuildSocket = Socket<ServerMessage, ClientMessage>
export type HomeSocket = Socket<HomeServerMessage, HomeClientMessage>

export async function guildSocket(guildId: string, token: string, extra: Partial<Extract<ClientMessage, { t: 'auth' }>> = {}) {
  const s = await Socket.connect<ServerMessage, ClientMessage>(`/api/g/${guildId}/ws`)
  s.send({ t: 'auth', token, ...extra })
  return s
}

export async function legacySocket(token: string) {
  const s = await Socket.connect<ServerMessage, ClientMessage>('/ws')
  s.send({ t: 'auth', token })
  return s
}

export async function homeSocket(userId: string, token: string, extra: Partial<Extract<HomeClientMessage, { t: 'auth' }>> = {}) {
  const s = await Socket.connect<HomeServerMessage, HomeClientMessage>(`/api/home/${userId}/ws`)
  s.send({ t: 'auth', token, ...extra })
  return s
}

export async function createGuild(token: string, name = 'Turma'): Promise<GuildInfo> {
  const res = await post<GuildInfo>('/api/guilds', { name }, token)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

export async function invite(socket: GuildSocket, options: { maxAge?: number | null; maxUses?: number | null } = {}) {
  socket.send({ t: 'invite.create', ...options })
  return (await socket.next('invite.created')).code
}

/** Dono + um amigo no mesmo servidor, os dois conectados. */
export async function world() {
  const owner = await signup('lucas', undefined, 'Lucas')
  const guild = await createGuild(owner.token)
  const a = await guildSocket(guild.id, owner.token)
  const readyA = await a.next('ready')
  const code = await invite(a)
  const friend = await signup('duarte', code, 'Duarte')
  await a.next('member.upsert', (m) => m.member.userId === friend.user.id)
  const b = await guildSocket(guild.id, friend.token)
  const readyB = await b.next('ready')
  const text = readyA.channels.find((c) => c.kind === 'text')!
  const voice = readyA.channels.find((c) => c.kind === 'voice')!
  return { owner, friend, guild, a, b, readyA, readyB, text, voice }
}

export async function upload(path: string, token: string, content: BodyInit, name: string, type = 'text/plain') {
  return api(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-File-Name': encodeURIComponent(name), 'Content-Type': type },
    body: content,
  })
}

export const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms))
