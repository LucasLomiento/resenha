import { DurableObject } from 'cloudflare:workers'
import {
  HISTORY_PAGE,
  MAX_MESSAGE_LENGTH,
  MAX_UPLOAD_BYTES,
  type Attachment,
  type AuthResponse,
  type Channel,
  type ChannelKind,
  type ClientMessage,
  type Message,
  type ServerMessage,
  type StatusResponse,
  type User,
  type VoiceMember,
} from '../../shared/protocol'
import { hashPassword, hashToken, randomToken, signFileUrl, verifyPassword } from './auth'
import { FileTooLarge, SqlFileStore } from './files'

/** Estado de cada WebSocket, guardado no próprio socket pra sobreviver à hibernação. */
interface ConnState {
  userId: string
  connId: string
  session: string
  connectedAt: number
  voice: { channelId: string; muted: boolean; deafened: boolean; sharing: boolean } | null
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string }

const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error })

const INVITE_TTL = 7 * 24 * 60 * 60 * 1000
const ORPHAN_TTL = 24 * 60 * 60 * 1000
/** O app manda "ping" a cada 20 s; sem resposta por mais que isso, a conexão morreu. */
const DEAD_AFTER = 75_000
const SWEEP_EVERY = 60_000
/** Teto do espaço de anexos, com folga dentro do armazenamento do plano grátis. */
const FILES_LIMIT = 4 * 1024 ** 3

/** Cabeçalho que só o Worker põe, depois de conferir o login. */
export const USER_HEADER = 'X-Resenha-User'

interface UserRow {
  id: string
  name: string
  admin: number
  pass_hash: string
  pass_salt: string
  [key: string]: SqlStorageValue
}

interface MessageRow {
  id: string
  channel_id: string
  author_id: string
  content: string
  created_at: number
  edited_at: number | null
  [key: string]: SqlStorageValue
}

interface AttachmentRow {
  id: string
  message_id: string | null
  name: string
  size: number
  type: string
  [key: string]: SqlStorageValue
}

function cleanName(value: unknown, max = 32): string | null {
  if (typeof value !== 'string') return null
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  return name.length >= 2 && name.length <= max ? name : null
}

const toUser = (row: UserRow): User => ({ id: row.id, name: row.name, admin: row.admin === 1 })

/**
 * O grupo inteiro mora num único Durable Object: contas, canais, mensagens e
 * todos os WebSockets. Pra um grupo de amigos isso sobra, e mantém tudo
 * consistente sem precisar de banco externo.
 */
export class Space extends DurableObject<Env> {
  private sql: SqlStorage
  private files: SqlFileStore
  private lastIdTime = 0
  private loginFailures = new Map<string, { count: number; until: number }>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.files = new SqlFileStore(this.sql)
    ctx.blockConcurrencyWhile(async () => this.migrate())
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private migrate() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      pass_salt TEXT NOT NULL,
      admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      used_by TEXT,
      used_at INTEGER
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('text', 'voice')),
      position INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      edited_at INTEGER
    )`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS messages_by_channel ON messages (channel_id, id)')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      uploader_id TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      type TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS attachments_by_message ON attachments (message_id)')

    if (this.sql.exec('SELECT COUNT(*) AS n FROM channels').one().n === 0) {
      this.sql.exec("INSERT INTO channels VALUES (?, 'geral', 'text', 0)", this.nextId())
      this.sql.exec("INSERT INTO channels VALUES (?, 'Resenha', 'voice', 1)", this.nextId())
    }
  }

  /** IDs ordenáveis pelo tempo: dá pra paginar o histórico só com `id < ?`. */
  private nextId(): string {
    this.lastIdTime = Math.max(Date.now(), this.lastIdTime + 1)
    return this.lastIdTime.toString(36).padStart(10, '0') + randomToken(6)
  }

  // ---------- Contas (chamadas via RPC pelo Worker) ----------

  status(): StatusResponse {
    return { needsInvite: this.userCount() > 0 }
  }

  async register(input: { name?: unknown; password?: unknown; invite?: unknown }): Promise<Result<AuthResponse>> {
    const name = cleanName(input.name)
    if (!name) return fail(400, 'O apelido precisa ter de 2 a 32 caracteres.')
    const password = typeof input.password === 'string' ? input.password : ''
    if (password.length < 6) return fail(400, 'A senha precisa ter pelo menos 6 caracteres.')
    const invite = typeof input.invite === 'string' ? input.invite.trim() : ''

    // O hash é assíncrono e outra requisição pode entrar no meio; por isso as
    // checagens que importam vêm depois dele.
    const { hash, salt } = await hashPassword(password)

    const first = this.userCount() === 0
    if (!first) {
      const valid = this.sql
        .exec('SELECT 1 FROM invites WHERE code = ? AND used_by IS NULL AND created_at > ?', invite, Date.now() - INVITE_TTL)
        .toArray()
      if (valid.length === 0) return fail(403, 'Convite inválido, vencido ou já usado.')
    }
    if (this.sql.exec('SELECT 1 FROM users WHERE name = ?', name).toArray().length > 0) {
      return fail(409, 'Esse apelido já está em uso.')
    }

    const id = this.nextId()
    this.sql.exec(
      'INSERT INTO users (id, name, pass_hash, pass_salt, admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      name,
      hash,
      salt,
      first ? 1 : 0,
      Date.now(),
    )
    if (!first) this.sql.exec('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?', id, Date.now(), invite)

    const user: User = { id, name, admin: first }
    this.broadcast({ t: 'user.upsert', user })
    return { ok: true, value: { token: await this.createSession(id), user } }
  }

  async login(input: { name?: unknown; password?: unknown }): Promise<Result<AuthResponse>> {
    const name = cleanName(input.name)
    const password = typeof input.password === 'string' ? input.password : ''
    if (!name || !password) return fail(400, 'Preencha apelido e senha.')

    const key = name.toLowerCase()
    const failures = this.loginFailures.get(key)
    if (failures && failures.until > Date.now()) return fail(429, 'Muitas tentativas. Espere meio minuto.')

    const row = this.sql.exec<UserRow>('SELECT * FROM users WHERE name = ?', name).toArray()[0]
    if (!row || !(await verifyPassword(password, row.pass_hash, row.pass_salt))) {
      const count = (failures?.count ?? 0) + 1
      this.loginFailures.set(key, { count, until: count >= 5 ? Date.now() + 30_000 : 0 })
      return fail(401, 'Apelido ou senha errados.')
    }
    this.loginFailures.delete(key)
    return { ok: true, value: { token: await this.createSession(row.id), user: toUser(row) } }
  }

  async authenticate(token: string): Promise<User | null> {
    if (!token) return null
    const row = this.sql
      .exec<UserRow>(
        'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?',
        await hashToken(token),
      )
      .toArray()[0]
    return row ? toUser(row) : null
  }

  async logout(token: string): Promise<void> {
    const session = await hashToken(token)
    this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', session)
    for (const ws of this.ctx.getWebSockets()) {
      if (this.state(ws).session === session) ws.close(4001, 'Sessão encerrada')
    }
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomToken()
    this.sql.exec(
      'INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)',
      await hashToken(token),
      userId,
      Date.now(),
    )
    return token
  }

  private userCount(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM users').one().n
  }

  // ---------- Anexos ----------

  private async uploadFile(request: Request): Promise<Response> {
    const uploaderId = request.headers.get(USER_HEADER)
    if (!uploaderId) return Response.json({ error: 'Sessão inválida.' }, { status: 401 })
    const declared = Number(request.headers.get('Content-Length'))
    if (!declared || !request.body) return Response.json({ error: 'Faltou o tamanho do arquivo.' }, { status: 411 })
    if (declared > MAX_UPLOAD_BYTES) return Response.json({ error: 'Arquivo maior que 25 MB.' }, { status: 413 })
    const used = this.sql.exec<{ n: number }>('SELECT COALESCE(SUM(size), 0) AS n FROM attachments').one().n
    if (used + declared > FILES_LIMIT) {
      return Response.json({ error: 'O espaço de anexos do servidor está cheio.' }, { status: 507 })
    }

    let name = 'arquivo'
    try {
      name = decodeURIComponent(request.headers.get('X-File-Name') ?? '') || name
    } catch {
      // nome mal codificado, fica o padrão
    }
    name = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 200)
    const type = (request.headers.get('Content-Type') || 'application/octet-stream').slice(0, 100)
    const id = randomToken(12)

    let size: number
    try {
      size = await this.files.put(id, request.body, MAX_UPLOAD_BYTES)
    } catch (err) {
      if (err instanceof FileTooLarge) return Response.json({ error: 'Arquivo maior que 25 MB.' }, { status: 413 })
      throw err
    }
    this.sql.exec(
      'INSERT INTO attachments (id, message_id, uploader_id, name, size, type, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)',
      id,
      uploaderId,
      name,
      size,
      type,
      Date.now(),
    )
    const attachment: Attachment = { id, name, size, type, url: await signFileUrl(this.env.FILE_SECRET, id, name) }
    return Response.json(attachment)
  }

  /** Serve um anexo (a assinatura da URL já foi conferida no Worker), com suporte a Range pra vídeo. */
  private serveFile(request: Request, id: string): Response {
    const row = this.sql.exec<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', id).toArray()[0]
    if (!row) return Response.json({ error: 'Arquivo não existe mais.' }, { status: 404 })

    const headers = new Headers({
      'Content-Type': row.type,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'Cache-Control': 'private, max-age=604800, immutable',
      'Accept-Ranges': 'bytes',
      ETag: `"${row.id}"`,
      // Arquivo enviado por usuário nunca roda como página do nosso domínio.
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
    })
    if (request.headers.get('If-None-Match') === `"${row.id}"`) return new Response(null, { status: 304, headers })

    let start = 0
    let end = row.size - 1
    const range = request.headers.get('Range')?.match(/^bytes=(\d*)-(\d*)$/)
    if (range && row.size > 0) {
      if (range[1]) {
        start = Number(range[1])
        if (range[2]) end = Math.min(Number(range[2]), row.size - 1)
      } else if (range[2]) {
        start = Math.max(0, row.size - Number(range[2]))
      }
      if (start > end || start >= row.size) {
        headers.set('Content-Range', `bytes */${row.size}`)
        return new Response(null, { status: 416, headers })
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${row.size}`)
    }
    headers.set('Content-Length', String(end - start + 1))
    if (row.size === 0) return new Response(null, { headers })
    return new Response(this.files.read(row.id, start, end), { status: range ? 206 : 200, headers })
  }

  private deleteFiles(ids: string[]) {
    this.files.delete(ids)
  }

  // ---------- WebSocket ----------

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/files' && request.method === 'POST') return this.uploadFile(request)
    const file = pathname.match(/^\/api\/files\/([\w-]+)\//)
    if (file && request.method === 'GET') return this.serveFile(request, file[1])
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Esperava WebSocket', { status: 426 })

    const [client, server] = Object.values(new WebSocketPair())
    const token = new URL(request.url).searchParams.get('token') ?? ''
    const user = await this.authenticate(token)
    if (!user) {
      // Fechar com código próprio deixa o app distinguir "sessão inválida" de "sem rede".
      server.accept()
      server.close(4001, 'Sessão inválida')
      return new Response(null, { status: 101, webSocket: client })
    }

    const wasOnline = this.onlineUsers().includes(user.id)
    const state: ConnState = {
      userId: user.id,
      connId: randomToken(9),
      session: await hashToken(token),
      connectedAt: Date.now(),
      voice: null,
    }
    this.ctx.acceptWebSocket(server, [user.id])
    server.serializeAttachment(state)

    this.send(server, {
      t: 'ready',
      me: user,
      connId: state.connId,
      users: this.sql.exec<UserRow>('SELECT * FROM users ORDER BY name').toArray().map(toUser),
      channels: this.listChannels(),
      voice: this.voiceMembers(),
      online: this.onlineUsers(),
    })
    if (!wasOnline) this.broadcast({ t: 'presence', userId: user.id, online: true }, state.connId)

    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_EVERY)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') return
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const state = this.state(ws)
    const user = this.sql.exec<UserRow>('SELECT * FROM users WHERE id = ?', state.userId).toArray()[0]
    if (!user) return ws.close(4001, 'Conta não existe mais')

    try {
      await this.handle(ws, state, toUser(user), msg)
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
    this.dropConnection(this.state(ws))
  }

  async webSocketError(ws: WebSocket) {
    this.dropConnection(this.state(ws))
  }

  /** Varre conexões mortas (sem ping) e anexos que nunca foram enviados. */
  async alarm() {
    const now = Date.now()
    for (const ws of this.sockets()) {
      const state = this.state(ws)
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0
      if (Math.max(lastPing, state.connectedAt) < now - DEAD_AFTER) {
        ws.close(4000, 'Sem resposta')
        this.dropConnection(state)
      }
    }

    const orphans = this.sql
      .exec<{ id: string }>('SELECT id FROM attachments WHERE message_id IS NULL AND created_at < ?', now - ORPHAN_TTL)
      .toArray()
      .map((row) => row.id)
    if (orphans.length > 0) {
      this.sql.exec(`DELETE FROM attachments WHERE id IN (${orphans.map(() => '?').join(',')})`, ...orphans)
      this.deleteFiles(orphans)
    }

    if (this.sockets().length > 0) await this.ctx.storage.setAlarm(now + SWEEP_EVERY)
  }

  private dropConnection(state: ConnState) {
    if (state.voice) this.broadcastVoice(state.connId)
    if (!this.onlineUsers(state.connId).includes(state.userId)) {
      this.broadcast({ t: 'presence', userId: state.userId, online: false }, state.connId)
    }
  }

  private async handle(ws: WebSocket, state: ConnState, user: User, msg: ClientMessage) {
    switch (msg.t) {
      case 'chat.send': {
        const content = typeof msg.content === 'string' ? msg.content.trim() : ''
        const attachmentIds = Array.isArray(msg.attachmentIds) ? msg.attachmentIds.slice(0, 10).map(String) : []
        if (content.length > MAX_MESSAGE_LENGTH) return this.send(ws, { t: 'error', message: 'Mensagem grande demais.' })
        if (!content && attachmentIds.length === 0) return
        if (!this.channel(msg.channelId, 'text')) return this.send(ws, { t: 'error', message: 'Canal não existe.' })

        const id = this.nextId()
        this.sql.exec(
          'INSERT INTO messages (id, channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
          id,
          msg.channelId,
          user.id,
          content,
          Date.now(),
        )
        if (attachmentIds.length > 0) {
          this.sql.exec(
            `UPDATE attachments SET message_id = ?
             WHERE uploader_id = ? AND message_id IS NULL AND id IN (${attachmentIds.map(() => '?').join(',')})`,
            id,
            user.id,
            ...attachmentIds,
          )
        }
        const [message] = await this.loadMessages(this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id = ?', id).toArray())
        return this.broadcast({ t: 'chat.message', message, nonce: typeof msg.nonce === 'string' ? msg.nonce : undefined })
      }

      case 'chat.edit': {
        const row = this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id = ?', msg.id).toArray()[0]
        const content = typeof msg.content === 'string' ? msg.content.trim() : ''
        if (!row || row.author_id !== user.id || content.length > MAX_MESSAGE_LENGTH) return
        if (!content && this.sql.exec('SELECT 1 FROM attachments WHERE message_id = ?', row.id).toArray().length === 0) return
        this.sql.exec('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?', content, Date.now(), row.id)
        const [message] = await this.loadMessages(this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id = ?', row.id).toArray())
        return this.broadcast({ t: 'chat.edited', message })
      }

      case 'chat.delete': {
        const row = this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id = ?', msg.id).toArray()[0]
        if (!row || (row.author_id !== user.id && !user.admin)) return
        const files = this.sql.exec<{ id: string }>('SELECT id FROM attachments WHERE message_id = ?', row.id).toArray()
        this.sql.exec('DELETE FROM attachments WHERE message_id = ?', row.id)
        this.sql.exec('DELETE FROM messages WHERE id = ?', row.id)
        this.broadcast({ t: 'chat.deleted', id: row.id, channelId: row.channel_id })
        return this.deleteFiles(files.map((f) => f.id))
      }

      case 'chat.history': {
        if (!this.channel(msg.channelId, 'text')) return
        const before = typeof msg.before === 'string' ? msg.before : '~' // '~' fica depois de qualquer id
        const rows = this.sql
          .exec<MessageRow>(
            'SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
            msg.channelId,
            before,
            HISTORY_PAGE + 1,
          )
          .toArray()
        const hasMore = rows.length > HISTORY_PAGE
        const messages = await this.loadMessages(rows.slice(0, HISTORY_PAGE).reverse())
        return this.send(ws, { t: 'chat.history', reqId: msg.reqId, channelId: msg.channelId, messages, hasMore })
      }

      case 'typing':
        if (!this.channel(msg.channelId, 'text')) return
        return this.broadcast({ t: 'typing', channelId: msg.channelId, userId: user.id }, state.connId)

      case 'channel.create': {
        if (!user.admin) return
        const name = cleanName(msg.name)
        if (!name || (msg.kind !== 'text' && msg.kind !== 'voice')) return
        const position = this.sql.exec<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels').one().p
        const channel: Channel = { id: this.nextId(), name, kind: msg.kind, position }
        this.sql.exec('INSERT INTO channels VALUES (?, ?, ?, ?)', channel.id, channel.name, channel.kind, channel.position)
        return this.broadcast({ t: 'channel.upsert', channel })
      }

      case 'channel.rename': {
        if (!user.admin) return
        const channel = this.channel(msg.id)
        const name = cleanName(msg.name)
        if (!channel || !name) return
        this.sql.exec('UPDATE channels SET name = ? WHERE id = ?', name, channel.id)
        return this.broadcast({ t: 'channel.upsert', channel: { ...channel, name } })
      }

      case 'channel.delete': {
        if (!user.admin) return
        const channel = this.channel(msg.id)
        if (!channel) return
        const sameKind = this.sql.exec('SELECT 1 FROM channels WHERE kind = ?', channel.kind).toArray().length
        if (sameKind <= 1) return this.send(ws, { t: 'error', message: 'Precisa sobrar pelo menos um canal desse tipo.' })

        const files = this.sql
          .exec<{ id: string }>(
            'SELECT a.id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.channel_id = ?',
            channel.id,
          )
          .toArray()
        this.sql.exec(
          'DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)',
          channel.id,
        )
        this.sql.exec('DELETE FROM messages WHERE channel_id = ?', channel.id)
        this.sql.exec('DELETE FROM channels WHERE id = ?', channel.id)

        // Quem estava na call desse canal cai fora.
        for (const socket of this.sockets()) {
          const s = this.state(socket)
          if (s.voice?.channelId === channel.id) this.saveState(socket, { ...s, voice: null })
        }
        this.broadcast({ t: 'channel.removed', id: channel.id })
        this.broadcastVoice()
        return this.deleteFiles(files.map((f) => f.id))
      }

      case 'invite.create': {
        if (!user.admin) return
        const code = randomToken(6)
        this.sql.exec('INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)', code, user.id, Date.now())
        return this.send(ws, { t: 'invite.created', code })
      }

      case 'voice.join': {
        if (!this.channel(msg.channelId, 'voice')) return
        this.saveState(ws, {
          ...state,
          voice: { channelId: msg.channelId, muted: !!msg.muted, deafened: !!msg.deafened, sharing: false },
        })
        return this.broadcastVoice()
      }

      case 'voice.leave':
        if (!state.voice) return
        this.saveState(ws, { ...state, voice: null })
        return this.broadcastVoice()

      case 'voice.update':
        if (!state.voice) return
        this.saveState(ws, {
          ...state,
          voice: { ...state.voice, muted: !!msg.muted, deafened: !!msg.deafened, sharing: !!msg.sharing },
        })
        return this.broadcastVoice()

      case 'rtc.signal': {
        // Só repassa entre duas conexões que estão no mesmo canal de voz.
        if (!state.voice) return
        const target = this.sockets().find((s) => this.state(s).connId === msg.to)
        if (!target || this.state(target).voice?.channelId !== state.voice.channelId) return
        return this.send(target, { t: 'rtc.signal', from: state.connId, data: msg.data })
      }
    }
  }

  // ---------- Leitura ----------

  private channel(id: unknown, kind?: ChannelKind): Channel | null {
    if (typeof id !== 'string') return null
    const row = this.sql.exec<Channel & Record<string, SqlStorageValue>>('SELECT * FROM channels WHERE id = ?', id).toArray()[0]
    return row && (!kind || row.kind === kind) ? { id: row.id, name: row.name, kind: row.kind, position: row.position } : null
  }

  private listChannels(): Channel[] {
    return this.sql
      .exec<Channel & Record<string, SqlStorageValue>>('SELECT * FROM channels ORDER BY position, id')
      .toArray()
      .map((row) => ({ id: row.id, name: row.name, kind: row.kind, position: row.position }))
  }

  private async loadMessages(rows: MessageRow[]): Promise<Message[]> {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    const files = this.sql
      .exec<AttachmentRow>(
        `SELECT * FROM attachments WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`,
        ...ids,
      )
      .toArray()
    const byMessage = new Map<string, Attachment[]>()
    for (const f of files) {
      const list = byMessage.get(f.message_id!) ?? []
      list.push({
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        url: await signFileUrl(this.env.FILE_SECRET, f.id, f.name),
      })
      byMessage.set(f.message_id!, list)
    }
    return rows.map((r) => ({
      id: r.id,
      channelId: r.channel_id,
      authorId: r.author_id,
      content: r.content,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      attachments: byMessage.get(r.id) ?? [],
    }))
  }

  // ---------- Conexões ----------

  private state(ws: WebSocket): ConnState {
    return ws.deserializeAttachment() as ConnState
  }

  private saveState(ws: WebSocket, state: ConnState) {
    ws.serializeAttachment(state)
  }

  /** Sockets abertos, opcionalmente sem uma conexão que está saindo. */
  private sockets(exceptConnId?: string): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN && (!exceptConnId || this.state(ws).connId !== exceptConnId))
  }

  private onlineUsers(exceptConnId?: string): string[] {
    return [...new Set(this.sockets(exceptConnId).map((ws) => this.state(ws).userId))]
  }

  private voiceMembers(exceptConnId?: string): VoiceMember[] {
    const members: VoiceMember[] = []
    for (const ws of this.sockets(exceptConnId)) {
      const { connId, userId, voice } = this.state(ws)
      if (voice) members.push({ connId, userId, ...voice })
    }
    return members
  }

  private broadcastVoice(exceptConnId?: string) {
    this.broadcast({ t: 'voice.state', members: this.voiceMembers(exceptConnId) }, exceptConnId)
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // conexão caindo; o close resolve o resto
    }
  }

  private broadcast(msg: ServerMessage, exceptConnId?: string) {
    const text = JSON.stringify(msg)
    for (const ws of this.sockets(exceptConnId)) {
      try {
        ws.send(text)
      } catch {
        // idem
      }
    }
  }
}
