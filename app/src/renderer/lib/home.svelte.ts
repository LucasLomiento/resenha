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
  type PushTestResult,
  type SignalData,
  type Status,
  type User,
  type VoiceMember,
} from '../../../../shared/protocol'
import type { Api } from './api'
import { m, serverText } from './i18n.svelte'
import { freshTail, mergeMessages } from './history'
import { appInfo } from './app-info'
import { Connection, connectionKey, type CloseReason, type ConnectionStatus } from './ws'

/** O que a conexão pessoal precisa do resto do app (o Client implementa). */
export interface HomeHost {
  http(): Api
  token(): string
  userId(): string
  presence(): { status: Status; text: string | null }
  toast(text: string, kind?: 'error' | 'info'): void
  /** `resumed`: reconectou e o servidor manteve esta conexão na chamada privada. */
  ready(home: HomeState, reconnected: boolean, resumed: boolean): void
  /** Conversa da chamada privada em que o app está (vai no `auth` pra saber como ela ficou). */
  dmCallId(): string | null
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
  /** Computador: a pessoa está olhando o app agora (vai no `auth`; ver `attention` no protocolo). */
  attention(): boolean
  /** Celular: resultado do aviso de teste do push. */
  pushTested(result: PushTestResult): void
  /** Leu a conversa até ali (aqui ou em outro aparelho): o aviso dela sai da tela. */
  seen(tag: string, lastReadId: string | null): void
}

export interface DmCall {
  members: VoiceMember[]
  ringing: string[]
}

type Of<T extends HomeServerMessage['t']> = Extract<HomeServerMessage, { t: T }>

let seq = 0
const nextId = () => `h${Date.now().toString(36)}${(++seq).toString(36)}`
/** Mensagem sem confirmação desiste depois disso, mesmo com a conexão caindo e voltando. */
const SEND_GIVE_UP = 60_000

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
  /** Olhando mensagens antigas (pulou pra uma resposta): tem mais pra frente. */
  hasNewer = $state<Record<string, boolean>>({})
  loadingHistory = $state<Record<string, boolean>>({})
  typing = $state<Record<string, Record<string, number>>>({})
  calls = $state<Record<string, DmCall>>({})

  private conn: Connection<HomeServerMessage, HomeClientMessage>
  /** Mensagens esperando a confirmação do servidor (com o pedido, pra reenviar depois de uma queda). */
  private sends = new Map<
    string,
    { msg: HomeClientMessage; resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout>; until: number }
  >()
  private requests = new Map<string, (msg: HomeServerMessage) => void>()
  private typingSent: Record<string, number> = {}
  private everConnected = false
  /**
   * Conversas com mensagens de antes da última queda, e a mais nova que a tela tinha na hora: o
   * trecho recente é conferido quando abrirem. A marca é da hora da queda (não do pedido): uma
   * mensagem que chegou ao vivo depois não pode contar como "conhecida" (deixava buraco no meio).
   */
  private stale = new Map<string, string>()
  /** Igual em toda reconexão desta instância: o servidor devolve o mesmo connId e a chamada continua. */
  private key = connectionKey()

  constructor(private host: HomeHost) {
    this.conn = new Connection<HomeServerMessage, HomeClientMessage>(
      () => host.http().wsUrl(`/api/home/${encodeURIComponent(host.userId())}/ws`),
      () => ({
        t: 'auth',
        token: host.token(),
        ...host.presence(),
        key: this.key,
        call: host.dmCallId() ?? undefined,
        // Celular: o servidor manda push pra ele mesmo com o app aberto em outro lugar (só o computador com a pessoa olhando segura).
        mobile: import.meta.env.VITE_MOBILE === '1' || undefined,
        attention: host.attention() || undefined,
        ...appInfo,
      }),
      {
        message: (msg) => this.handle(msg),
        status: (status) => (this.status = status),
        closed: (reason) => host.closed(reason),
        // O limite de envio do próprio app descartou mensagens: o dono fica sabendo (Plataforma).
        limited: (detail) => this.conn.send({ t: 'incident', kind: 'send-limit', detail: `home: ${detail}` }, true),
      },
    )
  }

  connect() {
    this.conn.connect()
  }

  nudge() {
    this.conn.nudge()
  }

  /** Confere já se a conexão está viva (o app voltou pra frente, o PC acordou). */
  probe() {
    this.conn.probe()
  }

  close() {
    this.conn.close()
  }

  send(msg: HomeClientMessage): boolean {
    const ok = this.conn.send(msg)
    if (!ok) this.host.toast(m.lib.connection.offlineNow)
    return ok
  }

  /** Estado que o `auth` já leva de novo (atenção, token do push): sem aviso se a conexão está fora. */
  sendQuiet(msg: HomeClientMessage): boolean {
    return this.conn.send(msg)
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
        // Reconectou: as conversas carregadas continuam na tela (sem piscar) e o trecho mais
        // recente é conferido quando abrirem. A que sumiu da lista, ou estava em mensagens
        // antigas, recomeça do zero.
        for (const channelId of Object.keys(this.messages)) {
          if (msg.dms.some((dm) => dm.id === channelId) && !this.hasNewer[channelId]) {
            if (!this.stale.has(channelId)) this.stale.set(channelId, this.messages[channelId].at(-1)?.id ?? '')
          } else {
            delete this.messages[channelId]
            delete this.hasMore[channelId]
            delete this.hasNewer[channelId]
            this.stale.delete(channelId)
          }
        }
        this.loadingHistory = {}
        this.typing = {}
        this.loaded = true
        if (msg.calls) {
          // Servidor 1.15+: todas as chamadas das conversas, como estão agora (a que acabou some).
          this.calls = Object.fromEntries(msg.calls.map((c) => [c.channelId, { members: c.members, ringing: c.ringing }]))
        } else if (msg.call) {
          // A chamada privada em que o app estava: como ficou enquanto a conexão caiu.
          this.calls[msg.call.channelId] = { members: msg.call.members, ringing: msg.call.ringing }
        } else if (msg.call === null) {
          const asked = this.host.dmCallId()
          if (asked) delete this.calls[asked]
        }
        // O que estava esperando confirmação vai de novo, com o mesmo nonce (o servidor não duplica).
        for (const pending of this.sends.values()) this.conn.send(pending.msg)
        this.host.presenceSelf(msg.presence.status, msg.presence.text)
        this.host.ready(this, reconnected, !!msg.resumed)
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
            this.host.seen(`dm:${channelId}`, message.id)
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

      case 'dm.deleted': {
        if (this.messages[msg.channelId]) this.messages[msg.channelId] = this.messages[msg.channelId].filter((m) => m.id !== msg.id)
        // A mais nova da conversa foi apagada: a lista volta pra que sobrou (a contagem vem num dm.read).
        const dm = this.dm(msg.channelId)
        if (dm && msg.last && dm.lastMessageId === msg.id) {
          dm.lastMessageId = msg.last.id
          dm.lastMessageAt = msg.last.at
        }
        return
      }

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
        this.host.seen(`dm:${msg.channelId}`, msg.lastReadId)
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

      case 'push.test':
        this.host.pushTested(msg.result)
        return

      case 'session.revoked':
        return

      case 'error': {
        // Erro de uma mensagem enviada: devolve pro campo de texto em vez de só avisar.
        const waiting = msg.nonce ? this.sends.get(msg.nonce) : undefined
        if (msg.nonce && waiting) {
          clearTimeout(waiting.timer)
          this.sends.delete(msg.nonce)
          return waiting.reject(new Error(serverText(msg.message)))
        }
        this.host.toast(serverText(msg.message))
        return
      }
    }
  }

  // ---------- Ações ----------

  /** Devolve se saiu (fora da conexão, quem chamou guarda pra mandar quando ela voltar). */
  setPresence(status: Status, text: string | null, auto = false): boolean {
    return this.conn.send({ t: 'presence', status, text, auto })
  }

  /** Abre (ou cria) a conversa com alguém e devolve o id dela. */
  openDm(userId: string): Promise<string> {
    const me = this.me?.id
    if (!me || userId === me) return Promise.reject(new Error(m.lib.connection.invalidDm))
    const existing = dmChannelId(me, userId)
    if (this.dm(existing)) return Promise.resolve(existing)
    const reqId = nextId()
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'dm.open', userId, reqId })) return reject(new Error(m.lib.connection.offline))
      const timer = setTimeout(() => {
        this.requests.delete(reqId)
        reject(new Error(m.lib.connection.dmRefused))
      }, 8000)
      this.requests.set(reqId, (msg) => {
        clearTimeout(timer)
        // Recusado: o erro volta com o reqId (antes, esperava 8 s e mostrava outro aviso).
        if (msg.t === 'error') return reject(new Error(serverText(msg.message)))
        resolve((msg as Of<'dm.channel'>).channel.id)
      })
    })
  }

  closeDm(channelId: string) {
    this.send({ t: 'dm.close', channelId })
  }

  private history(channelId: string, opts: { before?: string; around?: string } = {}): Promise<Of<'dm.history'>> {
    const reqId = nextId()
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'dm.history', reqId, channelId, ...opts })) return reject(new Error(m.lib.connection.disconnected))
      const timer = setTimeout(() => {
        this.requests.delete(reqId)
        reject(new Error(m.lib.connection.noReply))
      }, 10_000)
      this.requests.set(reqId, (msg) => {
        clearTimeout(timer)
        if (msg.t === 'error') return reject(new Error(serverText(msg.message)))
        resolve(msg as Of<'dm.history'>)
      })
    })
  }

  async loadHistory(channelId: string, before?: string) {
    if (this.loadingHistory[channelId]) return
    this.loadingHistory[channelId] = true
    try {
      const page = await this.history(channelId, { before })
      this.messages[channelId] = mergeMessages(this.messages[channelId] ?? [], page.messages)
      this.hasMore[channelId] = page.hasMore
    } catch {
      // tenta de novo ao abrir
    } finally {
      this.loadingHistory[channelId] = false
    }
  }

  /** Conversa aberta depois de uma queda: acerta o trecho mais recente sem esvaziar a tela. */
  async refresh(channelId: string) {
    if (!this.stale.has(channelId) || this.loadingHistory[channelId]) return
    this.loadingHistory[channelId] = true
    const mark = this.stale.get(channelId) ?? ''
    try {
      const page = await this.history(channelId)
      this.stale.delete(channelId)
      const { messages, kept } = freshTail(this.messages[channelId] ?? [], page.messages, mark)
      this.messages[channelId] = messages
      if (!kept) this.hasMore[channelId] = page.hasMore
    } catch {
      // confere na próxima vez que a conversa abrir
    } finally {
      this.loadingHistory[channelId] = false
    }
  }

  /** Pula pra uma mensagem (a resposta citada): carrega em volta dela. */
  async jumpTo(channelId: string, messageId: string) {
    if (this.messages[channelId]?.some((m) => m.id === messageId)) return
    this.loadingHistory[channelId] = true
    try {
      const page = await this.history(channelId, { around: messageId })
      this.stale.delete(channelId)
      this.messages[channelId] = page.messages
      this.hasMore[channelId] = page.hasMore
      this.hasNewer[channelId] = !!page.hasNewer
    } finally {
      this.loadingHistory[channelId] = false
    }
  }

  /** Olhando mensagens antigas e chegou no fim: busca as seguintes. */
  async loadNewer(channelId: string) {
    const list = this.messages[channelId]
    if (!list?.length || !this.hasNewer[channelId] || this.loadingHistory[channelId]) return
    this.loadingHistory[channelId] = true
    try {
      const page = await this.history(channelId, { around: list[list.length - 1].id })
      this.messages[channelId] = mergeMessages(list, page.messages)
      this.hasNewer[channelId] = !!page.hasNewer
    } finally {
      this.loadingHistory[channelId] = false
    }
  }

  /** Volta pras mensagens mais recentes. */
  async jumpToPresent(channelId: string) {
    this.stale.delete(channelId)
    this.hasNewer[channelId] = false
    this.messages[channelId] = []
    this.hasMore[channelId] = true
    await this.loadHistory(channelId)
  }

  sendMessage(channelId: string, content: string, attachmentIds: string[], replyTo: string | null = null): Promise<void> {
    const nonce = nextId()
    const msg: HomeClientMessage = { t: 'dm.send', channelId, content, attachmentIds, nonce, replyTo }
    return new Promise((resolve, reject) => {
      if (!this.send(msg)) return reject(new Error(m.lib.connection.offline))
      this.sends.set(nonce, { msg, resolve, reject, timer: this.sendTimer(nonce), until: Date.now() + SEND_GIVE_UP })
      this.typingSent[channelId] = 0
    })
  }

  /**
   * Sem confirmação em 15 s: com a conexão aberta, desiste (o texto volta pro campo). Com ela
   * caída, espera voltar (e reenvia com o mesmo nonce), até um minuto.
   */
  private sendTimer(nonce: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const pending = this.sends.get(nonce)
      if (!pending) return
      if (!this.conn.isOpen && Date.now() < pending.until) {
        pending.timer = this.sendTimer(nonce)
        return
      }
      this.sends.delete(nonce)
      pending.reject(new Error(m.lib.connection.noAnswer))
    }, 15_000)
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
