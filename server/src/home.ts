import { DurableObject } from 'cloudflare:workers'
import {
  dmChannelId,
  dmMembers,
  type DmChannel,
  type Friend,
  type GuildInfo,
  type HomeClientMessage,
  type HomeServerMessage,
  type Me,
  type Presence,
  type Status,
  type User,
} from '../../shared/protocol'
import { aggregate, samePresence } from './presence'
import { conversation, directory, home } from './stubs'
import { cleanLine } from './validate'

// A conexão pessoal de cada pessoa (um Home por conta): lista de servidores,
// amigos, bloqueios, conversas privadas, status e chamadas privadas. Cada
// aparelho abre um WebSocket aqui, além de um por servidor.

interface HomeConn {
  userId: string
  connId: string
  session: string
  connectedAt: number
  pending?: boolean
  status?: Status
  text?: string | null
  /** Conversa privada em cuja chamada esta conexão está. */
  call?: string | null
}

interface DmRow {
  channel_id: string
  peer_id: string
  last_message_id: string | null
  last_message_at: number | null
  last_read_id: string | null
  unread: number
  open: number
  [key: string]: SqlStorageValue
}

const AUTH_TIMEOUT = 15_000
const DEAD_AFTER = 75_000
const SWEEP_EVERY = 60_000
const MAX_FRAME = 64 * 1024
/** Conexões abertas que ainda não se autenticaram (o resto espera). */
const MAX_PENDING = 20
const STATUSES: Status[] = ['online', 'idle', 'dnd', 'invisible']

/** Cabeçalho que o Worker põe com o id do dono deste Home. */
export const HOME_HEADER = 'X-Resenha-Home'

export class Home extends DurableObject<Env> {
  private sql: SqlStorage
  private userId = ''
  private flood = new Map<string, number[]>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      this.sql.exec(`CREATE TABLE IF NOT EXISTS dms (
        channel_id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        last_message_id TEXT,
        last_message_at INTEGER,
        last_read_id TEXT,
        unread INTEGER NOT NULL DEFAULT 0,
        open INTEGER NOT NULL DEFAULT 1
      )`)
      this.userId = this.meta('user_id') ?? ''
    })
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private meta(key: string): string | null {
    return this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value ?? null
  }

  private setMeta(key: string, value: string | null) {
    if (value === null) this.sql.exec('DELETE FROM meta WHERE key = ?', key)
    else this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value)
  }

  /** No máximo `max` ações na janela (na memória: zera se hibernar, e tudo bem). */
  private allow(key: string, max: number, window: number): boolean {
    const now = Date.now()
    const recent = (this.flood.get(key) ?? []).filter((t) => now - t < window)
    if (recent.length >= max) return false
    recent.push(now)
    this.flood.set(key, recent)
    if (this.flood.size > 5000) this.flood.clear()
    return true
  }

  private dmRow(channelId: unknown): DmRow | undefined {
    if (typeof channelId !== 'string') return undefined
    return this.sql.exec<DmRow>('SELECT * FROM dms WHERE channel_id = ?', channelId).toArray()[0]
  }

  /** Grava de quem é este Home na primeira vez (o nome do DO é o id da pessoa). */
  private own(userId: string): boolean {
    if (!this.userId) {
      this.userId = userId
      this.setMeta('user_id', userId)
    }
    return this.userId === userId
  }

  // ---------- Conexões ----------

  private state(ws: WebSocket): HomeConn {
    return ws.deserializeAttachment() as HomeConn
  }

  private save(ws: WebSocket, state: HomeConn) {
    ws.serializeAttachment(state)
  }

  private sockets(exceptConnId?: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      if (ws.readyState !== WebSocket.OPEN) return false
      const state = this.state(ws)
      return !state.pending && (!exceptConnId || state.connId !== exceptConnId)
    })
  }

  private send(ws: WebSocket, msg: HomeServerMessage) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // conexão caindo
    }
  }

  private broadcast(msg: HomeServerMessage, opts: { except?: string; connId?: string } = {}) {
    const text = JSON.stringify(msg)
    for (const ws of this.sockets(opts.except)) {
      if (opts.connId && this.state(ws).connId !== opts.connId) continue
      try {
        ws.send(text)
      } catch {
        // idem
      }
    }
  }

  // ---------- Presença ----------

  private manual(): { status: Status; text: string | null } {
    const status = this.meta('status') as Status | null
    return { status: status && STATUSES.includes(status) ? status : 'online', text: this.meta('text') }
  }

  /** O que os amigos veem: invisível aparece offline; vários aparelhos, vale o "mais online". */
  presence(exceptConnId?: string): Presence {
    return aggregate(this.sockets(exceptConnId).map((ws) => this.state(ws)))
  }

  private friendIds(): string[] {
    try {
      return JSON.parse(this.meta('friends') ?? '[]') as string[]
    } catch {
      return []
    }
  }

  private async announce(before: Presence, exceptConnId?: string) {
    const after = this.presence(exceptConnId)
    if (samePresence(before, after)) return
    await Promise.allSettled(this.friendIds().map((id) => home(this.env, id).friendPresence(this.userId, after)))
  }

  /** Um amigo mudou de status. */
  friendPresence(userId: string, presence: Presence) {
    if (this.friendIds().includes(userId)) this.broadcast({ t: 'presence', userId, presence })
  }

  // ---------- HTTP e WebSocket ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Esperava WebSocket', { status: 426 })
    const owner = request.headers.get(HOME_HEADER)
    if (!owner || !this.own(owner)) return new Response('Conta errada', { status: 403 })
    if (this.ctx.getWebSockets().filter((ws) => this.state(ws).pending).length >= MAX_PENDING) {
      return new Response('Ocupado, tente de novo', { status: 503 })
    }
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    const pending: HomeConn = {
      userId: '',
      connId: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      session: '',
      connectedAt: Date.now(),
      pending: true,
    }
    server.serializeAttachment(pending)
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_EVERY)
    return new Response(null, { status: 101, webSocket: client })
  }

  private dmRows(): DmRow[] {
    return this.sql.exec<DmRow>('SELECT * FROM dms WHERE open = 1 ORDER BY COALESCE(last_message_at, 0) DESC').toArray()
  }

  private toDm(row: DmRow, user: User): DmChannel {
    return {
      id: row.channel_id,
      user,
      lastMessageId: row.last_message_id,
      lastMessageAt: row.last_message_at,
      unread: row.unread,
      lastReadId: row.last_read_id,
    }
  }

  private async completeAuth(ws: WebSocket, pending: HomeConn, msg: Extract<HomeClientMessage, { t: 'auth' }>) {
    const auth = typeof msg.token === 'string' ? await directory(this.env).authenticate(msg.token) : null
    if (ws.readyState !== WebSocket.OPEN) return
    if (!auth || auth.me.id !== this.userId) return ws.close(4001, 'Sessão inválida')

    const manual = this.manual()
    const before = this.presence()
    const state: HomeConn = {
      ...pending,
      userId: auth.me.id,
      session: auth.tokenHash,
      pending: false,
      status: STATUSES.includes(msg.status as Status) ? (msg.status as Status) : manual.status,
      text: msg.text === undefined ? manual.text : cleanLine(msg.text, 1, 128),
    }
    this.save(ws, state)

    const rows = this.dmRows()
    const snapshot = await directory(this.env).homeSnapshot(this.userId, rows.map((r) => r.peer_id))
    const friendIds = snapshot.friends.filter((f) => f.state === 'friends').map((f) => f.user.id)
    this.setMeta('friends', JSON.stringify(friendIds))
    const peers = new Map(snapshot.peers.map((u) => [u.id, u]))
    const presences: Record<string, Presence> = {}
    await Promise.allSettled(
      friendIds.map(async (id) => {
        const p = await home(this.env, id).presence()
        if (p.status !== 'offline') presences[id] = p
      }),
    )
    if (ws.readyState !== WebSocket.OPEN) return
    this.send(ws, {
      t: 'ready',
      me: snapshot.me,
      connId: state.connId,
      guilds: snapshot.guilds,
      friends: snapshot.friends,
      blocked: snapshot.blocked,
      dms: rows.flatMap((r) => {
        const user = peers.get(r.peer_id)
        return user ? [this.toDm(r, user)] : []
      }),
      presence: manual,
      presences,
    })
    await this.announce(before)
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME) return
    let msg: HomeClientMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    const state = this.state(ws)
    if (state.pending) {
      if (msg.t !== 'auth') return ws.close(4001, 'Faltou autenticar')
      return this.completeAuth(ws, state, msg)
    }
    // Limite por conexão: sinalização da chamada tem folga maior (muitos candidatos ICE de uma vez).
    const signal = msg.t === 'call.signal'
    if (!this.allow(`${signal ? 'sig' : 'ws'}:${state.connId}`, signal ? 400 : 120, 10_000)) {
      if (this.allow(`warn:${state.connId}`, 1, 10_000)) this.send(ws, { t: 'error', message: 'Calma! Muitas ações de uma vez.' })
      return
    }
    try {
      await this.handle(ws, state, msg)
    } catch (err) {
      console.error('erro tratando', msg.t, err)
      this.send(ws, { t: 'error', message: 'Erro no servidor.' })
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code === 1005 ? 1000 : code, reason)
    } catch {
      // já fechado
    }
    await this.dropConnection(this.state(ws))
  }

  async webSocketError(ws: WebSocket) {
    await this.dropConnection(this.state(ws))
  }

  private async dropConnection(state: HomeConn) {
    if (state.pending || !state.userId) return
    // O socket que caiu já não está aberto: o "antes" inclui ele à mão.
    const before = aggregate([...this.sockets(state.connId).map((ws) => this.state(ws)), state])
    if (state.call) await conversation(this.env, state.call).callHangup(state.call, this.userId, state.connId)
    await this.announce(before, state.connId)
  }

  async alarm() {
    const now = Date.now()
    for (const ws of this.ctx.getWebSockets()) {
      const state = this.state(ws)
      if (state.pending && state.connectedAt < now - AUTH_TIMEOUT) ws.close(4001, 'Faltou autenticar')
    }
    for (const ws of this.sockets()) {
      const state = this.state(ws)
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0
      if (Math.max(lastPing, state.connectedAt) < now - DEAD_AFTER) {
        ws.close(4000, 'Sem resposta')
        await this.dropConnection(state)
      }
    }
    if (this.ctx.getWebSockets().length > 0) await this.ctx.storage.setAlarm(now + SWEEP_EVERY)
  }

  // ---------- Mensagens do app ----------

  /** Conversa privada que existe pra esta pessoa (aberta por ela ou com mensagem recebida). */
  private known(channelId: unknown): channelId is string {
    if (typeof channelId !== 'string') return false
    const pair = dmMembers(channelId)
    return !!pair && pair.includes(this.userId) && !!this.dmRow(channelId)
  }

  private async handle(ws: WebSocket, state: HomeConn, msg: HomeClientMessage) {
    const me = this.userId
    const error = (message: string) => this.send(ws, { t: 'error', message })
    const result = (r: { ok: true } | { ok: false; error: string }) => {
      if (!r.ok) error(r.error)
    }

    switch (msg.t) {
      case 'presence': {
        if (!STATUSES.includes(msg.status) || !this.allow(`presence:${state.connId}`, 10, 60_000)) return
        const text = cleanLine(msg.text, 1, 128)
        const before = this.presence()
        this.save(ws, { ...state, status: msg.status, text })
        if (!msg.auto) {
          // Escolha da pessoa (não o "ausente" automático): vale pra todos os aparelhos.
          this.setMeta('status', msg.status)
          this.setMeta('text', text)
          this.broadcast({ t: 'presence.self', status: msg.status, text }, { except: state.connId })
        }
        return this.announce(before)
      }

      case 'dm.open': {
        const peerId = typeof msg.userId === 'string' ? msg.userId : ''
        if (!peerId || peerId === me) return
        const channelId = dmChannelId(me, peerId)
        const existing = this.sql.exec<DmRow>('SELECT * FROM dms WHERE channel_id = ?', channelId).toArray()[0]
        const peer = await directory(this.env).getUser(peerId)
        if (!peer || peer.deleted) return error('Pessoa não encontrada.')
        if (!existing && !(await directory(this.env).canDm(me, peerId))) {
          return error('Essa pessoa só recebe mensagem de amigos.')
        }
        const opened = await conversation(this.env, channelId).open(channelId, me)
        if (!opened.ok) return error(opened.error)
        this.sql.exec(
          `INSERT INTO dms (channel_id, peer_id, last_message_id, last_message_at, open) VALUES (?, ?, ?, ?, 1)
           ON CONFLICT (channel_id) DO UPDATE SET open = 1`,
          channelId,
          peerId,
          opened.value.lastMessageId,
          opened.value.lastMessageAt,
        )
        const row = this.sql.exec<DmRow>('SELECT * FROM dms WHERE channel_id = ?', channelId).one()
        this.send(ws, { t: 'dm.channel', channel: this.toDm(row, peer), reqId: String(msg.reqId) })
        return this.broadcast({ t: 'dm.channel', channel: this.toDm(row, peer) }, { except: state.connId })
      }

      case 'dm.send': {
        if (!this.known(msg.channelId)) return
        const nonce = typeof msg.nonce === 'string' ? msg.nonce.slice(0, 64) : undefined
        const sent = await conversation(this.env, msg.channelId).send(msg.channelId, me, msg)
        // Erro de envio volta com o nonce: o app devolve o texto pro campo.
        if (!sent.ok) this.send(ws, { t: 'error', message: sent.error, ...(nonce ? { nonce } : {}) })
        return
      }

      case 'dm.edit':
        if (!this.known(msg.channelId)) return
        return result(await conversation(this.env, msg.channelId).edit(msg.channelId, me, msg.id, msg.content))

      case 'dm.delete':
        if (!this.known(msg.channelId)) return
        return result(await conversation(this.env, msg.channelId).remove(msg.channelId, me, msg.id))

      case 'dm.history': {
        if (!this.known(msg.channelId)) return
        const page = await conversation(this.env, msg.channelId).history(msg.channelId, me, { before: msg.before })
        if (!page.ok) return error(page.error)
        return this.send(ws, { t: 'dm.history', reqId: String(msg.reqId), channelId: msg.channelId, messages: page.value.messages, hasMore: page.value.hasMore })
      }

      case 'dm.react':
        if (!this.known(msg.channelId)) return
        return result(await conversation(this.env, msg.channelId).react(msg.channelId, me, msg.id, msg.emoji, !!msg.on))

      case 'dm.typing':
        if (!this.known(msg.channelId)) return
        return conversation(this.env, msg.channelId).typing(msg.channelId, me)

      case 'dm.ack': {
        const row = typeof msg.channelId === 'string'
          ? this.sql.exec<DmRow>('SELECT * FROM dms WHERE channel_id = ?', msg.channelId).toArray()[0]
          : undefined
        if (!row || typeof msg.messageId !== 'string') return
        const lastReadId = row.last_read_id && row.last_read_id > msg.messageId ? row.last_read_id : msg.messageId.slice(0, 64)
        const unread =
          row.last_message_id && lastReadId >= row.last_message_id
            ? 0
            : await conversation(this.env, row.channel_id).unreadAfter(row.channel_id, me, lastReadId)
        this.sql.exec('UPDATE dms SET last_read_id = ?, unread = ? WHERE channel_id = ?', lastReadId, unread, row.channel_id)
        return this.broadcast({ t: 'dm.read', channelId: row.channel_id, lastReadId, unread })
      }

      case 'dm.close': {
        if (typeof msg.channelId !== 'string') return
        this.sql.exec('UPDATE dms SET open = 0 WHERE channel_id = ?', msg.channelId)
        return this.broadcast({ t: 'dm.closed', channelId: msg.channelId })
      }

      case 'call.ring':
      case 'call.answer': {
        if (!this.known(msg.channelId)) return
        const joining = msg.t === 'call.ring' || msg.accept
        if (joining) {
          await this.leaveOtherCall(ws, state, msg.channelId)
          // Marca antes de esperar: se a conexão cair no meio, a queda já sabe que estava na chamada.
          this.save(ws, { ...this.state(ws), call: msg.channelId })
        }
        const room = conversation(this.env, msg.channelId)
        const r =
          msg.t === 'call.ring'
            ? await room.callRing(msg.channelId, me, state.connId, !!msg.video)
            : await room.callAnswer(msg.channelId, me, state.connId, !!msg.accept)
        if (!r.ok) {
          if (joining && ws.readyState === WebSocket.OPEN) this.save(ws, { ...this.state(ws), call: null })
          return error(r.error)
        }
        // Caiu enquanto entrava: sai de novo.
        if (joining && ws.readyState !== WebSocket.OPEN) await room.callHangup(msg.channelId, me, state.connId)
        return
      }

      case 'call.hangup': {
        if (!this.known(msg.channelId)) return
        await conversation(this.env, msg.channelId).callHangup(msg.channelId, me, state.connId)
        if (state.call === msg.channelId) this.save(ws, { ...this.state(ws), call: null })
        return
      }

      case 'call.update':
        if (!this.known(msg.channelId) || state.call !== msg.channelId) return
        return conversation(this.env, msg.channelId).callUpdate(msg.channelId, me, state.connId, msg)

      case 'call.signal':
        if (!this.known(msg.channelId) || state.call !== msg.channelId || !msg.data || typeof msg.to !== 'string') return
        return conversation(this.env, msg.channelId).callSignal(msg.channelId, me, state.connId, msg.to, msg.data)
    }
  }

  /** Uma chamada privada por conexão: entrar em outra sai da anterior. */
  private async leaveOtherCall(ws: WebSocket, state: HomeConn, channelId: string) {
    if (state.call && state.call !== channelId) {
      await conversation(this.env, state.call).callHangup(state.call, this.userId, state.connId)
      this.save(ws, { ...this.state(ws), call: null })
    }
  }

  // ---------- Chamadas dos outros DOs (RPC) ----------

  /** Evento de uma conversa privada (vem do Conversation). */
  async dmEvent(channelId: string, peerId: string, event: HomeServerMessage) {
    // Ligação chegando numa conversa que a pessoa nunca abriu: a conversa aparece na lista.
    if (event.t === 'call.ringing' && !this.dmRow(channelId)) {
      this.sql.exec('INSERT INTO dms (channel_id, peer_id, open) VALUES (?, ?, 1) ON CONFLICT DO NOTHING', channelId, peerId)
      const peer = await directory(this.env).getUser(peerId)
      const row = this.dmRow(channelId)
      if (peer && row) this.broadcast({ t: 'dm.channel', channel: this.toDm(row, peer) })
    }
    if (event.t === 'dm.message') {
      const mine = event.message.authorId === this.userId
      const existing = this.sql.exec<DmRow>('SELECT * FROM dms WHERE channel_id = ?', channelId).toArray()[0]
      this.sql.exec(
        `INSERT INTO dms (channel_id, peer_id, last_message_id, last_message_at, last_read_id, unread, open)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (channel_id) DO UPDATE SET last_message_id = excluded.last_message_id,
         last_message_at = excluded.last_message_at, open = 1,
         last_read_id = CASE WHEN ? THEN excluded.last_read_id ELSE dms.last_read_id END,
         unread = CASE WHEN ? THEN 0 ELSE dms.unread + 1 END`,
        channelId,
        peerId,
        event.message.id,
        event.message.createdAt,
        mine ? event.message.id : null,
        mine ? 0 : 1,
        mine ? 1 : 0,
        mine ? 1 : 0,
      )
      // Conversa nova (ou escondida) aparece de volta na lista antes da mensagem.
      if (!existing || existing.open === 0) {
        const peer = await directory(this.env).getUser(peerId)
        const row = this.sql.exec<DmRow>('SELECT * FROM dms WHERE channel_id = ?', channelId).one()
        if (peer) this.broadcast({ t: 'dm.channel', channel: this.toDm(row, peer) })
      }
    }
    this.broadcast(event)
  }

  /** Quem esta pessoa bloqueou/desbloqueou: a conversa entre os dois (se existir) fica sabendo. */
  async dmBlocked(otherId: string) {
    const row = this.sql.exec<DmRow>('SELECT * FROM dms WHERE peer_id = ?', otherId).toArray()[0]
    if (row) await conversation(this.env, row.channel_id).blocked()
  }

  /** Evento de chamada privada; com `connId`, só pra aquela conexão. */
  callEvent(event: HomeServerMessage, connId?: string) {
    this.broadcast(event, connId ? { connId } : {})
  }

  async closeSessions(tokenHashes: string[]) {
    const set = new Set(tokenHashes)
    for (const ws of this.ctx.getWebSockets()) {
      const state = this.state(ws)
      if (state.pending || !set.has(state.session)) continue
      this.send(ws, { t: 'session.revoked' })
      ws.close(4001, 'Sessão encerrada')
      await this.dropConnection(state)
    }
  }

  meUpdated(me: Me) {
    this.broadcast({ t: 'me.updated', me })
  }

  userUpdated(user: User) {
    this.broadcast({ t: 'user.updated', user })
  }

  guildJoined(guild: GuildInfo) {
    this.broadcast({ t: 'guild.joined', guild })
  }

  guildUpdated(guild: GuildInfo) {
    this.broadcast({ t: 'guild.updated', guild })
  }

  guildLeft(guildId: string, reason: 'left' | 'kicked' | 'banned' | 'deleted') {
    this.broadcast({ t: 'guild.left', guildId, reason })
  }

  async friendsChanged(friends: Friend[], blocked: User[]) {
    const old = new Set(this.friendIds())
    const now = friends.filter((f) => f.state === 'friends').map((f) => f.user.id)
    this.setMeta('friends', JSON.stringify(now))
    this.broadcast({ t: 'friends', friends })
    this.broadcast({ t: 'blocked', blocked })
    // Amigo novo: troca os status na hora.
    const added = now.filter((id) => !old.has(id))
    if (added.length === 0) return
    const mine = this.presence()
    await Promise.allSettled(
      added.map(async (id) => {
        const theirs = await home(this.env, id).presence()
        if (theirs.status !== 'offline') this.broadcast({ t: 'presence', userId: id, presence: theirs })
        if (mine.status !== 'offline') await home(this.env, id).friendPresence(this.userId, mine)
      }),
    )
  }

  /** Conta excluída. */
  async wipe() {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: 'session.revoked' })
      ws.close(4001, 'Conta excluída')
    }
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.userId = ''
  }

  /** Migração da 0.5: conversa privada que já existia. */
  registerDm(channelId: string, peerId: string, lastMessageId: string | null, lastMessageAt: number | null) {
    this.sql.exec(
      `INSERT INTO dms (channel_id, peer_id, last_message_id, last_message_at, last_read_id, unread, open)
       VALUES (?, ?, ?, ?, ?, 0, 1) ON CONFLICT (channel_id) DO NOTHING`,
      channelId,
      peerId,
      lastMessageId,
      lastMessageAt,
      lastMessageId,
    )
  }
}
