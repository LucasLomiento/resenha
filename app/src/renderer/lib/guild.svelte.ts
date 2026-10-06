import { basePermissions } from '../../../../shared/permissions'
import {
  P,
  has,
  type AuditEntry,
  type Ban,
  type Channel,
  type ChannelKind,
  type ClientMessage,
  type GuildInfo,
  type Invite,
  type Member,
  type Message,
  type NotifyLevel,
  type NotifySettings,
  type Overwrite,
  type Presence,
  type ReadState,
  type Role,
  type ServerMessage,
  type SignalData,
  type Status,
  type User,
  type VoiceMember,
} from '../../../../shared/protocol'
import type { Api } from './api'
import { Connection, connectionKey, type CloseReason, type ConnectionStatus } from './ws'

/** O que o servidor precisa do resto do app (o Client implementa). */
export interface GuildHost {
  http(): Api
  token(): string
  meId(): string
  /** Status atual, que já vai no `auth` (invisível não aparece online nem por um instante). */
  presence(): { status: Status; text: string | null }
  toast(text: string, kind?: 'error' | 'info'): void
  /** Mensagem nova de outra pessoa (som, notificação, contagem). */
  incoming(guild: GuildState, message: Message): void
  closed(guild: GuildState, reason: CloseReason): void
  /** `resumed`: reconectou e o servidor manteve esta conexão na call (nada mudou pros outros). */
  ready(guild: GuildState, reconnected: boolean, resumed: boolean): void
  voice(guild: GuildState): void
  voiceForced(guild: GuildState, channelId: string | null): void
  signal(guild: GuildState, from: string, data: SignalData): void
  /** A pessoa está olhando esse canal agora (janela em foco). */
  viewing(guildId: string, channelId: string): boolean
}

export interface ChannelGroup {
  category: Channel | null
  channels: Channel[]
}

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>
type WithReq = Extract<ServerMessage, { reqId: string }>

let seq = 0
const nextId = () => `${Date.now().toString(36)}${(++seq).toString(36)}`

export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
}

const kindOrder: Record<ChannelKind, number> = { text: 0, voice: 1, category: 2 }
const byPosition = (a: Channel, b: Channel) =>
  kindOrder[a.kind] - kindOrder[b.kind] || a.position - b.position || (a.id < b.id ? -1 : 1)

/** Um servidor: a conexão dele e tudo que chega por ela. */
export class GuildState {
  readonly id: string
  info = $state<GuildInfo>()!
  status = $state<ConnectionStatus>('connecting')
  /** Já recebeu o primeiro `ready`. */
  loaded = $state(false)
  connId = $state<string | null>(null)

  users = $state<Record<string, User>>({})
  members = $state<Record<string, Member>>({})
  roles = $state<Role[]>([])
  channels = $state<Channel[]>([])
  /** Canal -> minhas permissões nele (só os que eu vejo). */
  permissions = $state<Record<string, number>>({})
  presences = $state<Record<string, Presence>>({})
  voice = $state<VoiceMember[]>([])
  readStates = $state<Record<string, ReadState>>({})
  lastMessageIds = $state<Record<string, string>>({})
  notify = $state<NotifySettings>({ level: 'all', mutedUntil: null, channels: {} })

  messages = $state<Record<string, Message[]>>({})
  hasMore = $state<Record<string, boolean>>({})
  /** Estou olhando mensagens antigas (pulei pra uma): as novas não entram no fim da lista. */
  hasNewer = $state<Record<string, boolean>>({})
  loadingHistory = $state<Record<string, boolean>>({})
  /** canal -> pessoa -> até quando mostrar "digitando" */
  typing = $state<Record<string, Record<string, number>>>({})

  private conn: Connection<ServerMessage, ClientMessage>
  private sends = new Map<string, { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private requests = new Map<string, (msg: WithReq) => void>()
  private inviteWaiters = new Map<string, { resolve: (invite: Invite | null) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private typingSent: Record<string, number> = {}
  private everConnected = false
  /** Igual em toda reconexão desta instância: o servidor devolve o mesmo connId e a call continua. */
  private key = connectionKey()

  constructor(
    private host: GuildHost,
    info: GuildInfo,
  ) {
    this.id = info.id
    this.info = info
    this.conn = new Connection<ServerMessage, ClientMessage>(
      () => host.http().wsUrl(`/api/g/${encodeURIComponent(this.id)}/ws`),
      () => ({ t: 'auth', token: host.token(), ...host.presence(), key: this.key }),
      {
        message: (msg) => this.handle(msg),
        status: (status) => (this.status = status),
        closed: (reason) => host.closed(this, reason),
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
    for (const { reject, timer } of this.sends.values()) {
      clearTimeout(timer)
      reject(new Error('fechado'))
    }
    this.sends.clear()
  }

  send(msg: ClientMessage): boolean {
    const ok = this.conn.send(msg)
    if (!ok) this.host.toast('Sem conexão com o servidor agora.')
    return ok
  }

  /** Pedido com resposta (histórico, busca, listas). */
  private request<T extends WithReq['t']>(msg: ClientMessage & { reqId: string }, timeout = 10_000): Promise<Of<T>> {
    return new Promise((resolve, reject) => {
      if (!this.send(msg)) return reject(new Error('offline'))
      const timer = setTimeout(() => {
        this.requests.delete(msg.reqId)
        reject(new Error('sem resposta'))
      }, timeout)
      this.requests.set(msg.reqId, (reply) => {
        clearTimeout(timer)
        resolve(reply as Of<T>)
      })
    })
  }

  // ---------- Quem sou eu aqui ----------

  get meId(): string {
    return this.host.meId()
  }

  get me(): Member | undefined {
    return this.members[this.meId]
  }

  get isOwner(): boolean {
    return this.info.ownerId === this.meId
  }

  /** Minhas permissões no servidor (fora de canal). */
  get guildPermissions(): number {
    const me = this.members[this.meId]
    if (!me) return 0
    const roles = new Map(this.roles.map((r) => [r.id, r]))
    return basePermissions({ guildId: this.id, ownerId: this.info.ownerId, roles }, me)
  }

  canGuild(bit: number): boolean {
    return has(this.guildPermissions, bit)
  }

  can(channelId: string, bit: number): boolean {
    const perms = this.permissions[channelId]
    return perms !== undefined && has(perms, bit)
  }

  /** Pode mexer em alguma coisa de administração (mostra o menu do servidor). */
  get canManage(): boolean {
    const perms = this.guildPermissions
    return [P.MANAGE_GUILD, P.MANAGE_CHANNELS, P.MANAGE_ROLES, P.KICK_MEMBERS, P.BAN_MEMBERS, P.VIEW_AUDIT_LOG, P.MODERATE_MEMBERS].some(
      (bit) => has(perms, bit),
    )
  }

  // ---------- Leitura derivada ----------

  /** Canais em grupos: soltos primeiro, depois cada categoria com os dela. */
  get groups(): ChannelGroup[] {
    const visible = this.channels.filter((c) => c.kind === 'category' || this.permissions[c.id] !== undefined)
    const categories = visible.filter((c) => c.kind === 'category').sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
    const loose = visible.filter((c) => c.kind !== 'category' && (!c.parentId || !categories.some((cat) => cat.id === c.parentId)))
    const groups: ChannelGroup[] = loose.length ? [{ category: null, channels: loose.sort(byPosition) }] : []
    for (const category of categories) {
      const channels = visible.filter((c) => c.parentId === category.id && c.kind !== 'category').sort(byPosition)
      // Categoria sem nenhum canal visível some (a não ser pra quem pode criar canais nela).
      if (channels.length || this.canGuild(P.MANAGE_CHANNELS)) groups.push({ category, channels })
    }
    return groups
  }

  /** Canais na ordem em que aparecem na lista (pra navegar com Alt+↑/↓). */
  get orderedChannels(): Channel[] {
    return this.groups.flatMap((g) => g.channels)
  }

  get firstTextChannel(): Channel | null {
    return this.orderedChannels.find((c) => c.kind === 'text') ?? null
  }

  channel(id: string | null | undefined): Channel | null {
    return id ? (this.channels.find((c) => c.id === id) ?? null) : null
  }

  user(id: string): User | undefined {
    return this.users[id]
  }

  /** Apelido no servidor, ou o nome de exibição. */
  displayName(userId: string): string {
    return this.members[userId]?.nick || this.users[userId]?.name || 'Alguém'
  }

  /** Cor do cargo mais alto que tem cor. */
  colorOf(userId: string): number | null {
    const member = this.members[userId]
    if (!member) return null
    let best: Role | null = null
    for (const role of this.roles) {
      if (role.color !== null && member.roles.includes(role.id) && (!best || role.position > best.position)) best = role
    }
    return best?.color ?? null
  }

  rolesOf(userId: string): Role[] {
    const member = this.members[userId]
    if (!member) return []
    return this.roles.filter((r) => member.roles.includes(r.id)).sort((a, b) => b.position - a.position)
  }

  /** Lista de membros como no Discord: cargos "separados" primeiro, depois online, depois offline. */
  get memberGroups(): { title: string; ids: string[] }[] {
    const online = (id: string) => (this.presences[id]?.status ?? 'offline') !== 'offline'
    const hoisted = this.roles.filter((r) => r.hoist && r.id !== this.id).sort((a, b) => b.position - a.position)
    const placed = new Set<string>()
    const groups: { title: string; ids: string[] }[] = []
    const byName = (a: string, b: string) => this.displayName(a).localeCompare(this.displayName(b), 'pt-BR')
    for (const role of hoisted) {
      const ids = Object.values(this.members)
        .filter((m) => online(m.userId) && !placed.has(m.userId) && this.rolesOf(m.userId).find((r) => r.hoist)?.id === role.id)
        .map((m) => m.userId)
        .sort(byName)
      ids.forEach((id) => placed.add(id))
      if (ids.length) groups.push({ title: role.name, ids })
    }
    const rest = Object.keys(this.members).filter((id) => !placed.has(id))
    const on = rest.filter(online).sort(byName)
    const off = rest.filter((id) => !online(id)).sort(byName)
    if (on.length) groups.push({ title: 'Online', ids: on })
    if (off.length) groups.push({ title: 'Offline', ids: off })
    return groups
  }

  typingIn(channelId: string, now: number): string[] {
    const entries = this.typing[channelId] ?? {}
    return Object.entries(entries)
      .filter(([userId, until]) => until > now && userId !== this.meId)
      .map(([userId]) => userId)
  }

  voiceIn(channelId: string): VoiceMember[] {
    return this.voice.filter((m) => m.channelId === channelId)
  }

  // ---------- Não lidas e notificações ----------

  private mutedUntil(until: number | null): boolean {
    return until !== null && until > Date.now()
  }

  /** Nível que vale pra esse canal (o do canal, senão o do servidor). */
  levelFor(channelId: string): NotifyLevel {
    const own = this.notify.channels[channelId]
    if (own && this.mutedUntil(own.mutedUntil)) return 'none'
    if (this.mutedUntil(this.notify.mutedUntil)) return 'none'
    return own?.level ?? this.notify.level
  }

  channelMuted(channelId: string): boolean {
    return this.mutedUntil(this.notify.channels[channelId]?.mutedUntil ?? null)
  }

  get muted(): boolean {
    return this.mutedUntil(this.notify.mutedUntil)
  }

  unread(channelId: string): boolean {
    const last = this.lastMessageIds[channelId]
    if (!last) return false
    const read = this.readStates[channelId]?.lastReadId
    return !read || last > read
  }

  mentions(channelId: string): number {
    return this.readStates[channelId]?.mentions ?? 0
  }

  /** Bolinha no ícone do servidor: algum canal não silenciado com novidade. */
  get hasUnread(): boolean {
    if (this.muted) return false
    return this.channels.some((c) => c.kind === 'text' && this.permissions[c.id] !== undefined && !this.channelMuted(c.id) && this.unread(c.id))
  }

  get mentionTotal(): number {
    return this.channels.reduce((sum, c) => sum + (c.kind === 'text' ? this.mentions(c.id) : 0), 0)
  }

  /** A mensagem fala comigo? (direto, por cargo meu ou @everyone) */
  mentionsMe(message: Message): boolean {
    if (message.mentions.includes(this.meId) || message.mentionEveryone) return true
    const mine = this.members[this.meId]?.roles ?? []
    return message.mentionRoles.some((r) => mine.includes(r))
  }

  /** Marca o canal como lido até a última mensagem (na tela na hora; pro servidor, agrupado). */
  ack(channelId: string) {
    const last = this.lastMessageIds[channelId]
    if (!last || (!this.unread(channelId) && !this.mentions(channelId))) return
    this.readStates[channelId] = { channelId, lastReadId: last, mentions: 0 }
    // Canal movimentado: um aviso a cada meio segundo basta (com a última mensagem).
    this.pendingAcks[channelId] = last
    this.ackTimer ??= setTimeout(() => {
      this.ackTimer = null
      for (const [id, messageId] of Object.entries(this.pendingAcks)) this.conn.send({ t: 'chat.ack', channelId: id, messageId })
      this.pendingAcks = {}
    }, 500)
  }

  private pendingAcks: Record<string, string> = {}
  private ackTimer: ReturnType<typeof setTimeout> | null = null

  ackAll() {
    for (const c of this.channels) if (c.kind === 'text') this.ack(c.id)
  }

  setNotify(settings: NotifySettings) {
    this.notify = settings
    this.send({ t: 'notify.update', settings: $state.snapshot(settings) as NotifySettings })
  }

  // ---------- Mensagens que chegam ----------

  private handle(msg: ServerMessage) {
    if ('reqId' in msg && typeof msg.reqId === 'string') {
      const waiter = this.requests.get(msg.reqId)
      if (waiter) {
        this.requests.delete(msg.reqId)
        return waiter(msg as WithReq)
      }
    }
    switch (msg.t) {
      case 'ready': {
        const reconnected = this.everConnected
        this.everConnected = true
        this.connId = msg.connId
        if (msg.guild) this.info = msg.guild
        this.users = Object.fromEntries(msg.users.map((u) => [u.id, u]))
        this.members = Object.fromEntries((msg.members ?? []).map((m) => [m.userId, m]))
        this.roles = msg.roles ?? []
        this.channels = msg.channels
        this.permissions = msg.permissions ?? {}
        this.presences = msg.presences ?? {}
        this.voice = msg.voice
        this.readStates = Object.fromEntries((msg.readStates ?? []).map((r) => [r.channelId, r]))
        this.lastMessageIds = msg.lastMessageIds ?? {}
        if (msg.notify) this.notify = msg.notify
        // Reconectou: o que estava na tela pode ter perdido mensagens; busca de novo.
        this.messages = {}
        this.hasMore = {}
        this.hasNewer = {}
        this.loadingHistory = {}
        this.typing = {}
        this.loaded = true
        this.host.ready(this, reconnected, !!msg.resumed)
        return
      }

      case 'chat.message': {
        const { message } = msg
        const channelId = message.channelId
        if (msg.nonce) {
          const waiting = this.sends.get(msg.nonce)
          if (waiting) {
            clearTimeout(waiting.timer)
            this.sends.delete(msg.nonce)
            waiting.resolve()
          }
        }
        if (this.messages[channelId] && !this.hasNewer[channelId]) {
          this.messages[channelId] = mergeMessages(this.messages[channelId], [message])
        }
        this.lastMessageIds[channelId] = message.id
        const typing = this.typing[channelId]
        if (typing) delete typing[message.authorId]
        if (message.authorId === this.meId) {
          this.readStates[channelId] = { channelId, lastReadId: message.id, mentions: 0 }
          return
        }
        if (this.host.viewing(this.id, channelId)) {
          this.ack(channelId)
        } else if (this.mentionsMe(message)) {
          const current = this.readStates[channelId]
          this.readStates[channelId] = { channelId, lastReadId: current?.lastReadId ?? null, mentions: (current?.mentions ?? 0) + 1 }
        }
        this.host.incoming(this, message)
        return
      }

      case 'chat.edited':
        this.replace(msg.message)
        return

      case 'chat.deleted':
        if (this.messages[msg.channelId]) this.messages[msg.channelId] = this.messages[msg.channelId].filter((m) => m.id !== msg.id)
        return

      case 'chat.reactions': {
        const list = this.messages[msg.channelId]
        const found = list?.find((m) => m.id === msg.id)
        if (found) found.reactions = msg.reactions
        return
      }

      case 'read.state':
        this.readStates[msg.state.channelId] = msg.state
        return

      case 'typing':
        this.typing[msg.channelId] ??= {}
        this.typing[msg.channelId][msg.userId] = Date.now() + 8000
        return

      case 'channel.upsert': {
        const others = this.channels.filter((c) => c.id !== msg.channel.id)
        this.channels = [...others, msg.channel]
        return
      }

      case 'channel.removed':
        this.channels = this.channels.filter((c) => c.id !== msg.id)
        delete this.permissions[msg.id]
        delete this.messages[msg.id]
        return

      case 'channels.reordered':
        this.channels = msg.channels
        return

      case 'guild.updated':
        this.info = msg.guild
        return

      case 'roles':
        this.roles = msg.roles
        return

      case 'member.upsert':
        this.members[msg.member.userId] = msg.member
        this.users[msg.user.id] = msg.user
        return

      case 'member.removed':
        delete this.members[msg.userId]
        delete this.presences[msg.userId]
        return

      case 'permissions':
        this.permissions = msg.permissions
        return

      case 'user.upsert':
        this.users[msg.user.id] = msg.user
        return

      case 'presence':
        if (msg.presence && msg.presence.status !== 'offline') this.presences[msg.userId] = msg.presence
        else delete this.presences[msg.userId]
        return

      case 'voice.state':
        this.voice = msg.members
        this.host.voice(this)
        return

      case 'voice.forced':
        this.host.voiceForced(this, msg.channelId)
        return

      case 'rtc.signal':
        this.host.signal(this, msg.from, msg.data)
        return

      case 'invite.created': {
        const waiting = msg.nonce ? this.inviteWaiters.get(msg.nonce) : undefined
        if (msg.nonce && waiting) {
          clearTimeout(waiting.timer)
          this.inviteWaiters.delete(msg.nonce)
          waiting.resolve(msg.invite ?? null)
        }
        return
      }

      case 'notify.settings':
        this.notify = msg.settings
        return

      case 'error': {
        // Erro de uma mensagem enviada: devolve pro campo de texto em vez de só avisar.
        const waiting = msg.nonce ? (this.sends.get(msg.nonce) ?? this.inviteWaiters.get(msg.nonce)) : undefined
        if (msg.nonce && waiting) {
          clearTimeout(waiting.timer)
          this.sends.delete(msg.nonce)
          this.inviteWaiters.delete(msg.nonce)
          return waiting.reject(new Error(msg.message))
        }
        this.host.toast(msg.message)
        return
      }
    }
  }

  private replace(message: Message) {
    const list = this.messages[message.channelId]
    if (!list) return
    const i = list.findIndex((m) => m.id === message.id)
    if (i >= 0) list[i] = message
  }

  // ---------- Ações de mensagens ----------

  async loadHistory(channelId: string, before?: string) {
    if (this.loadingHistory[channelId] || !this.can(channelId, P.READ_HISTORY)) return
    this.loadingHistory[channelId] = true
    try {
      const page = await this.request<'chat.history'>({ t: 'chat.history', reqId: nextId(), channelId, before })
      this.messages[channelId] = mergeMessages(this.messages[channelId] ?? [], page.messages)
      this.hasMore[channelId] = page.hasMore
    } catch {
      // sem conexão: tenta de novo quando abrir o canal
    } finally {
      this.loadingHistory[channelId] = false
    }
  }

  /** Pula pra uma mensagem (busca, fixadas, resposta): carrega em volta dela. */
  async jumpTo(channelId: string, messageId: string) {
    const loaded = this.messages[channelId]?.some((m) => m.id === messageId)
    if (loaded) return
    this.loadingHistory[channelId] = true
    try {
      const page = await this.request<'chat.history'>({ t: 'chat.history', reqId: nextId(), channelId, around: messageId })
      this.messages[channelId] = page.messages
      this.hasMore[channelId] = page.hasMore
      this.hasNewer[channelId] = !!page.hasNewer
    } finally {
      this.loadingHistory[channelId] = false
    }
  }

  /** Olhando mensagens antigas e chegou no fim: busca as seguintes (ou volta pro presente). */
  async loadNewer(channelId: string) {
    const list = this.messages[channelId]
    if (!list?.length || !this.hasNewer[channelId] || this.loadingHistory[channelId]) return
    this.loadingHistory[channelId] = true
    try {
      const page = await this.request<'chat.history'>({ t: 'chat.history', reqId: nextId(), channelId, around: list[list.length - 1].id })
      this.messages[channelId] = mergeMessages(list, page.messages)
      this.hasNewer[channelId] = !!page.hasNewer
    } finally {
      this.loadingHistory[channelId] = false
    }
  }

  /** Volta pras mensagens mais recentes. */
  async jumpToPresent(channelId: string) {
    this.hasNewer[channelId] = false
    this.messages[channelId] = []
    this.hasMore[channelId] = true
    await this.loadHistory(channelId)
  }

  sendMessage(channelId: string, content: string, attachmentIds: string[], replyTo: string | null = null): Promise<void> {
    const nonce = nextId()
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'chat.send', channelId, content, attachmentIds, nonce, replyTo })) return reject(new Error('Sem conexão.'))
      const timer = setTimeout(() => {
        if (this.sends.delete(nonce)) reject(new Error('O servidor não respondeu.'))
      }, 15_000)
      this.sends.set(nonce, { resolve, reject, timer })
      this.typingSent[channelId] = 0
    })
  }

  editMessage(id: string, content: string) {
    this.send({ t: 'chat.edit', id, content })
  }

  deleteMessage(id: string) {
    this.send({ t: 'chat.delete', id })
  }

  react(id: string, emoji: string, on: boolean) {
    this.send({ t: 'chat.react', id, emoji, on })
  }

  pin(id: string, on: boolean) {
    this.send({ t: 'chat.pin', id, on })
  }

  async pins(channelId: string): Promise<Message[]> {
    return (await this.request<'chat.pins'>({ t: 'chat.pins', reqId: nextId(), channelId })).messages
  }

  async search(query: string, opts: { channelId?: string; authorId?: string; before?: string } = {}) {
    const reply = await this.request<'chat.search'>({ t: 'chat.search', reqId: nextId(), query, ...opts })
    return { messages: reply.messages, total: reply.total }
  }

  /** Avisa que estou digitando (no máximo a cada 6 s). */
  typingStart(channelId: string) {
    const now = Date.now()
    if (now - (this.typingSent[channelId] ?? 0) < 6000) return
    this.typingSent[channelId] = now
    this.conn.send({ t: 'typing', channelId })
  }

  // ---------- Administração ----------

  /** Gera um convite; dá erro na hora se o servidor recusar (sem permissão, convites demais). */
  createInvite(options: { maxAge?: number | null; maxUses?: number | null } = {}): Promise<Invite | null> {
    const nonce = nextId()
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'invite.create', ...options, nonce })) return reject(new Error('Sem conexão.'))
      const timer = setTimeout(() => {
        if (this.inviteWaiters.delete(nonce)) reject(new Error('O servidor não respondeu.'))
      }, 10_000)
      this.inviteWaiters.set(nonce, { resolve, reject, timer })
    })
  }

  async invites(): Promise<Invite[]> {
    return (await this.request<'invites.list'>({ t: 'invites.list', reqId: nextId() })).invites
  }

  deleteInvite(code: string) {
    this.send({ t: 'invite.delete', code })
  }

  async bans(): Promise<Ban[]> {
    return (await this.request<'bans.list'>({ t: 'bans.list', reqId: nextId() })).bans
  }

  async audit(before?: string): Promise<{ entries: AuditEntry[]; hasMore: boolean }> {
    const reply = await this.request<'audit.list'>({ t: 'audit.list', reqId: nextId(), before })
    return { entries: reply.entries, hasMore: reply.hasMore }
  }

  createChannel(name: string, kind: ChannelKind, parentId: string | null = null, overwrites?: Overwrite[]) {
    this.send({ t: 'channel.create', name, kind, parentId, ...(overwrites ? { overwrites } : {}) })
  }

  updateChannel(id: string, patch: Omit<Extract<ClientMessage, { t: 'channel.update' }>, 't' | 'id'>) {
    this.send({ t: 'channel.update', id, ...patch })
  }

  reorderChannels(order: { id: string; position: number; parentId: string | null }[]) {
    this.send({ t: 'channel.reorder', order })
  }

  deleteChannel(id: string) {
    this.send({ t: 'channel.delete', id })
  }

  updateGuild(patch: { name?: string; icon?: string | null }) {
    this.send({ t: 'guild.update', ...patch })
  }

  transfer(userId: string) {
    this.send({ t: 'guild.transfer', userId })
  }

  createRole(name: string) {
    this.send({ t: 'role.create', name })
  }

  updateRole(id: string, patch: Omit<Extract<ClientMessage, { t: 'role.update' }>, 't' | 'id'>) {
    this.send({ t: 'role.update', id, ...patch })
  }

  reorderRoles(order: string[]) {
    this.send({ t: 'role.reorder', order })
  }

  deleteRole(id: string) {
    this.send({ t: 'role.delete', id })
  }

  setRoles(userId: string, roles: string[]) {
    this.send({ t: 'member.roles', userId, roles })
  }

  setNick(userId: string, nick: string | null) {
    this.send({ t: 'member.nick', userId, nick })
  }

  kick(userId: string, reason = '') {
    this.send({ t: 'member.kick', userId, reason })
  }

  ban(userId: string, reason = '', deleteMessages = false) {
    this.send({ t: 'member.ban', userId, reason, deleteMessages })
  }

  unban(userId: string) {
    this.send({ t: 'member.unban', userId })
  }

  timeout(userId: string, minutes: number, reason = '') {
    this.send({ t: 'member.timeout', userId, minutes, reason })
  }

  moderateVoice(userId: string, patch: { serverMuted?: boolean; serverDeafened?: boolean; disconnect?: boolean; moveTo?: string }) {
    this.send({ t: 'member.voice', userId, ...patch })
  }

  setPresence(status: Status, text: string | null, auto = false) {
    this.conn.send({ t: 'presence', status, text, auto })
  }
}
