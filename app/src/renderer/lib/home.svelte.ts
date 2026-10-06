import {
  dmChannelId,
  type DmChannel,
  type Friend,
  type GuildInfo,
  type HomeClientMessage,
  type HomeServerMessage,
  type Me,
  type Message,
  type Presence,
  type SignalData,
  type Status,
  type User,
  type VoiceMember,
} from '../../../../shared/protocol'
import type { Api } from './api'
import { mergeMessages } from './guild.svelte'
import { Connection, type CloseReason, type ConnectionStatus } from './ws'

/** O que a conexão pessoal precisa do resto do app (o Client implementa). */
export interface HomeHost {
  http(): Api
  token(): string
  userId(): string
  presence(): { status: Status; text: string | null }
  toast(text: string, kind?: 'error' | 'info'): void
  ready(home: HomeState, reconnected: boolean): void
  closed(reason: CloseReason): void
  guildJoined(guild: GuildInfo): void
  guildUpdated(guild: GuildInfo): void
  guildLeft(guildId: string, reason: 'left' | 'kicked' | 'banned' | 'deleted'): void
  incoming(channelId: string, message: Message): void
  viewing(channelId: string): boolean
  callState(channelId: string): void
  callEnded(channelId: string): void
  ringing(channelId: string, from: string, video: boolean): void
  callSignal(channelId: string, from: string, data: SignalData): void
  presenceSelf(status: Status, text: string | null): void
}

export interface DmCall {
  members: VoiceMember[]
  ringing: string[]
}

type Of<T extends HomeServerMessage['t']> = Extract<HomeServerMessage, { t: T }>

let seq = 0
const nextId = () => `h${Date.now().toString(36)}${(++seq).toString(36)}`

/** A conexão pessoal: lista de servidores, amigos, conversas privadas e chamadas privadas. */
export class HomeState {
  status = $state<ConnectionStatus>('connecting')
  loaded = $state(false)
  connId = $state<string | null>(null)
  me = $state<Me | null>(null)
  guilds = $state<GuildInfo[]>([])
  friends = $state<Friend[]>([])
  blocked = $state<User[]>([])
  dms = $state<DmChannel[]>([])
  /** Status dos amigos. */
  presences = $state<Record<string, Presence>>({})

  messages = $state<Record<string, Message[]>>({})
  hasMore = $state<Record<string, boolean>>({})
  loadingHistory = $state<Record<string, boolean>>({})
  typing = $state<Record<string, Record<string, number>>>({})
  calls = $state<Record<string, DmCall>>({})

  private conn: Connection<HomeServerMessage, HomeClientMessage>
  private sends = new Map<string, { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private requests = new Map<string, (msg: HomeServerMessage) => void>()
  private typingSent: Record<string, number> = {}
  private everConnected = false

  constructor(private host: HomeHost) {
    this.conn = new Connection<HomeServerMessage, HomeClientMessage>(
      () => host.http().wsUrl(`/api/home/${encodeURIComponent(host.userId())}/ws`),
      () => ({ t: 'auth', token: host.token(), ...host.presence() }),
      {
        message: (msg) => this.handle(msg),
        status: (status) => (this.status = status),
        closed: (reason) => host.closed(reason),
      },
    )
  }

  connect() {
    this.conn.connect()
  }

  nudge() {
    this.conn.nudge()
  }

  close() {
    this.conn.close()
  }

  send(msg: HomeClientMessage): boolean {
    const ok = this.conn.send(msg)
    if (!ok) this.host.toast('Sem conexão com o servidor agora.')
    return ok
  }

  // ---------- Leitura derivada ----------

  dm(channelId: string): DmChannel | undefined {
    return this.dms.find((d) => d.id === channelId)
  }

  /** Conversas na ordem da lista: a mais recente em cima. */
  get sortedDms(): DmChannel[] {
    return [...this.dms].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
  }

  get unreadDms(): number {
    return this.dms.reduce((sum, d) => sum + (d.unread > 0 ? 1 : 0), 0)
  }

  get pendingRequests(): number {
    return this.friends.filter((f) => f.state === 'incoming').length
  }

  isFriend(userId: string): boolean {
    return this.friends.some((f) => f.user.id === userId && f.state === 'friends')
  }

  isBlocked(userId: string): boolean {
    return this.blocked.some((u) => u.id === userId)
  }

  typingIn(channelId: string, now: number): string[] {
    const entries = this.typing[channelId] ?? {}
    return Object.entries(entries)
      .filter(([userId, until]) => until > now && userId !== this.me?.id)
      .map(([userId]) => userId)
  }

  // ---------- Mensagens que chegam ----------

  private handle(msg: HomeServerMessage) {
    if ('reqId' in msg && typeof msg.reqId === 'string') {
      const waiter = this.requests.get(msg.reqId)
      if (waiter) {
        this.requests.delete(msg.reqId)
        waiter(msg)
        if (msg.t !== 'dm.channel') return
      }
    }
    switch (msg.t) {
      case 'ready': {
        const reconnected = this.everConnected
        this.everConnected = true
        this.connId = msg.connId
        this.me = msg.me
        this.guilds = msg.guilds
        this.friends = msg.friends
        this.blocked = msg.blocked
        this.dms = msg.dms
        this.presences = msg.presences
        this.messages = {}
        this.hasMore = {}
        this.loadingHistory = {}
        this.typing = {}
        this.loaded = true
        this.host.presenceSelf(msg.presence.status, msg.presence.text)
        this.host.ready(this, reconnected)
        return
      }

      case 'me.updated':
        this.me = msg.me
        return

      case 'user.updated': {
        for (const f of this.friends) if (f.user.id === msg.user.id) f.user = msg.user
        for (const d of this.dms) if (d.user.id === msg.user.id) d.user = msg.user
        return
      }

      case 'guild.joined':
        if (!this.guilds.some((g) => g.id === msg.guild.id)) this.guilds = [...this.guilds, msg.guild]
        this.host.guildJoined(msg.guild)
        return

      case 'guild.updated':
        this.guilds = this.guilds.map((g) => (g.id === msg.guild.id ? msg.guild : g))
        this.host.guildUpdated(msg.guild)
        return

      case 'guild.left':
        this.guilds = this.guilds.filter((g) => g.id !== msg.guildId)
        this.host.guildLeft(msg.guildId, msg.reason)
        return

      case 'friends':
        this.friends = msg.friends
        return

      case 'blocked':
        this.blocked = msg.blocked
        return

      case 'presence':
        if (msg.presence.status === 'offline') delete this.presences[msg.userId]
        else this.presences[msg.userId] = msg.presence
        return

      case 'presence.self':
        this.host.presenceSelf(msg.status, msg.text)
        return

      case 'dm.channel': {
        const others = this.dms.filter((d) => d.id !== msg.channel.id)
        this.dms = [...others, msg.channel]
        return
      }

      case 'dm.closed':
        this.dms = this.dms.filter((d) => d.id !== msg.channelId)
        return

      case 'dm.message': {
        const { channelId, message } = msg
        if (msg.nonce) {
          const waiting = this.sends.get(msg.nonce)
          if (waiting) {
            clearTimeout(waiting.timer)
            this.sends.delete(msg.nonce)
            waiting.resolve()
          }
        }
        if (this.messages[channelId]) this.messages[channelId] = mergeMessages(this.messages[channelId], [message])
        const typing = this.typing[channelId]
        if (typing) delete typing[message.authorId]
        const dm = this.dm(channelId)
        if (dm) {
          dm.lastMessageId = message.id
          dm.lastMessageAt = message.createdAt
          if (message.authorId === this.me?.id) {
            dm.unread = 0
            dm.lastReadId = message.id
          } else if (this.host.viewing(channelId)) {
            this.ack(channelId)
          } else {
            dm.unread += 1
          }
        }
        if (message.authorId !== this.me?.id) this.host.incoming(channelId, message)
        return
      }

      case 'dm.edited': {
        const list = this.messages[msg.channelId]
        const i = list?.findIndex((m) => m.id === msg.message.id) ?? -1
        if (list && i >= 0) list[i] = msg.message
        return
      }

      case 'dm.deleted':
        if (this.messages[msg.channelId]) this.messages[msg.channelId] = this.messages[msg.channelId].filter((m) => m.id !== msg.id)
        return

      case 'dm.reactions': {
        const found = this.messages[msg.channelId]?.find((m) => m.id === msg.id)
        if (found) found.reactions = msg.reactions
        return
      }

      case 'dm.typing':
        this.typing[msg.channelId] ??= {}
        this.typing[msg.channelId][msg.userId] = Date.now() + 8000
        return

      case 'dm.read': {
        const dm = this.dm(msg.channelId)
        if (dm) {
          dm.unread = msg.unread
          dm.lastReadId = msg.lastReadId
        }
        return
      }

      case 'call.ringing':
        this.host.ringing(msg.channelId, msg.from, msg.video)
        return

      case 'call.state':
        this.calls[msg.channelId] = { members: msg.members, ringing: msg.ringing }
        this.host.callState(msg.channelId)
        return

      case 'call.ended':
        delete this.calls[msg.channelId]
        this.host.callEnded(msg.channelId)
        return

      case 'call.signal':
        this.host.callSignal(msg.channelId, msg.from, msg.data)
        return

      case 'session.revoked':
        return

      case 'error': {
        // Erro de uma mensagem enviada: devolve pro campo de texto em vez de só avisar.
        const waiting = msg.nonce ? this.sends.get(msg.nonce) : undefined
        if (msg.nonce && waiting) {
          clearTimeout(waiting.timer)
          this.sends.delete(msg.nonce)
          return waiting.reject(new Error(msg.message))
        }
        this.host.toast(msg.message)
        return
      }
    }
  }

  // ---------- Ações ----------

  setPresence(status: Status, text: string | null, auto = false) {
    this.conn.send({ t: 'presence', status, text, auto })
  }

  /** Abre (ou cria) a conversa com alguém e devolve o id dela. */
  openDm(userId: string): Promise<string> {
    const me = this.me?.id
    if (!me || userId === me) return Promise.reject(new Error('Conversa inválida.'))
    const existing = dmChannelId(me, userId)
    if (this.dm(existing)) return Promise.resolve(existing)
    const reqId = nextId()
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'dm.open', userId, reqId })) return reject(new Error('Sem conexão.'))
      const timer = setTimeout(() => {
        this.requests.delete(reqId)
        reject(new Error('Essa pessoa não aceita mensagens suas.'))
      }, 8000)
      this.requests.set(reqId, (msg) => {
        clearTimeout(timer)
        resolve((msg as Of<'dm.channel'>).channel.id)
      })
    })
  }

  closeDm(channelId: string) {
    this.send({ t: 'dm.close', channelId })
  }

  async loadHistory(channelId: string, before?: string) {
    if (this.loadingHistory[channelId]) return
    this.loadingHistory[channelId] = true
    const reqId = nextId()
    try {
      const page = await new Promise<Of<'dm.history'>>((resolve, reject) => {
        if (!this.send({ t: 'dm.history', reqId, channelId, before })) return reject(new Error('offline'))
        const timer = setTimeout(() => {
          this.requests.delete(reqId)
          reject(new Error('sem resposta'))
        }, 10_000)
        this.requests.set(reqId, (msg) => {
          clearTimeout(timer)
          resolve(msg as Of<'dm.history'>)
        })
      })
      this.messages[channelId] = mergeMessages(this.messages[channelId] ?? [], page.messages)
      this.hasMore[channelId] = page.hasMore
    } catch {
      // tenta de novo ao abrir
    } finally {
      this.loadingHistory[channelId] = false
    }
  }

  sendMessage(channelId: string, content: string, attachmentIds: string[], replyTo: string | null = null): Promise<void> {
    const nonce = nextId()
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'dm.send', channelId, content, attachmentIds, nonce, replyTo })) return reject(new Error('Sem conexão.'))
      const timer = setTimeout(() => {
        if (this.sends.delete(nonce)) reject(new Error('O servidor não respondeu.'))
      }, 15_000)
      this.sends.set(nonce, { resolve, reject, timer })
      this.typingSent[channelId] = 0
    })
  }

  editMessage(channelId: string, id: string, content: string) {
    this.send({ t: 'dm.edit', channelId, id, content })
  }

  deleteMessage(channelId: string, id: string) {
    this.send({ t: 'dm.delete', channelId, id })
  }

  react(channelId: string, id: string, emoji: string, on: boolean) {
    this.send({ t: 'dm.react', channelId, id, emoji, on })
  }

  ack(channelId: string) {
    const dm = this.dm(channelId)
    if (!dm?.lastMessageId || (dm.unread === 0 && dm.lastReadId === dm.lastMessageId)) return
    dm.unread = 0
    dm.lastReadId = dm.lastMessageId
    this.conn.send({ t: 'dm.ack', channelId, messageId: dm.lastMessageId })
  }

  typingStart(channelId: string) {
    const now = Date.now()
    if (now - (this.typingSent[channelId] ?? 0) < 6000) return
    this.typingSent[channelId] = now
    this.conn.send({ t: 'dm.typing', channelId })
  }
}
