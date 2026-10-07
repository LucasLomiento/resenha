import { DurableObject } from 'cloudflare:workers'
import {
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  MAX_MAP_PINS,
  MAX_MAP_PIN_LABEL,
  MAX_MESSAGE_LENGTH,
  MAX_PINS_PER_CHANNEL,
  P,
  dmMembers,
  has,
  type AuditAction,
  type AuditEntry,
  type Ban,
  type Channel,
  type ChannelKind,
  type ClientMessage,
  type GuildInfo,
  type MapPin,
  type MapView,
  type MapViewer,
  type StreetSpot,
  type Member,
  type NotifyLevel,
  type NotifySettings,
  type Overwrite,
  type Presence,
  type ReadState,
  type Role,
  type ServerMessage,
  type Status,
  type User,
  type VoiceMember,
} from '../../shared/protocol'
import type { LegacyExport } from './directory'
import { newId } from './ids'
import { cleanPoint, cleanStreet, cleanView, parseView } from './map'
import { CONN_KEY, GHOST_QUEUE, connIdFor, graceFor, unexpectedClose } from './resume'
import {
  IN_LIST,
  MessageStore,
  columns,
  list,
  parseJsonList,
  validEmoji,
  type AttachmentRow,
  type MessageRow,
  type UploadTicket,
} from './messages'
import {
  basePermissions,
  channelPermissions,
  outranks,
  sameOverwrites,
  sanitizeOverwrites,
  topPosition,
  type MemberLike,
} from '../../shared/permissions'
import { aggregate, samePresence } from './presence'
import { directory } from './stubs'
import { parseStyle, styleText } from './style'
import { unfurlAll } from './unfurl'
import { cleanLine, cleanText, color } from './validate'

// Um servidor (como os do Discord): canais, cargos, membros, mensagens,
// anexos, moderação, quem está em cada canal de voz e o repasse da sinalização
// WebRTC. Cada servidor é um Durable Object com o próprio SQLite.

interface VoiceState {
  channelId: string
  muted: boolean
  deafened: boolean
  sharing: boolean
  camera: boolean
}

/** Estado de cada WebSocket, guardado no próprio socket pra sobreviver à hibernação. */
interface ConnState {
  userId: string
  connId: string
  /** Hash do token da sessão (pra derrubar a conexão quando a sessão sai). */
  session: string
  connectedAt: number
  voice: VoiceState | null
  /** Conectou mas ainda não mandou o `auth`: não recebe nada nem conta como online. */
  pending?: boolean
  /** App 0.5 (rota /ws): só recebe o que ele entende. */
  legacy?: boolean
  status?: Status
  text?: string | null
  /** Mandou chave no `auth`: se cair, dá pra voltar na call (ver resume.ts). */
  resumable?: boolean
  /** Outra conexão com a mesma chave tomou o lugar desta: ao fechar, não mexe em nada. */
  replaced?: boolean
  /** Desde quando está com o mapa aberto (ms). */
  map?: number
  /** No Street View, olhando esse lugar. */
  street?: StreetSpot
}

/** Conexão que caiu sem avisar, esperando o app voltar. */
interface Ghost {
  state: ConnState
  timer: ReturnType<typeof setTimeout>
  /** O que chegou pra ela enquanto isso (sinalização da call, avisos), entregue na volta. */
  queue: string[]
}

interface ChannelRow {
  id: string
  name: string
  kind: string
  position: number
  parent_id: string | null
  topic: string
  overwrites: string
  user_limit: number
  slowmode: number
  [key: string]: SqlStorageValue
}

interface MemberRow {
  user_id: string
  nick: string | null
  roles: string
  joined_at: number
  timeout_until: number | null
  server_muted: number
  server_deafened: number
  [key: string]: SqlStorageValue
}

interface RoleRow {
  id: string
  name: string
  color: number | null
  position: number
  permissions: number
  hoist: number
  mentionable: number
  [key: string]: SqlStorageValue
}

interface ProfileRow {
  user_id: string
  username: string
  name: string
  avatar: string | null
  bio: string
  accent: number | null
  deleted: number
  /** Personalização do perfil (JSON, ver style.ts). */
  style: string | null
  [key: string]: SqlStorageValue
}

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** Quem não se autentica nesse tempo é desconectado. */
const AUTH_TIMEOUT = 15_000
/** O app manda "ping" a cada 20 s; sem resposta por mais que isso, a conexão morreu. */
const DEAD_AFTER = 75_000
const SWEEP_EVERY = 60_000
const ORPHAN_TTL = DAY
/** Teto de anexos por servidor (a plataforma inteira tem outro teto, no Directory). */
const FILES_LIMIT = 2 * 1024 ** 3
/** Conexões abertas que ainda não se autenticaram (o resto espera). */
const MAX_PENDING = 50
const MAX_CHANNELS = 500
const MAX_ROLES = 250
const MAX_FRAME = 64 * 1024
const TIMEOUT_MINUTES = [0, 1, 5, 10, 60, 1440, 10080]
const SLOWMODES = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600]
const AUDIT_PAGE = 50
const AUDIT_KEEP = 90 * DAY
/** A vista do mapa vai pro banco no máximo a cada 5 s (arrastar manda uma dúzia por segundo). */
const MAP_SAVE_EVERY = 5000
const STATUSES: Status[] = ['online', 'idle', 'dnd', 'invisible']
const NOTIFY_LEVELS: NotifyLevel[] = ['all', 'mentions', 'none']

/** Cabeçalhos que só o Worker põe (o que vem de fora com eles é descartado lá). */
export const USER_HEADER = 'X-Resenha-User'
export const LEGACY_HEADER = 'X-Resenha-Legacy'

/** Mensagens que o app 0.5 entende; o resto não vai pra ele. */
const LEGACY_TYPES = new Set<string>([
  'ready',
  'chat.message',
  'chat.edited',
  'chat.deleted',
  'chat.history',
  'typing',
  'channel.upsert',
  'channel.removed',
  'user.upsert',
  'presence',
  'voice.state',
  'rtc.signal',
  'invite.created',
  'error',
])

const channelTable = (name: string) => `CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  position INTEGER NOT NULL,
  parent_id TEXT,
  topic TEXT NOT NULL DEFAULT '',
  overwrites TEXT NOT NULL DEFAULT '[]',
  user_limit INTEGER NOT NULL DEFAULT 0,
  slowmode INTEGER NOT NULL DEFAULT 0
)`

function parseOverwrites(text: string): Overwrite[] {
  try {
    const value = JSON.parse(text)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function cleanNotify(value: unknown, channels: Map<string, Channel>): NotifySettings | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const until = (x: unknown) => (x === null || x === undefined ? null : typeof x === 'number' && x > 0 ? Math.floor(x) : undefined)
  if (!NOTIFY_LEVELS.includes(v.level as NotifyLevel)) return null
  const mutedUntil = until(v.mutedUntil)
  if (mutedUntil === undefined) return null
  const out: NotifySettings = { level: v.level as NotifyLevel, mutedUntil, channels: {} }
  if (v.channels && typeof v.channels === 'object') {
    for (const [id, raw] of Object.entries(v.channels as Record<string, unknown>).slice(0, MAX_CHANNELS)) {
      if (!channels.has(id) || !raw || typeof raw !== 'object') continue
      const c = raw as Record<string, unknown>
      const level = c.level === null || c.level === undefined ? null : NOTIFY_LEVELS.includes(c.level as NotifyLevel) ? (c.level as NotifyLevel) : undefined
      const muted = until(c.mutedUntil)
      if (level === undefined || muted === undefined || (level === null && muted === null)) continue
      out.channels[id] = { level, mutedUntil: muted }
    }
  }
  return out
}

export class Guild extends DurableObject<Env> {
  private sql: SqlStorage
  private store: MessageStore
  /** Id deste servidor ("" até ser criado). */
  private id = ''
  private cache: {
    roles: Map<string, Role> | null
    channels: Map<string, Channel> | null
    perms: Map<string, Map<string, number>>
  } = { roles: null, channels: null, perms: new Map() }
  private flood = new Map<string, number[]>()
  private typingAt = new Map<string, number>()
  /** connId -> conexão que caiu e ainda pode voltar (continua na call e online até lá). */
  private ghosts = new Map<string, Ghost>()
  /** Sockets que já saíram (o fechamento e o erro podem chegar os dois). */
  private retired = new WeakSet<WebSocket>()
  /** Última vista do mapa (undefined: ainda não leu do banco). */
  private mapView: MapView | null | undefined
  private mapDirty = false
  private mapSavedAt = 0
  private mapSaveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.store = new MessageStore(this.sql, env.FILE_SECRET, () => ({ kind: 'g', id: this.id }))
    ctx.blockConcurrencyWhile(async () => this.migrate())
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private async migrate() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const legacy = columns(this.sql, 'channels')
    if (legacy.size > 0 && !legacy.has('parent_id') && !this.meta('pre_v2_bookmark')) {
      // Banco da 0.5: antes de mexer, guarda o ponto de restauração (dá pra voltar
      // exatamente pra cá com onNextSessionRestoreBookmark, por até 30 dias).
      try {
        this.setMeta('pre_v2_bookmark', await this.ctx.storage.getCurrentBookmark())
        this.setMeta('pre_v2_at', String(Date.now()))
      } catch (err) {
        console.error('sem ponto de restauração', err)
      }
    }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT,
      bio TEXT NOT NULL DEFAULT '',
      accent INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0
    )`)
    // 1.1: personalização do perfil (coluna nova; perfil antigo fica com NULL até o Directory mandar de novo).
    if (!columns(this.sql, 'profiles').has('style')) this.sql.exec('ALTER TABLE profiles ADD COLUMN style TEXT')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS members (
      user_id TEXT PRIMARY KEY,
      nick TEXT,
      roles TEXT NOT NULL DEFAULT '[]',
      joined_at INTEGER NOT NULL,
      timeout_until INTEGER,
      server_muted INTEGER NOT NULL DEFAULT 0,
      server_deafened INTEGER NOT NULL DEFAULT 0
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color INTEGER,
      position INTEGER NOT NULL,
      permissions INTEGER NOT NULL,
      hoist INTEGER NOT NULL DEFAULT 0,
      mentionable INTEGER NOT NULL DEFAULT 0
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS bans (
      user_id TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT,
      detail TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS read_states (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      last_read_id TEXT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    )`)
    // Menções ainda não lidas, uma linha por pessoa mencionada (some quando ela lê).
    this.sql.exec(`CREATE TABLE IF NOT EXISTS mention_index (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (user_id, channel_id, message_id)
    )`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS mention_index_by_message ON mention_index (message_id)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS notify (user_id TEXT PRIMARY KEY, settings TEXT NOT NULL)')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS slowmode (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_at INTEGER NOT NULL,
      PRIMARY KEY (channel_id, user_id)
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS map_pins (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      lng REAL NOT NULL,
      lat REAL NOT NULL,
      label TEXT NOT NULL,
      color INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`)

    // A tabela de canais da 0.5 só aceitava texto e voz (CHECK); a nova aceita categoria e tem mais colunas.
    const channelCols = columns(this.sql, 'channels')
    if (channelCols.size > 0 && !channelCols.has('parent_id')) {
      this.sql.exec(channelTable('channels_v2'))
      this.sql.exec('INSERT INTO channels_v2 (id, name, kind, position) SELECT id, name, kind, position FROM channels')
      this.sql.exec('DROP TABLE channels')
      this.sql.exec('ALTER TABLE channels_v2 RENAME TO channels')
    } else if (channelCols.size === 0) {
      this.sql.exec(channelTable('channels'))
    }
    this.store.migrate()
    this.id = this.meta('guild_id') ?? ''
  }

  // ---------- Metadados ----------

  private meta(key: string): string | null {
    return this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value ?? null
  }

  private setMeta(key: string, value: string | null) {
    if (value === null) this.sql.exec('DELETE FROM meta WHERE key = ?', key)
    else this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value)
  }

  private get ownerId(): string {
    return this.meta('owner_id') ?? ''
  }

  private info(): GuildInfo {
    return { id: this.id, name: this.meta('name') ?? 'Servidor', icon: this.meta('icon'), ownerId: this.ownerId }
  }

  // ---------- Perfis e membros ----------

  private profile(userId: string): ProfileRow | null {
    return this.sql.exec<ProfileRow>('SELECT * FROM profiles WHERE user_id = ?', userId).toArray()[0] ?? null
  }

  private toUser(row: ProfileRow): User {
    const style = row.deleted ? undefined : parseStyle(row.style)
    return {
      id: row.user_id,
      username: row.username,
      name: row.name,
      avatar: row.avatar,
      bio: row.bio,
      accent: row.accent,
      admin: this.isAdmin(row.user_id),
      ...(row.deleted ? { deleted: true } : {}),
      ...(style ? { style } : {}),
    }
  }

  private user(userId: string): User | null {
    const row = this.profile(userId)
    return row ? this.toUser(row) : null
  }

  private users(): User[] {
    return this.sql
      .exec<ProfileRow>('SELECT * FROM profiles')
      .toArray()
      .map((row) => this.toUser(row))
  }

  /** Guarda o perfil vindo do Directory. Devolve se mudou algo. */
  private saveProfile(user: User): boolean {
    const old = this.profile(user.id)
    const deleted = user.deleted ? 1 : 0
    const style = styleText(user.style)
    if (
      old &&
      old.username === user.username &&
      old.name === user.name &&
      old.avatar === user.avatar &&
      old.bio === user.bio &&
      old.accent === user.accent &&
      old.deleted === deleted &&
      old.style === style
    ) {
      return false
    }
    this.sql.exec(
      `INSERT INTO profiles (user_id, username, name, avatar, bio, accent, deleted, style) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET username = excluded.username, name = excluded.name, avatar = excluded.avatar,
       bio = excluded.bio, accent = excluded.accent, deleted = excluded.deleted, style = excluded.style`,
      user.id,
      user.username,
      user.name,
      user.avatar,
      user.bio,
      user.accent,
      deleted,
      style,
    )
    return true
  }

  private member(userId: unknown): MemberRow | null {
    if (typeof userId !== 'string') return null
    return this.sql.exec<MemberRow>('SELECT * FROM members WHERE user_id = ?', userId).toArray()[0] ?? null
  }

  private members(): MemberRow[] {
    return this.sql.exec<MemberRow>('SELECT * FROM members ORDER BY joined_at').toArray()
  }

  private like(row: MemberRow): MemberLike {
    return { userId: row.user_id, roles: parseJsonList(row.roles), timeoutUntil: row.timeout_until }
  }

  private toMember(row: MemberRow): Member {
    return {
      userId: row.user_id,
      nick: row.nick,
      roles: parseJsonList(row.roles),
      joinedAt: row.joined_at,
      timeoutUntil: row.timeout_until && row.timeout_until > Date.now() ? row.timeout_until : null,
      serverMuted: row.server_muted === 1,
      serverDeafened: row.server_deafened === 1,
    }
  }

  private timedOut(row: MemberRow | null): boolean {
    return !!row?.timeout_until && row.timeout_until > Date.now() && !this.isAdmin(row.user_id)
  }

  // ---------- Cargos, canais e permissões ----------

  private roles(): Map<string, Role> {
    if (!this.cache.roles) {
      this.cache.roles = new Map(
        this.sql
          .exec<RoleRow>('SELECT * FROM roles ORDER BY position DESC, id')
          .toArray()
          .map((r) => [
            r.id,
            {
              id: r.id,
              name: r.name,
              color: r.color,
              position: r.position,
              permissions: r.permissions,
              hoist: r.hoist === 1,
              mentionable: r.mentionable === 1,
            },
          ]),
      )
    }
    return this.cache.roles
  }

  private channels(): Map<string, Channel> {
    if (!this.cache.channels) {
      this.cache.channels = new Map(
        this.sql
          .exec<ChannelRow>('SELECT * FROM channels ORDER BY position, id')
          .toArray()
          .map((r) => [
            r.id,
            {
              id: r.id,
              name: r.name,
              kind: r.kind as ChannelKind,
              position: r.position,
              parentId: r.parent_id,
              topic: r.topic,
              overwrites: parseOverwrites(r.overwrites),
              userLimit: r.user_limit,
              slowmode: r.slowmode,
            },
          ]),
      )
    }
    return this.cache.channels
  }

  private channel(id: unknown, kind?: ChannelKind): Channel | null {
    if (typeof id !== 'string') return null
    const channel = this.channels().get(id)
    return channel && (!kind || channel.kind === kind) ? channel : null
  }

  private invalidate() {
    this.cache = { roles: null, channels: null, perms: new Map() }
  }

  private permContext() {
    return { guildId: this.id, ownerId: this.ownerId, roles: this.roles() }
  }

  private isAdmin(userId: string): boolean {
    if (userId === this.ownerId) return true
    const row = this.member(userId)
    return !!row && (basePermissions(this.permContext(), this.like(row)) & P.ADMINISTRATOR) !== 0
  }

  /** Permissões no servidor (fora de canal), já com o castigo aplicado. */
  private guildPerms(userId: string): number {
    const row = this.member(userId)
    if (!row) return 0
    const perms = basePermissions(this.permContext(), this.like(row))
    return this.timedOut(row) ? perms & (P.VIEW_CHANNEL | P.READ_HISTORY) : perms
  }

  /** Canal -> permissões, só dos canais que a pessoa vê. */
  private perms(userId: string): Map<string, number> {
    const cached = this.cache.perms.get(userId)
    if (cached) return cached
    const out = new Map<string, number>()
    const row = this.member(userId)
    if (row) {
      const ctx = this.permContext()
      const member = this.like(row)
      for (const channel of this.channels().values()) {
        const perms = channelPermissions(ctx, member, channel)
        if (perms & P.VIEW_CHANNEL) out.set(channel.id, perms)
      }
      // De castigo, as permissões mudam sozinhas quando o tempo acaba: não guarda.
      if (!this.timedOut(row)) this.cache.perms.set(userId, out)
    }
    return out
  }

  private can(userId: string, channelId: string, bit: number): boolean {
    const perms = this.perms(userId).get(channelId)
    return perms !== undefined && has(perms, bit)
  }

  private visibleChannels(userId: string): Channel[] {
    const perms = this.perms(userId)
    return [...this.channels().values()].filter((c) => perms.has(c.id))
  }

  private outranks(actorId: string, targetId: string): boolean {
    const actor = this.member(actorId)
    const target = this.member(targetId)
    if (!actor || !target) return false
    return outranks(this.permContext(), this.like(actor), this.like(target))
  }

  private topOf(userId: string): number {
    const row = this.member(userId)
    return row ? topPosition(this.permContext(), this.like(row)) : 0
  }

  // ---------- Conexões ----------

  private state(ws: WebSocket): ConnState {
    return ws.deserializeAttachment() as ConnState
  }

  private save(ws: WebSocket, state: ConnState) {
    ws.serializeAttachment(state)
  }

  /** Sockets abertos e autenticados, opcionalmente sem uma conexão que está saindo. */
  private sockets(exceptConnId?: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      if (ws.readyState !== WebSocket.OPEN) return false
      const state = this.state(ws)
      return !state.pending && (!exceptConnId || state.connId !== exceptConnId)
    })
  }

  private socketsOf(userId: string): WebSocket[] {
    return this.sockets().filter((ws) => this.state(ws).userId === userId)
  }

  private legacyText(msg: ServerMessage): string | null {
    if (msg.t === 'member.upsert') return JSON.stringify({ t: 'user.upsert', user: msg.user })
    return LEGACY_TYPES.has(msg.t) ? JSON.stringify(msg) : null
  }

  private raw(ws: WebSocket, text: string) {
    try {
      ws.send(text)
    } catch {
      // conexão caindo; o close resolve o resto
    }
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    const text = this.state(ws).legacy ? this.legacyText(msg) : JSON.stringify(msg)
    if (text) this.raw(ws, text)
  }

  /** `nonce`: o erro é de uma mensagem enviada (o app devolve o texto pro campo). */
  private error(ws: WebSocket, message: string, nonce?: string) {
    this.send(ws, { t: 'error', message, ...(nonce ? { nonce } : {}) })
  }

  /** Manda pra todo mundo, ou só pra quem vê o canal. */
  private broadcast(msg: ServerMessage, opts: { except?: string; channelId?: string; userId?: string } = {}) {
    let text: string | null = null
    let legacy: string | null | undefined
    for (const ws of this.sockets(opts.except)) {
      const state = this.state(ws)
      if (opts.userId && state.userId !== opts.userId) continue
      if (opts.channelId && !this.can(state.userId, opts.channelId, P.VIEW_CHANNEL)) continue
      if (state.legacy) {
        if (legacy === undefined) legacy = this.legacyText(msg)
        if (legacy) this.raw(ws, legacy)
      } else {
        text ??= JSON.stringify(msg)
        this.raw(ws, text)
      }
    }
  }

  // ---------- Presença ----------

  private statesOf(userId: string, exceptConnId?: string): ConnState[] {
    return [...this.sockets(exceptConnId).map((ws) => this.state(ws)), ...this.ghostStates(exceptConnId)].filter((s) => s.userId === userId)
  }

  private ghostStates(exceptConnId?: string): ConnState[] {
    return [...this.ghosts.values()].map((g) => g.state).filter((s) => s.connId !== exceptConnId)
  }

  private presenceOf(userId: string, exceptConnId?: string): Presence {
    return aggregate(this.statesOf(userId, exceptConnId))
  }

  private presences(): Record<string, Presence> {
    const out: Record<string, Presence> = {}
    const users = new Set([...this.sockets().map((ws) => this.state(ws).userId), ...this.ghostStates().map((g) => g.userId)])
    for (const userId of users) {
      const presence = this.presenceOf(userId)
      if (presence.status !== 'offline') out[userId] = presence
    }
    return out
  }

  private announcePresence(userId: string, before: Presence, exceptConnId?: string) {
    const after = this.presenceOf(userId, exceptConnId)
    if (samePresence(before, after)) return
    this.broadcast({ t: 'presence', userId, online: after.status !== 'offline', presence: after }, { except: exceptConnId })
  }

  // ---------- Voz ----------

  private voiceMembers(exceptConnId?: string): VoiceMember[] {
    const out: VoiceMember[] = []
    const moderation = new Map<string, MemberRow | null>()
    for (const { connId, userId, voice } of [...this.sockets(exceptConnId).map((ws) => this.state(ws)), ...this.ghostStates(exceptConnId)]) {
      if (!voice) continue
      if (!moderation.has(userId)) moderation.set(userId, this.member(userId))
      const row = moderation.get(userId)
      out.push({
        connId,
        userId,
        ...voice,
        camera: !!voice.camera,
        serverMuted: row?.server_muted === 1,
        serverDeafened: row?.server_deafened === 1,
      })
    }
    return out
  }

  /** Cada um recebe só quem está nos canais de voz que ele vê. */
  private broadcastVoice(exceptConnId?: string) {
    const members = this.voiceMembers(exceptConnId)
    const byUser = new Map<string, string>()
    for (const ws of this.sockets(exceptConnId)) {
      const { userId } = this.state(ws)
      let text = byUser.get(userId)
      if (text === undefined) {
        const perms = this.perms(userId)
        text = JSON.stringify({ t: 'voice.state', members: members.filter((m) => perms.has(m.channelId)) } satisfies ServerMessage)
        byUser.set(userId, text)
      }
      this.raw(ws, text)
    }
  }

  /** Tira as conexões dessa pessoa da call (ou move pra outro canal) e avisa o app delas. */
  private forceVoice(userId: string, channelId: string | null, exceptConnId?: string): boolean {
    let changed = false
    for (const ws of this.socketsOf(userId)) {
      const state = this.state(ws)
      if (!state.voice || state.connId === exceptConnId) continue
      this.save(ws, { ...state, voice: channelId ? { ...state.voice, channelId, sharing: false, camera: false } : null })
      this.send(ws, { t: 'voice.forced', channelId })
      changed = true
    }
    for (const [connId, ghost] of this.ghosts) {
      const state = ghost.state
      if (state.userId !== userId || !state.voice || connId === exceptConnId) continue
      ghost.state = { ...state, voice: channelId ? { ...state.voice, channelId, sharing: false, camera: false } : null }
      this.enqueue(ghost, { t: 'voice.forced', channelId })
      changed = true
    }
    return changed
  }

  // ---------- Reconexão (ver resume.ts) ----------

  private enqueue(ghost: Ghost, msg: ServerMessage | string) {
    if (ghost.queue.length < GHOST_QUEUE) ghost.queue.push(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  /** Caiu sem avisar: continua na call e online por um tempo, esperando o app voltar. */
  private holdGhost(state: ConnState) {
    const existing = this.ghosts.get(state.connId)
    if (existing) clearTimeout(existing.timer)
    this.ghosts.set(state.connId, {
      state,
      queue: existing?.queue ?? [],
      timer: setTimeout(() => this.releaseGhost(state.connId), graceFor(this.env)),
    })
  }

  /** O app não voltou a tempo: sai da call e fica offline de vez. */
  private releaseGhost(connId: string) {
    const ghost = this.ghosts.get(connId)
    if (!ghost) return
    const before = this.presenceOf(ghost.state.userId)
    this.ghosts.delete(connId)
    if (ghost.state.voice) this.broadcastVoice()
    if (ghost.state.map) this.leftMap()
    this.announcePresence(ghost.state.userId, before)
  }

  /** Esquece os fantasmas que batem; diz se algum estava na call ou no mapa. */
  private dropGhosts(match: (state: ConnState) => boolean): { voice: boolean; map: boolean } {
    const had = { voice: false, map: false }
    for (const [connId, ghost] of this.ghosts) {
      if (!match(ghost.state)) continue
      clearTimeout(ghost.timer)
      this.ghosts.delete(connId)
      had.voice ||= !!ghost.state.voice
      had.map ||= !!ghost.state.map
    }
    return had
  }

  /**
   * A mesma instância do app voltou (mesmo connId): pega a call da conexão
   * anterior, que caiu (fantasma) ou ainda parece aberta mas morreu, e o que
   * ficou guardado pra ela. A anterior fecha sem mexer em nada.
   */
  private takeOver(
    ws: WebSocket,
    userId: string,
    connId: string,
  ): { voice: VoiceState | null; map?: number; street?: StreetSpot; queue: string[] } {
    let voice: VoiceState | null = null
    let map: number | undefined
    let street: StreetSpot | undefined
    let queue: string[] = []
    const ghost = this.ghosts.get(connId)
    if (ghost && ghost.state.userId === userId) {
      clearTimeout(ghost.timer)
      this.ghosts.delete(connId)
      voice = ghost.state.voice
      map = ghost.state.map
      street = ghost.state.street
      queue = ghost.queue
    }
    for (const old of this.ctx.getWebSockets()) {
      if (old === ws) continue
      const state = this.state(old)
      if (state.pending || state.connId !== connId || state.userId !== userId) continue
      voice = state.voice ?? voice
      map = state.map ?? map
      street = state.street ?? street
      this.retired.add(old)
      try {
        this.save(old, { ...state, voice: null, map: undefined, street: undefined, replaced: true })
        old.close(4005, 'Outra conexão tomou o lugar')
      } catch {
        // já estava fechando
      }
    }
    return { voice, map, street, queue }
  }

  /** A call que voltou ainda vale? (canal existe, pode entrar, não está de castigo) */
  private validVoice(userId: string, voice: VoiceState | null): VoiceState | null {
    if (!voice || !this.channel(voice.channelId, 'voice')) return null
    if (!this.can(userId, voice.channelId, P.CONNECT) || this.timedOut(this.member(userId))) return null
    return voice
  }

  // ---------- Mudanças de acesso ----------

  /** Antes de mudar cargos/canais: o que cada pessoa conectada podia. */
  private snapshot(): Map<string, Map<string, number>> {
    const out = new Map<string, Map<string, number>>()
    for (const ws of this.sockets()) {
      const { userId } = this.state(ws)
      if (!out.has(userId)) out.set(userId, new Map(this.perms(userId)))
    }
    return out
  }

  /**
   * Depois da mudança: manda pra cada conexão os canais que apareceram, sumiram
   * ou mudaram, e as permissões novas. Quem perdeu acesso à call sai dela.
   */
  private pushAccess(before: Map<string, Map<string, number>>, opts: { changed?: Iterable<string>; reordered?: boolean } = {}) {
    this.invalidate()
    const changed = new Set(opts.changed ?? [])
    const channels = this.channels()
    let voiceChanged = false
    const byUser = new Map<string, WebSocket[]>()
    for (const ws of this.sockets()) {
      const { userId } = this.state(ws)
      byUser.set(userId, [...(byUser.get(userId) ?? []), ws])
    }
    for (const [userId, sockets] of byUser) {
      const old = before.get(userId) ?? new Map<string, number>()
      const now = this.perms(userId)
      const shown: Channel[] = []
      const removed: string[] = []
      for (const id of now.keys()) {
        if (!old.has(id) || changed.has(id)) shown.push(channels.get(id)!)
      }
      for (const id of old.keys()) if (!now.has(id)) removed.push(id)
      const permsChanged = removed.length > 0 || [...now].some(([id, p]) => old.get(id) !== p)
      const visible = opts.reordered ? this.visibleChannels(userId) : []
      for (const ws of sockets) {
        const state = this.state(ws)
        if (opts.reordered) {
          if (state.legacy) for (const c of visible) this.send(ws, { t: 'channel.upsert', channel: c })
          else this.send(ws, { t: 'channels.reordered', channels: visible })
        } else {
          for (const c of shown) this.send(ws, { t: 'channel.upsert', channel: c })
        }
        for (const id of removed) this.send(ws, { t: 'channel.removed', id })
        if (permsChanged) this.send(ws, { t: 'permissions', permissions: Object.fromEntries(now) })
        if (state.voice && !has(now.get(state.voice.channelId) ?? 0, P.CONNECT)) {
          this.save(ws, { ...state, voice: null })
          this.send(ws, { t: 'voice.forced', channelId: null })
          voiceChanged = true
        }
      }
    }
    if (voiceChanged) this.broadcastVoice()
  }

  private broadcastMember(userId: string) {
    const row = this.member(userId)
    const user = this.user(userId)
    if (!row || !user) return
    this.broadcast({ t: 'member.upsert', member: this.toMember(row), user })
  }

  private broadcastRoles() {
    this.broadcast({ t: 'roles', roles: [...this.roles().values()] })
  }

  // ---------- Leitura, menções e notificações ----------

  private readStates(userId: string, channelIds: string[]): ReadState[] {
    const reads = new Map(
      this.sql
        .exec<{ channel_id: string; last_read_id: string }>('SELECT channel_id, last_read_id FROM read_states WHERE user_id = ?', userId)
        .toArray()
        .map((r) => [r.channel_id, r.last_read_id]),
    )
    const counts = new Map(
      this.sql
        .exec<{ channel_id: string; n: number }>(
          'SELECT channel_id, COUNT(*) AS n FROM mention_index WHERE user_id = ? GROUP BY channel_id',
          userId,
        )
        .toArray()
        .map((r) => [r.channel_id, r.n]),
    )
    return channelIds.map((id) => ({ channelId: id, lastReadId: reads.get(id) ?? null, mentions: counts.get(id) ?? 0 }))
  }

  private markRead(userId: string, channelId: string, messageId: string): ReadState {
    this.sql.exec(
      `INSERT INTO read_states (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
      userId,
      channelId,
      messageId,
    )
    const lastReadId = this.sql
      .exec<{ id: string }>('SELECT last_read_id AS id FROM read_states WHERE user_id = ? AND channel_id = ?', userId, channelId)
      .one().id
    this.sql.exec('DELETE FROM mention_index WHERE user_id = ? AND channel_id = ? AND message_id <= ?', userId, channelId, lastReadId)
    const mentions = this.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM mention_index WHERE user_id = ? AND channel_id = ?', userId, channelId)
      .one().n
    return { channelId, lastReadId, mentions }
  }

  /** Quem acabou de entrar começa com tudo lido. */
  private markAllRead(userId: string) {
    const text = [...this.channels().values()].filter((c) => c.kind === 'text').map((c) => c.id)
    for (const [channelId, messageId] of Object.entries(this.store.lastIds(text))) this.markRead(userId, channelId, messageId)
  }

  private notifySettings(userId: string): NotifySettings {
    const row = this.sql.exec<{ settings: string }>('SELECT settings FROM notify WHERE user_id = ?', userId).toArray()[0]
    if (row) {
      try {
        return JSON.parse(row.settings) as NotifySettings
      } catch {
        // cai no padrão
      }
    }
    return { level: 'all', mutedUntil: null, channels: {} }
  }

  private mentionsIn(content: string, authorId: string, perms: number, replyAuthor: string | null) {
    const users = new Set<string>()
    for (const m of content.matchAll(/<@!?([\w-]{1,64})>/g)) if (this.member(m[1])) users.add(m[1])
    if (replyAuthor && replyAuthor !== authorId && this.member(replyAuthor)) users.add(replyAuthor)
    const roles = new Set<string>()
    const roleMap = this.roles()
    for (const m of content.matchAll(/<@&([\w-]{1,64})>/g)) {
      const role = roleMap.get(m[1])
      if (role && role.id !== this.id && (role.mentionable || has(perms, P.MENTION_EVERYONE))) roles.add(role.id)
    }
    const mentionEveryone = has(perms, P.MENTION_EVERYONE) && /(^|[^\w`])@(everyone|here)\b/.test(content)
    return { mentions: [...users].slice(0, 50), mentionRoles: [...roles].slice(0, 20), mentionEveryone }
  }

  private recordMentions(
    messageId: string,
    channelId: string,
    authorId: string,
    m: { mentions: string[]; mentionRoles: string[]; mentionEveryone: boolean },
  ) {
    const targets = new Set(m.mentions)
    if (m.mentionEveryone || m.mentionRoles.length > 0) {
      for (const row of this.members()) {
        if (m.mentionEveryone || parseJsonList(row.roles).some((r) => m.mentionRoles.includes(r))) targets.add(row.user_id)
      }
    }
    targets.delete(authorId)
    for (const userId of targets) {
      if (!this.can(userId, channelId, P.VIEW_CHANNEL)) continue
      this.sql.exec(
        'INSERT INTO mention_index (user_id, channel_id, message_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        userId,
        channelId,
        messageId,
      )
    }
  }

  /** Mensagem apagada: quem tinha menção não lida nela recebe a contagem nova. */
  private dropMentions(messageIds: string[]) {
    if (messageIds.length === 0) return
    const affected = this.sql
      .exec<{ user_id: string; channel_id: string }>(
        `SELECT DISTINCT user_id, channel_id FROM mention_index WHERE message_id ${IN_LIST}`,
        list(messageIds),
      )
      .toArray()
    this.sql.exec(`DELETE FROM mention_index WHERE message_id ${IN_LIST}`, list(messageIds))
    for (const { user_id, channel_id } of affected) {
      const [state] = this.readStates(user_id, [channel_id])
      this.broadcast({ t: 'read.state', state }, { userId: user_id })
    }
  }

  // ---------- Auditoria e anti-spam ----------

  private audit(actorId: string, action: AuditAction, targetId: string | null, detail: string) {
    this.sql.exec(
      'INSERT INTO audit (id, actor_id, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      actorId,
      action,
      targetId,
      detail.slice(0, 500),
      Date.now(),
    )
  }

  /** No máximo `max` ações na janela (na memória: zera se o servidor hibernar, e tudo bem). */
  private allow(key: string, max: number, window: number): boolean {
    const now = Date.now()
    const recent = (this.flood.get(key) ?? []).filter((t) => now - t < window)
    if (recent.length >= max) return false
    recent.push(now)
    this.flood.set(key, recent)
    if (this.flood.size > 20_000) this.flood.clear()
    return true
  }

  // ---------- Espaço de anexos ----------

  /** Bytes sendo enviados agora (dois envios ao mesmo tempo não cabem no mesmo espaço). */
  private uploading = 0

  /** Reserva o espaço antes de gravar (aqui e na plataforma); `done` fecha a conta. */
  private async reserve(userId: string, bytes: number): Promise<UploadTicket> {
    const used = this.store.filesUsed()
    if (used + this.uploading + bytes > FILES_LIMIT) return { error: 'O espaço de anexos deste servidor está cheio.' }
    this.uploading += bytes
    const scope = `g:${this.id}`
    let released = false
    const release = () => {
      if (!released) this.uploading -= bytes
      released = true
    }
    try {
      const r = await directory(this.env).reserveStorage(scope, used, bytes, userId)
      if (!r.ok) {
        release()
        return { error: r.error }
      }
      return {
        done: async () => {
          release()
          await directory(this.env).finishUpload(r.value, scope, this.store.filesUsed())
        },
      }
    } catch (err) {
      release()
      throw err
    }
  }

  private async reportStorage() {
    try {
      await directory(this.env).reportStorage(`g:${this.id}`, this.store.filesUsed())
    } catch (err) {
      console.error('não deu pra atualizar o espaço usado', err)
    }
  }

  // ---------- HTTP e WebSocket ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    // Só pra migração das conversas privadas da 0.5 (chamado por outro DO, nunca pelo Worker).
    const legacyFile = pathname.match(/^\/internal\/legacy-file\/([\w-]+)$/)
    if (legacyFile) {
      const row = this.sql.exec<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', legacyFile[1]).toArray()[0]
      if (!row) return new Response(null, { status: 404 })
      return new Response(row.size > 0 ? this.store.files.read(row.id, 0, row.size - 1) : null)
    }

    if (/\/files$/.test(pathname) && request.method === 'POST') {
      const userId = request.headers.get(USER_HEADER)
      const row = this.member(userId)
      if (!row) return Response.json({ error: 'Você não está nesse servidor.' }, { status: 403 })
      if (this.timedOut(row)) return Response.json({ error: 'Você está de castigo e não pode enviar arquivos.' }, { status: 403 })
      // O app diz em que canal vai usar; a 0.5 não diz, aí vale a permissão do servidor.
      const channelId = url.searchParams.get('channel')
      const allowed = channelId ? this.can(row.user_id, channelId, P.ATTACH_FILES) : has(this.guildPerms(row.user_id), P.ATTACH_FILES)
      if (!allowed) return Response.json({ error: 'Você não pode enviar arquivos aqui.' }, { status: 403 })
      if (!this.allow(`upload:${row.user_id}`, 30, MINUTE)) {
        return Response.json({ error: 'Calma! Muitos arquivos de uma vez.' }, { status: 429 })
      }
      // Anexo que nunca virar mensagem some num dia, mesmo sem ninguém conectado.
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + ORPHAN_TTL)
      return this.store.upload(request, row.user_id, (bytes) => this.reserve(row.user_id, bytes))
    }
    const file = pathname.match(/\/files\/([\w-]+)\/[^/]+$/)
    if (file && request.method === 'GET') return this.store.serve(request, file[1])

    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Esperava WebSocket', { status: 426 })
    if (this.ctx.getWebSockets().filter((ws) => this.state(ws).pending).length >= MAX_PENDING) {
      return new Response('Ocupado, tente de novo', { status: 503 })
    }

    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    const pending: ConnState = {
      userId: '',
      connId: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      session: '',
      connectedAt: Date.now(),
      voice: null,
      pending: true,
      legacy: request.headers.get(LEGACY_HEADER) === '1',
    }
    server.serializeAttachment(pending)
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_EVERY)
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Valida o token da conexão (no Directory) e só então manda o estado inicial (`ready`). */
  private async completeAuth(ws: WebSocket, pending: ConnState, msg: Extract<ClientMessage, { t: 'auth' }>) {
    const auth = typeof msg.token === 'string' ? await directory(this.env).authenticate(msg.token) : null
    if (ws.readyState !== WebSocket.OPEN) return
    // Código próprio: o app distingue "sessão inválida" de "sem rede".
    if (!auth) return ws.close(4001, 'Sessão inválida')
    // (O "main" da 0.5 ganha o id quando o Directory termina a migração, que roda no authenticate.)
    if (!this.id) return ws.close(4004, 'Servidor não existe')
    const row = this.member(auth.me.id)
    if (!row) return ws.close(4003, 'Você não está nesse servidor')
    const key = !pending.legacy && typeof msg.key === 'string' && CONN_KEY.test(msg.key) ? msg.key : null
    const connId = key ? await connIdFor(auth.me.id, key) : pending.connId
    if (ws.readyState !== WebSocket.OPEN) return

    if (this.saveProfile({ ...auth.me, admin: false })) this.broadcastMember(auth.me.id)
    const before = this.presenceOf(auth.me.id)
    const resumed = key ? this.takeOver(ws, auth.me.id, connId) : { voice: null, queue: [] }
    // Quem estava no mapa continua nele (pros outros nada muda); o app confirma com `map.join` ou sai.
    const voice = this.validVoice(auth.me.id, resumed.voice)
    const state: ConnState = {
      ...pending,
      connId,
      resumable: !!key,
      userId: auth.me.id,
      session: auth.tokenHash,
      pending: false,
      status: STATUSES.includes(msg.status as Status) ? (msg.status as Status) : 'online',
      text: cleanLine(msg.text, 1, 128),
      voice,
      map: resumed.map,
      street: resumed.map ? resumed.street : undefined,
    }
    this.save(ws, state)

    const perms = this.perms(state.userId)
    const channels = this.visibleChannels(state.userId)
    const text = channels.filter((c) => c.kind === 'text').map((c) => c.id)
    const presences = this.presences()
    this.send(ws, {
      t: 'ready',
      me: this.user(state.userId)!,
      connId: state.connId,
      users: this.users(),
      channels,
      voice: this.voiceMembers().filter((v) => perms.has(v.channelId)),
      online: Object.keys(presences),
      guild: this.info(),
      roles: [...this.roles().values()],
      members: this.members().map((m) => this.toMember(m)),
      presences,
      permissions: Object.fromEntries(perms),
      readStates: this.readStates(state.userId, text),
      lastMessageIds: this.store.lastIds(text),
      notify: this.notifySettings(state.userId),
      resumed: !!voice,
      mapViewers: this.mapViewers(),
    })
    for (const queued of resumed.queue) this.raw(ws, queued)
    if (resumed.voice && !voice) this.send(ws, { t: 'voice.forced', channelId: null })
    if (resumed.voice) this.broadcastVoice()
    this.announcePresence(state.userId, before)
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME) return
    let msg: ClientMessage
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
    const member = this.member(state.userId)
    if (!member) return ws.close(4003, 'Você não está nesse servidor')
    // O mapa tem balde próprio: arrastar e mexer o mouse mandam uma dúzia de mensagens por segundo.
    if (msg.t === 'map.view' || msg.t === 'map.cursor') {
      if (this.allow(`map:${state.connId}`, 300, 10_000)) this.mapMotion(state, msg, member)
      return
    }
    // Limite por conexão: sinalização da call tem folga maior (muitos candidatos ICE de uma vez).
    const signal = msg.t === 'rtc.signal'
    if (!this.allow(`${signal ? 'sig' : 'ws'}:${state.connId}`, signal ? 400 : 120, 10_000)) {
      if (this.allow(`warn:${state.connId}`, 1, 10_000)) this.error(ws, 'Calma! Muitas ações de uma vez.')
      return
    }

    try {
      await this.handle(ws, state, msg)
    } catch (err) {
      console.error('erro tratando', msg.t, err)
      this.error(ws, 'Erro no servidor.')
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code === 1005 ? 1000 : code, reason)
    } catch {
      // já fechado
    }
    this.dropConnection(ws, this.state(ws), unexpectedClose(code))
  }

  async webSocketError(ws: WebSocket) {
    this.dropConnection(ws, this.state(ws), true)
  }

  /** `unexpected`: caiu sem o app pedir (rede, servidor reiniciando). */
  private dropConnection(ws: WebSocket, state: ConnState, unexpected: boolean) {
    if (state.pending || !state.userId || state.replaced || this.retired.has(ws)) return
    this.retired.add(ws)
    // A mesma instância do app já voltou por outra conexão: ela ficou com tudo.
    if (this.sockets().some((s) => s !== ws && this.state(s).connId === state.connId)) return
    if (unexpected && state.resumable && this.member(state.userId)) return this.holdGhost(state)
    // O socket que caiu já não está aberto: o "antes" inclui ele à mão.
    const before = aggregate([...this.statesOf(state.userId, state.connId), state])
    if (state.voice) this.broadcastVoice(state.connId)
    if (state.map) this.leftMap(state.connId)
    this.announcePresence(state.userId, before, state.connId)
  }

  /** Varre conexões mortas, castigos que acabaram e anexos que nunca foram usados. */
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
        this.dropConnection(ws, state, true)
      }
    }

    const expired = this.sql
      .exec<{ user_id: string }>('SELECT user_id FROM members WHERE timeout_until IS NOT NULL AND timeout_until <= ?', now)
      .toArray()
    if (expired.length > 0) {
      this.sql.exec('UPDATE members SET timeout_until = NULL WHERE timeout_until IS NOT NULL AND timeout_until <= ?', now)
      this.invalidate()
      for (const { user_id } of expired) {
        this.broadcastMember(user_id)
        this.broadcast({ t: 'permissions', permissions: Object.fromEntries(this.perms(user_id)) }, { userId: user_id })
      }
    }

    if (this.store.removeOrphans(now - ORPHAN_TTL) > 0) await this.reportStorage()
    this.sql.exec('DELETE FROM slowmode WHERE last_at < ?', now - 6 * 60 * MINUTE)
    this.sql.exec('DELETE FROM audit WHERE created_at < ?', now - AUDIT_KEEP)

    // Com alguém conectado (mesmo sem login), volta logo; sem ninguém, só se sobrou anexo solto.
    if (this.ctx.getWebSockets().length > 0) await this.ctx.storage.setAlarm(now + SWEEP_EVERY)
    else if (this.sql.exec('SELECT 1 FROM attachments WHERE message_id IS NULL LIMIT 1').toArray().length > 0) {
      await this.ctx.storage.setAlarm(now + ORPHAN_TTL / 4)
    }
  }

  // ---------- Mensagens do app ----------

  private async handle(ws: WebSocket, state: ConnState, msg: ClientMessage) {
    const userId = state.userId
    switch (msg.t) {
      case 'presence': {
        if (!STATUSES.includes(msg.status) || !this.allow(`presence:${state.connId}`, 10, MINUTE)) return
        const before = this.presenceOf(userId)
        this.save(ws, { ...state, status: msg.status, text: cleanLine(msg.text, 1, 128) })
        return this.announcePresence(userId, before)
      }

      case 'chat.send':
        return this.sendMessage(ws, state, msg)

      case 'chat.edit': {
        const row = this.store.get(msg.id)
        if (!row || row.author_id !== userId) return
        if (!this.allow(`edit:${userId}`, 5, 5000)) return this.error(ws, 'Calma! Edições rápidas demais.')
        const channel = this.channel(row.channel_id, 'text')
        if (!channel || !this.can(userId, channel.id, P.VIEW_CHANNEL)) return
        if (this.timedOut(this.member(userId))) return this.error(ws, 'Você está de castigo e não pode editar agora.')
        const content = typeof msg.content === 'string' ? msg.content.trim() : ''
        if (content.length > MAX_MESSAGE_LENGTH) return this.error(ws, 'Mensagem grande demais.')
        if (!content && !this.store.hasAttachments(row.id)) return
        if (content === row.content) return
        const perms = this.perms(userId).get(channel.id) ?? 0
        const replyAuthor = row.reply_to ? (this.store.get(row.reply_to)?.author_id ?? null) : null
        this.store.edit(row, content, this.mentionsIn(content, userId, perms, replyAuthor))
        const message = (await this.store.loadOne(row.id))!
        this.broadcast({ t: 'chat.edited', message }, { channelId: channel.id })
        return this.refreshEmbeds(row.id, channel.id, content)
      }

      case 'chat.delete': {
        const row = this.store.get(msg.id)
        if (!row) return
        const channel = this.channel(row.channel_id, 'text')
        if (!channel || !this.can(userId, channel.id, P.VIEW_CHANNEL)) return
        const own = row.author_id === userId
        if (!own && !this.can(userId, channel.id, P.MANAGE_MESSAGES)) return
        const freed = this.store.removeRows([row])
        this.dropMentions([row.id])
        this.broadcast({ t: 'chat.deleted', id: row.id, channelId: channel.id }, { channelId: channel.id })
        if (!own) this.audit(userId, 'message.delete', row.author_id, `#${channel.name}`)
        if (freed > 0) await this.reportStorage()
        return
      }

      case 'chat.history': {
        if (typeof msg.channelId === 'string' && dmMembers(msg.channelId)) {
          // App 0.5 abrindo conversa privada: agora elas moram em outro lugar.
          this.send(ws, { t: 'chat.history', reqId: msg.reqId, channelId: msg.channelId, messages: [], hasMore: false })
          return this.error(ws, 'Atualize o app pra ver as mensagens privadas.')
        }
        const channel = this.channel(msg.channelId, 'text')
        if (!channel || !this.can(userId, channel.id, P.READ_HISTORY)) return
        const page = await this.store.history(channel.id, { before: msg.before, around: msg.around })
        return this.send(ws, { t: 'chat.history', reqId: String(msg.reqId), channelId: channel.id, ...page })
      }

      case 'chat.react': {
        const row = this.store.get(msg.id)
        const emoji = validEmoji(msg.emoji)
        if (!row || !emoji) return
        const channel = this.channel(row.channel_id, 'text')
        if (!channel || !this.can(userId, channel.id, P.READ_HISTORY)) return
        if (this.timedOut(this.member(userId))) return this.error(ws, 'Você está de castigo e não pode reagir agora.')
        if (msg.on && !this.store.hasReaction(row.id, emoji) && !this.can(userId, channel.id, P.ADD_REACTIONS)) {
          return this.error(ws, 'Você não pode reagir nesse canal.')
        }
        if (!this.allow(`react:${userId}`, 15, 5000)) return this.error(ws, 'Calma! Reações rápidas demais.')
        if (!this.store.react(row.id, userId, emoji, !!msg.on)) return this.error(ws, 'Essa mensagem já tem reações demais.')
        return this.broadcast(
          { t: 'chat.reactions', id: row.id, channelId: channel.id, reactions: this.store.reactions(row.id) },
          { channelId: channel.id },
        )
      }

      case 'chat.pin': {
        const row = this.store.get(msg.id)
        if (!row) return
        const channel = this.channel(row.channel_id, 'text')
        if (!channel || !this.can(userId, channel.id, P.MANAGE_MESSAGES)) return
        if (!!msg.on === (row.pinned_at !== null)) return
        if (msg.on && this.store.pinCount(channel.id) >= MAX_PINS_PER_CHANNEL) {
          return this.error(ws, `Esse canal já tem ${MAX_PINS_PER_CHANNEL} mensagens fixadas.`)
        }
        this.store.setPinned(row.id, !!msg.on)
        this.audit(userId, 'message.pin', row.author_id, `${msg.on ? 'Fixou' : 'Desafixou'} em #${channel.name}`)
        const message = (await this.store.loadOne(row.id))!
        return this.broadcast({ t: 'chat.edited', message }, { channelId: channel.id })
      }

      case 'chat.pins': {
        const channel = this.channel(msg.channelId, 'text')
        if (!channel || !this.can(userId, channel.id, P.READ_HISTORY)) return
        return this.send(ws, { t: 'chat.pins', reqId: String(msg.reqId), channelId: channel.id, messages: await this.store.pins(channel.id) })
      }

      case 'chat.search': {
        if (!this.allow(`search:${userId}`, 10, 10_000)) return this.error(ws, 'Calma! Buscas rápidas demais.')
        const readable = this.visibleChannels(userId)
          .filter((c) => c.kind === 'text' && this.can(userId, c.id, P.READ_HISTORY))
          .map((c) => c.id)
        const scope = typeof msg.channelId === 'string' ? readable.filter((id) => id === msg.channelId) : readable
        const result = await this.store.search(scope, msg.query, { authorId: msg.authorId, before: msg.before })
        return this.send(ws, { t: 'chat.search', reqId: String(msg.reqId), ...result })
      }

      case 'chat.ack': {
        if (!this.allow(`ack:${userId}`, 30, 10_000)) return
        const channel = this.channel(msg.channelId, 'text')
        if (!channel || typeof msg.messageId !== 'string' || !this.can(userId, channel.id, P.VIEW_CHANNEL)) return
        const read = this.markRead(userId, channel.id, msg.messageId.slice(0, 64))
        return this.broadcast({ t: 'read.state', state: read }, { userId })
      }

      case 'typing': {
        const channel = this.channel(msg.channelId, 'text')
        if (!channel || !this.can(userId, channel.id, P.SEND_MESSAGES)) return
        const key = `${userId}:${channel.id}`
        const now = Date.now()
        if (now - (this.typingAt.get(key) ?? 0) < 2000) return
        this.typingAt.set(key, now)
        if (this.typingAt.size > 5000) this.typingAt.clear()
        return this.broadcast({ t: 'typing', channelId: channel.id, userId }, { except: state.connId, channelId: channel.id })
      }

      case 'channel.create':
        return this.createChannel(ws, userId, msg)

      case 'channel.rename':
        return this.updateChannel(ws, userId, { t: 'channel.update', id: msg.id, name: msg.name })

      case 'channel.update':
        return this.updateChannel(ws, userId, msg)

      case 'channel.reorder':
        return this.reorderChannels(ws, userId, msg)

      case 'channel.delete':
        return this.deleteChannel(ws, userId, msg)

      case 'guild.update':
        return this.updateGuild(ws, userId, msg)

      case 'guild.transfer':
        return this.transferGuild(ws, userId, msg)

      case 'role.create':
      case 'role.update':
      case 'role.reorder':
      case 'role.delete':
        return this.handleRole(ws, userId, msg)

      case 'member.roles':
      case 'member.nick':
      case 'member.kick':
      case 'member.ban':
      case 'member.unban':
      case 'member.timeout':
      case 'member.voice':
        return this.handleMember(ws, userId, msg)

      case 'bans.list': {
        if (!has(this.guildPerms(userId), P.BAN_MEMBERS)) return
        const bans: Ban[] = this.sql
          .exec<{ user_id: string; reason: string; actor_id: string; created_at: number }>('SELECT * FROM bans ORDER BY created_at DESC')
          .toArray()
          .map((b) => ({ userId: b.user_id, reason: b.reason, actorId: b.actor_id, createdAt: b.created_at, user: this.user(b.user_id) }))
        return this.send(ws, { t: 'bans.list', reqId: String(msg.reqId), bans })
      }

      case 'audit.list': {
        if (!has(this.guildPerms(userId), P.VIEW_AUDIT_LOG)) return
        const before = typeof msg.before === 'string' ? msg.before : '~'
        const rows = this.sql
          .exec<{ id: string; actor_id: string; action: string; target_id: string | null; detail: string; created_at: number }>(
            'SELECT * FROM audit WHERE id < ? ORDER BY id DESC LIMIT ?',
            before,
            AUDIT_PAGE + 1,
          )
          .toArray()
        const entries: AuditEntry[] = rows.slice(0, AUDIT_PAGE).map((r) => ({
          id: r.id,
          actorId: r.actor_id,
          action: r.action as AuditAction,
          targetId: r.target_id,
          detail: r.detail,
          createdAt: r.created_at,
        }))
        return this.send(ws, { t: 'audit.list', reqId: String(msg.reqId), entries, hasMore: rows.length > AUDIT_PAGE })
      }

      case 'invite.create': {
        const nonce = typeof msg.nonce === 'string' ? msg.nonce.slice(0, 64) : undefined
        if (!has(this.guildPerms(userId), P.CREATE_INVITE)) return this.error(ws, 'Você não pode criar convites aqui.', nonce)
        if (!this.allow(`invite:${userId}`, 10, MINUTE)) return this.error(ws, 'Calma! Convites demais de uma vez.', nonce)
        // A 0.5 não manda validade: o convite dela vale 7 dias e uma pessoa, como antes.
        const options = state.legacy ? { maxAge: 7 * 86400, maxUses: 1 } : { maxAge: msg.maxAge, maxUses: msg.maxUses }
        const result = await directory(this.env).createInvite(this.id, userId, options)
        if (!result.ok) return this.error(ws, result.error, nonce)
        this.audit(userId, 'invite.create', null, result.value.code)
        return this.send(ws, { t: 'invite.created', code: result.value.code, invite: result.value, nonce })
      }

      case 'invites.list': {
        if (!has(this.guildPerms(userId), P.MANAGE_GUILD)) return
        return this.send(ws, { t: 'invites.list', reqId: String(msg.reqId), invites: await directory(this.env).listInvites(this.id) })
      }

      case 'invite.delete': {
        if (typeof msg.code !== 'string') return
        const owner = await directory(this.env).inviteOwner(this.id, msg.code)
        if (!owner) return
        if (owner !== userId && !has(this.guildPerms(userId), P.MANAGE_GUILD)) return
        await directory(this.env).deleteInvite(this.id, msg.code)
        this.audit(userId, 'invite.delete', null, msg.code)
        return
      }

      case 'notify.update': {
        if (!this.allow(`notify:${userId}`, 5, 10_000)) return this.error(ws, 'Calma! Mudanças rápidas demais.')
        const settings = cleanNotify(msg.settings, this.channels())
        if (!settings) return
        this.sql.exec(
          'INSERT INTO notify (user_id, settings) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET settings = excluded.settings',
          userId,
          JSON.stringify(settings),
        )
        return this.broadcast({ t: 'notify.settings', settings }, { userId })
      }

      case 'voice.join': {
        const channel = this.channel(msg.channelId, 'voice')
        if (!channel) return
        if (this.timedOut(this.member(userId))) return this.error(ws, 'Você está de castigo e não pode entrar em call agora.')
        if (!this.can(userId, channel.id, P.CONNECT)) return this.error(ws, 'Você não pode entrar nesse canal.')
        if (channel.userLimit > 0 && !this.can(userId, channel.id, P.MOVE_MEMBERS)) {
          const inside = new Set(this.voiceMembers().filter((v) => v.channelId === channel.id && v.userId !== userId).map((v) => v.userId))
          if (inside.size >= channel.userLimit) return this.error(ws, 'Esse canal está cheio.')
        }
        // Uma call por pessoa: o outro aparelho dela sai (como no Discord).
        this.forceVoice(userId, null, state.connId)
        // Já estava nessa call (o app reconectou e confirma): tela e câmera continuam. Voltando
        // depois de o servidor perder a call, o app diz como estava.
        const same = state.voice?.channelId === channel.id ? state.voice : null
        const video = this.can(userId, channel.id, P.VIDEO)
        this.save(ws, {
          ...this.state(ws),
          voice: {
            channelId: channel.id,
            muted: !!msg.muted || !this.can(userId, channel.id, P.SPEAK),
            deafened: !!msg.deafened,
            sharing: (msg.sharing ?? same?.sharing ?? false) === true && video,
            camera: (msg.camera ?? same?.camera ?? false) === true && video,
          },
        })
        return this.broadcastVoice()
      }

      case 'voice.leave':
        if (!state.voice) return
        this.save(ws, { ...state, voice: null })
        return this.broadcastVoice()

      case 'voice.update': {
        if (!state.voice) return
        const channelId = state.voice.channelId
        const video = this.can(userId, channelId, P.VIDEO)
        this.save(ws, {
          ...state,
          voice: {
            ...state.voice,
            muted: !!msg.muted || !this.can(userId, channelId, P.SPEAK),
            deafened: !!msg.deafened,
            sharing: !!msg.sharing && video,
            camera: !!msg.camera && video,
          },
        })
        return this.broadcastVoice()
      }

      case 'rtc.signal': {
        // Só repassa entre duas conexões que estão no mesmo canal de voz.
        if (!state.voice || !msg.data || typeof msg.data !== 'object') return
        const signal: ServerMessage = { t: 'rtc.signal', from: state.connId, data: msg.data }
        const target = this.sockets().find((s) => this.state(s).connId === msg.to)
        if (target) {
          if (this.state(target).voice?.channelId !== state.voice.channelId) return
          return this.send(target, signal)
        }
        // Caiu e ainda pode voltar: entrega quando voltar.
        const ghost = typeof msg.to === 'string' ? this.ghosts.get(msg.to) : undefined
        if (ghost?.state.voice?.channelId === state.voice.channelId) this.enqueue(ghost, signal)
        return
      }

      case 'map.join':
      case 'map.leave':
      case 'map.street':
      case 'map.pin.add':
      case 'map.pin.remove':
        return this.handleMap(ws, state, msg)
    }
  }

  // ---------- Enviar mensagem ----------

  private async sendMessage(ws: WebSocket, state: ConnState, msg: Extract<ClientMessage, { t: 'chat.send' }>) {
    const userId = state.userId
    const nonce = typeof msg.nonce === 'string' ? msg.nonce.slice(0, 64) : undefined
    if (typeof msg.channelId === 'string' && dmMembers(msg.channelId)) {
      return this.error(ws, 'Atualize o app pra usar as mensagens privadas.', nonce)
    }
    const channel = this.channel(msg.channelId, 'text')
    if (!channel) return this.error(ws, 'Canal não existe.', nonce)
    const member = this.member(userId)
    if (this.timedOut(member)) return this.error(ws, 'Você está de castigo e não pode escrever agora.', nonce)
    const perms = this.perms(userId).get(channel.id) ?? 0
    if (!has(perms, P.SEND_MESSAGES)) return this.error(ws, 'Você não pode escrever nesse canal.', nonce)

    const content = typeof msg.content === 'string' ? msg.content.trim() : ''
    if (content.length > MAX_MESSAGE_LENGTH) return this.error(ws, 'Mensagem grande demais.', nonce)
    const requested = Array.isArray(msg.attachmentIds) ? msg.attachmentIds.filter((id) => typeof id === 'string').slice(0, 10) : []
    if (requested.length > 0 && !has(perms, P.ATTACH_FILES)) return this.error(ws, 'Você não pode enviar arquivos nesse canal.', nonce)
    const attachments = this.store.pendingAttachments(userId, requested)
    if (!content && attachments.length === 0) return

    if (!this.allow(`send:${userId}`, 5, 5000)) return this.error(ws, 'Calma! Você está mandando mensagens rápido demais.', nonce)
    if (channel.slowmode > 0 && !has(perms, P.MANAGE_MESSAGES) && !has(perms, P.MANAGE_CHANNELS)) {
      const last = this.sql
        .exec<{ last_at: number }>('SELECT last_at FROM slowmode WHERE channel_id = ? AND user_id = ?', channel.id, userId)
        .toArray()[0]?.last_at
      const wait = last ? last + channel.slowmode * 1000 - Date.now() : 0
      if (wait > 0) return this.error(ws, `Modo lento: espere ${Math.ceil(wait / 1000)} s pra mandar outra mensagem.`, nonce)
      this.sql.exec(
        'INSERT INTO slowmode (channel_id, user_id, last_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET last_at = excluded.last_at',
        channel.id,
        userId,
        Date.now(),
      )
    }

    const reply = typeof msg.replyTo === 'string' ? this.store.get(msg.replyTo) : null
    const replyTo = reply && reply.channel_id === channel.id ? reply : null
    const mentions = this.mentionsIn(content, userId, perms, replyTo?.author_id ?? null)
    const row = this.store.insert(
      { id: newId(), channelId: channel.id, authorId: userId, content, replyTo: replyTo?.id ?? null, ...mentions },
      attachments,
    )
    this.recordMentions(row.id, channel.id, userId, mentions)
    this.markRead(userId, channel.id, row.id)
    const [message] = await this.store.load([row])
    this.broadcast({ t: 'chat.message', message, nonce }, { channelId: channel.id })
    await this.refreshEmbeds(row.id, channel.id, content)
  }

  /** Busca as prévias dos links (depois que a mensagem já chegou pra todo mundo). */
  private async refreshEmbeds(messageId: string, channelId: string, content: string) {
    const embeds = await unfurlAll(content, this.env.FILE_SECRET, '')
    const row = this.store.get(messageId)
    if (!row || row.embeds === JSON.stringify(embeds)) return // apagada enquanto buscava, ou nada mudou
    this.store.setEmbeds(messageId, embeds)
    const message = await this.store.loadOne(messageId)
    if (message) this.broadcast({ t: 'chat.edited', message }, { channelId })
  }

  // ---------- Canais ----------

  private async createChannel(ws: WebSocket, userId: string, msg: Extract<ClientMessage, { t: 'channel.create' }>) {
    if (!has(this.guildPerms(userId), P.MANAGE_CHANNELS)) return this.error(ws, 'Você não pode criar canais aqui.')
    if (this.channels().size >= MAX_CHANNELS) return this.error(ws, `O limite é de ${MAX_CHANNELS} canais.`)
    if (msg.kind !== 'text' && msg.kind !== 'voice' && msg.kind !== 'category') return
    const name = cleanLine(msg.name, 1, 100)
    if (!name) return this.error(ws, 'O nome precisa ter de 1 a 100 caracteres.')
    let parentId: string | null = null
    if (msg.parentId && msg.kind !== 'category') {
      if (!this.channel(msg.parentId, 'category')) return this.error(ws, 'Categoria não existe.')
      parentId = msg.parentId
    }
    // Canal novo numa categoria nasce com as permissões dela ("sincronizado").
    let overwrites: Overwrite[] = parentId ? (this.channel(parentId)?.overwrites ?? []) : []
    if (msg.overwrites !== undefined) {
      if (!has(this.guildPerms(userId), P.MANAGE_ROLES)) return this.error(ws, 'Você não pode mexer em permissões.')
      const clean = this.cleanOverwrites(userId, msg.overwrites, [])
      if (typeof clean === 'string') return this.error(ws, clean)
      overwrites = clean
    }
    const position = this.sql
      .exec<{ p: number }>(
        'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels WHERE parent_id IS ?',
        msg.kind === 'category' ? null : parentId,
      )
      .one().p
    const before = this.snapshot()
    const id = newId()
    this.sql.exec(
      'INSERT INTO channels (id, name, kind, position, parent_id, overwrites) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      name,
      msg.kind,
      position,
      parentId,
      JSON.stringify(overwrites),
    )
    this.audit(userId, 'channel.create', id, `${msg.kind === 'category' ? 'Categoria' : msg.kind === 'voice' ? 'Voz' : 'Texto'}: ${name}`)
    this.pushAccess(before, { changed: [id] })
  }

  /**
   * Confere as exceções de permissão de um canal: só cargos/pessoas que existem
   * e, pra quem não é administrador, só mexendo em permissões que ele mesmo tem.
   */
  private cleanOverwrites(userId: string, value: unknown, current: Overwrite[]): Overwrite[] | string {
    const clean = sanitizeOverwrites(
      value,
      (id) => this.roles().has(id),
      (id) => !!this.member(id),
    )
    if (!clean) return 'Permissões inválidas.'
    if (!this.isAdmin(userId)) {
      // Bits que mudaram em alguma exceção (nova, alterada ou removida).
      const key = (o: Overwrite) => `${o.type}:${o.id}`
      const old = new Map(current.map((o) => [key(o), o]))
      const next = new Map(clean.map((o) => [key(o), o]))
      let changed = 0
      for (const k of new Set([...old.keys(), ...next.keys()])) {
        const a = old.get(k)
        const b = next.get(k)
        changed |= ((a?.allow ?? 0) ^ (b?.allow ?? 0)) | ((a?.deny ?? 0) ^ (b?.deny ?? 0))
      }
      if (changed & ~this.guildPerms(userId)) return 'Você só pode mexer em permissões que você tem.'
    }
    return clean
  }

  private async updateChannel(ws: WebSocket, userId: string, msg: Extract<ClientMessage, { t: 'channel.update' }>) {
    const channel = this.channel(msg.id)
    if (!channel) return
    if (!this.can(userId, channel.id, P.MANAGE_CHANNELS)) return this.error(ws, 'Você não pode editar esse canal.')
    const sets: string[] = []
    const args: SqlStorageValue[] = []
    const changes: string[] = []
    if (msg.name !== undefined) {
      const name = cleanLine(msg.name, 1, 100)
      if (!name) return this.error(ws, 'O nome precisa ter de 1 a 100 caracteres.')
      if (name !== channel.name) {
        sets.push('name = ?')
        args.push(name)
        changes.push(`nome: ${channel.name} → ${name}`)
      }
    }
    if (msg.topic !== undefined && channel.kind === 'text') {
      const topic = cleanText(msg.topic, 1024)
      if (topic === null) return this.error(ws, 'O tópico pode ter até 1024 caracteres.')
      sets.push('topic = ?')
      args.push(topic)
      changes.push('tópico')
    }
    // Mudar de categoria não muda quem vê o canal (as permissões são dele).
    if (msg.parentId !== undefined && channel.kind !== 'category' && msg.parentId !== channel.parentId) {
      if (msg.parentId !== null) {
        if (!this.channel(msg.parentId, 'category')) return this.error(ws, 'Categoria não existe.')
        if (!this.can(userId, msg.parentId, P.MANAGE_CHANNELS)) return this.error(ws, 'Você não pode mexer nessa categoria.')
      }
      // Entra no fim da categoria nova.
      const position = this.sql
        .exec<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels WHERE parent_id IS ?', msg.parentId)
        .one().p
      sets.push('parent_id = ?', 'position = ?')
      args.push(msg.parentId, position)
      changes.push('categoria')
    }
    let overwrites: Overwrite[] | null = null
    if (msg.overwrites !== undefined) overwrites = msg.overwrites
    else if (msg.syncWithCategory && channel.kind !== 'category') {
      const parent = this.channel(msg.parentId !== undefined ? msg.parentId : channel.parentId)
      if (!parent) return this.error(ws, 'Esse canal não está numa categoria.')
      overwrites = parent.overwrites
    }
    let synced: Channel[] = []
    let syncedTo = ''
    if (overwrites !== null) {
      if (!this.can(userId, channel.id, P.MANAGE_ROLES) && !has(this.guildPerms(userId), P.MANAGE_ROLES)) {
        return this.error(ws, 'Você não pode mexer em permissões.')
      }
      const clean = this.cleanOverwrites(userId, overwrites, channel.overwrites)
      if (typeof clean === 'string') return this.error(ws, clean)
      sets.push('overwrites = ?')
      args.push(JSON.stringify(clean))
      changes.push(msg.syncWithCategory ? 'permissões sincronizadas com a categoria' : 'permissões')
      // Categoria: os canais que estavam iguais a ela acompanham a mudança.
      if (channel.kind === 'category') {
        synced = [...this.channels().values()].filter((c) => c.parentId === channel.id && sameOverwrites(c.overwrites, channel.overwrites))
        syncedTo = JSON.stringify(clean)
      }
    }
    if (msg.userLimit !== undefined && channel.kind === 'voice') {
      if (typeof msg.userLimit !== 'number' || !Number.isInteger(msg.userLimit) || msg.userLimit < 0 || msg.userLimit > 99) return
      sets.push('user_limit = ?')
      args.push(msg.userLimit)
      changes.push(`limite: ${msg.userLimit || 'sem limite'}`)
    }
    if (msg.slowmode !== undefined && channel.kind === 'text') {
      if (!SLOWMODES.includes(msg.slowmode)) return
      sets.push('slowmode = ?')
      args.push(msg.slowmode)
      changes.push(`modo lento: ${msg.slowmode ? `${msg.slowmode} s` : 'desligado'}`)
    }
    if (sets.length === 0) return
    const before = this.snapshot()
    this.sql.exec(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`, ...args, channel.id)
    for (const child of synced) this.sql.exec('UPDATE channels SET overwrites = ? WHERE id = ?', syncedTo, child.id)
    this.audit(userId, 'channel.update', channel.id, `#${channel.name}: ${changes.join(', ')}`)
    this.pushAccess(before, { changed: [channel.id, ...synced.map((c) => c.id)] })
  }

  private async reorderChannels(ws: WebSocket, userId: string, msg: Extract<ClientMessage, { t: 'channel.reorder' }>) {
    if (!has(this.guildPerms(userId), P.MANAGE_CHANNELS)) return this.error(ws, 'Você não pode organizar os canais.')
    if (!Array.isArray(msg.order) || msg.order.length > MAX_CHANNELS) return
    const channels = this.channels()
    const updates: { id: string; position: number; parentId: string | null }[] = []
    for (const item of msg.order) {
      if (!item || typeof item !== 'object') return
      const channel = channels.get(item.id)
      // Só mexe no que a pessoa vê e pode organizar (o resto fica onde está).
      if (!channel || !this.can(userId, channel.id, P.MANAGE_CHANNELS)) continue
      if (typeof item.position !== 'number' || !Number.isInteger(item.position) || item.position < 0 || item.position > 10_000) return
      let parentId = item.parentId ?? null
      if (channel.kind === 'category') parentId = null
      else if (parentId !== null && channels.get(parentId)?.kind !== 'category') return
      if (parentId !== channel.parentId && parentId !== null && !this.can(userId, parentId, P.MANAGE_CHANNELS)) continue
      updates.push({ id: channel.id, position: item.position, parentId })
    }
    if (updates.length === 0) return
    const before = this.snapshot()
    for (const u of updates) this.sql.exec('UPDATE channels SET position = ?, parent_id = ? WHERE id = ?', u.position, u.parentId, u.id)
    this.pushAccess(before, { reordered: true })
  }

  private async deleteChannel(ws: WebSocket, userId: string, msg: Extract<ClientMessage, { t: 'channel.delete' }>) {
    const channel = this.channel(msg.id)
    if (!channel) return
    if (!this.can(userId, channel.id, P.MANAGE_CHANNELS)) return this.error(ws, 'Você não pode apagar esse canal.')
    if (channel.kind === 'text' && [...this.channels().values()].filter((c) => c.kind === 'text').length <= 1) {
      return this.error(ws, 'Precisa sobrar pelo menos um canal de texto.')
    }
    const before = this.snapshot()
    // Categoria apagada: os canais dela ficam soltos (como no Discord).
    if (channel.kind === 'category') this.sql.exec('UPDATE channels SET parent_id = NULL WHERE parent_id = ?', channel.id)
    const count = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ?', channel.id).one().n
    const freed = this.store.removeChannel(channel.id)
    this.sql.exec('DELETE FROM mention_index WHERE channel_id = ?', channel.id)
    this.sql.exec('DELETE FROM read_states WHERE channel_id = ?', channel.id)
    this.sql.exec('DELETE FROM slowmode WHERE channel_id = ?', channel.id)
    this.sql.exec('DELETE FROM channels WHERE id = ?', channel.id)
    this.audit(userId, 'channel.delete', channel.id, `${channel.name} (${count} mensagens)`)
    // Quem estava na call desse canal cai fora.
    let voiceChanged = false
    for (const socket of this.sockets()) {
      const s = this.state(socket)
      if (s.voice?.channelId === channel.id) {
        this.save(socket, { ...s, voice: null })
        voiceChanged = true
      }
    }
    for (const ghost of this.ghosts.values()) {
      if (ghost.state.voice?.channelId !== channel.id) continue
      ghost.state = { ...ghost.state, voice: null }
      voiceChanged = true
    }
    this.pushAccess(before, channel.kind === 'category' ? { reordered: true } : {})
    if (voiceChanged) this.broadcastVoice()
    if (freed > 0) await this.reportStorage()
  }

  // ---------- Servidor ----------

  private async updateGuild(ws: WebSocket, userId: string, msg: Extract<ClientMessage, { t: 'guild.update' }>) {
    if (!has(this.guildPerms(userId), P.MANAGE_GUILD)) return this.error(ws, 'Você não pode editar o servidor.')
    const patch: { name?: string; icon?: string | null } = {}
    if (msg.name !== undefined) {
      const name = cleanLine(msg.name, 2, 100)
      if (!name) return this.error(ws, 'O nome do servidor precisa ter de 2 a 100 caracteres.')
      patch.name = name
    }
    if (msg.icon !== undefined) {
      if (msg.icon !== null) {
        if (typeof msg.icon !== 'string' || (await directory(this.env).mediaOwner(msg.icon)) !== userId) {
          return this.error(ws, 'Envie a imagem de novo.')
        }
      }
      patch.icon = msg.icon
    }
    if (Object.keys(patch).length === 0) return
    const info = await directory(this.env).guildUpdated(this.id, patch)
    if (!info) return
    if (patch.name !== undefined) this.setMeta('name', info.name)
    if (patch.icon !== undefined) this.setMeta('icon', info.icon)
    this.audit(userId, 'guild.update', null, [patch.name !== undefined ? `nome: ${patch.name}` : '', patch.icon !== undefined ? 'ícone' : ''].filter(Boolean).join(', '))
    this.broadcast({ t: 'guild.updated', guild: this.info() })
  }

  private async transferGuild(ws: WebSocket, userId: string, msg: Extract<ClientMessage, { t: 'guild.transfer' }>) {
    if (userId !== this.ownerId) return this.error(ws, 'Só o dono pode transferir o servidor.')
    const target = this.member(msg.userId)
    if (!target || target.user_id === userId) return this.error(ws, 'Escolha alguém do servidor.')
    if (this.profile(target.user_id)?.deleted) return this.error(ws, 'Essa conta foi excluída.')
    const before = this.snapshot()
    const info = await directory(this.env).setGuildOwner(this.id, target.user_id)
    if (!info) return this.error(ws, 'Não deu pra transferir agora.')
    this.setMeta('owner_id', target.user_id)
    this.audit(userId, 'guild.update', target.user_id, 'Transferiu o servidor')
    this.pushAccess(before)
    this.broadcast({ t: 'guild.updated', guild: this.info() })
    this.broadcastMember(userId)
    this.broadcastMember(target.user_id)
  }

  // ---------- Cargos ----------

  private async handleRole(
    ws: WebSocket,
    userId: string,
    msg: Extract<ClientMessage, { t: 'role.create' | 'role.update' | 'role.reorder' | 'role.delete' }>,
  ) {
    const perms = this.guildPerms(userId)
    if (!has(perms, P.MANAGE_ROLES)) return this.error(ws, 'Você não pode mexer nos cargos.')
    const owner = userId === this.ownerId
    const admin = this.isAdmin(userId)
    const myTop = this.topOf(userId)
    const roles = this.roles()

    if (msg.t === 'role.create') {
      if (roles.size >= MAX_ROLES) return this.error(ws, `O limite é de ${MAX_ROLES} cargos.`)
      const name = cleanLine(msg.name, 1, 100) ?? 'novo cargo'
      this.sql.exec('UPDATE roles SET position = position + 1 WHERE position >= 1')
      const id = newId()
      this.sql.exec('INSERT INTO roles (id, name, color, position, permissions) VALUES (?, ?, NULL, 1, 0)', id, name)
      this.audit(userId, 'role.create', id, name)
      this.invalidate()
      return this.broadcastRoles()
    }

    if (msg.t === 'role.reorder') {
      if (!Array.isArray(msg.order)) return
      const current = [...roles.values()].filter((r) => r.id !== this.id).sort((a, b) => b.position - a.position)
      const order = msg.order.filter((id): id is string => typeof id === 'string')
      if (order.length !== current.length || new Set(order).size !== order.length || order.some((id) => !roles.has(id) || id === this.id)) {
        return this.error(ws, 'Ordem inválida.')
      }
      // Quem não é dono só mexe abaixo do próprio cargo mais alto: o topo fica igual.
      if (!owner) {
        const locked = current.filter((r) => r.position >= myTop).length
        for (let i = 0; i < locked; i++) if (order[i] !== current[i].id) return this.error(ws, 'Você só pode mover cargos abaixo do seu.')
      }
      const before = this.snapshot()
      order.forEach((id, i) => this.sql.exec('UPDATE roles SET position = ? WHERE id = ?', order.length - i, id))
      this.audit(userId, 'role.update', null, 'Reordenou os cargos')
      this.pushAccess(before)
      return this.broadcastRoles()
    }

    const role = roles.get(msg.id)
    if (!role) return
    const everyone = role.id === this.id
    if (!everyone && !owner && role.position >= myTop) return this.error(ws, 'Você só pode mexer em cargos abaixo do seu.')

    if (msg.t === 'role.delete') {
      if (everyone) return
      const before = this.snapshot()
      this.sql.exec('DELETE FROM roles WHERE id = ?', role.id)
      const affected: string[] = []
      for (const row of this.sql
        .exec<MemberRow>('SELECT * FROM members WHERE roles LIKE ?', `%"${role.id}"%`)
        .toArray()) {
        this.sql.exec('UPDATE members SET roles = ? WHERE user_id = ?', JSON.stringify(parseJsonList(row.roles).filter((r) => r !== role.id)), row.user_id)
        affected.push(row.user_id)
      }
      for (const channel of this.channels().values()) {
        if (channel.overwrites.some((o) => o.id === role.id)) {
          this.sql.exec('UPDATE channels SET overwrites = ? WHERE id = ?', JSON.stringify(channel.overwrites.filter((o) => o.id !== role.id)), channel.id)
        }
      }
      this.audit(userId, 'role.delete', role.id, role.name)
      this.pushAccess(before)
      this.broadcastRoles()
      for (const id of affected) this.broadcastMember(id)
      return
    }

    // role.update
    const sets: string[] = []
    const args: SqlStorageValue[] = []
    const changes: string[] = []
    if (msg.name !== undefined && !everyone) {
      const name = cleanLine(msg.name, 1, 100)
      if (!name) return this.error(ws, 'O nome do cargo precisa ter de 1 a 100 caracteres.')
      sets.push('name = ?')
      args.push(name)
      if (name !== role.name) changes.push(`nome: ${role.name} → ${name}`)
    }
    if (msg.color !== undefined && !everyone) {
      const value = color(msg.color)
      if (value === undefined) return this.error(ws, 'Cor inválida.')
      sets.push('color = ?')
      args.push(value)
      changes.push('cor')
    }
    if (msg.permissions !== undefined) {
      if (typeof msg.permissions !== 'number' || !Number.isInteger(msg.permissions) || msg.permissions < 0) return
      const next = msg.permissions & ALL_PERMISSIONS
      const added = next & ~role.permissions
      if (!admin && added & ~perms) return this.error(ws, 'Você só pode dar permissões que você tem.')
      if (added & P.ADMINISTRATOR && !admin) return this.error(ws, 'Só um administrador pode dar administrador.')
      sets.push('permissions = ?')
      args.push(next)
      changes.push('permissões')
    }
    if (msg.hoist !== undefined && !everyone) {
      sets.push('hoist = ?')
      args.push(msg.hoist ? 1 : 0)
      changes.push(msg.hoist ? 'aparece separado' : 'não aparece separado')
    }
    if (msg.mentionable !== undefined && !everyone) {
      sets.push('mentionable = ?')
      args.push(msg.mentionable ? 1 : 0)
      changes.push(msg.mentionable ? 'mencionável' : 'não mencionável')
    }
    if (sets.length === 0) return
    const before = this.snapshot()
    this.sql.exec(`UPDATE roles SET ${sets.join(', ')} WHERE id = ?`, ...args, role.id)
    this.audit(userId, 'role.update', role.id, `${everyone ? '@everyone' : role.name}: ${changes.join(', ')}`)
    this.pushAccess(before)
    this.broadcastRoles()
    // A 0.5 mostra quem é admin pelo `user.admin`.
    if (msg.permissions !== undefined) for (const row of this.members()) this.broadcastMember(row.user_id)
  }

  // ---------- Membros e moderação ----------

  private async handleMember(
    ws: WebSocket,
    userId: string,
    msg: Extract<
      ClientMessage,
      { t: 'member.roles' | 'member.nick' | 'member.kick' | 'member.ban' | 'member.unban' | 'member.timeout' | 'member.voice' }
    >,
  ) {
    const perms = this.guildPerms(userId)
    const targetId = typeof msg.userId === 'string' ? msg.userId : ''
    const target = this.member(targetId)
    const self = targetId === userId
    const owner = userId === this.ownerId
    const name = this.profile(targetId)?.name ?? 'alguém'

    switch (msg.t) {
      case 'member.roles': {
        if (!target || !has(perms, P.MANAGE_ROLES)) return this.error(ws, 'Você não pode mexer nos cargos de ninguém.')
        if (!self && !this.outranks(userId, targetId)) return this.error(ws, 'Essa pessoa está acima de você.')
        if (!Array.isArray(msg.roles) || msg.roles.length > MAX_ROLES) return
        const roles = this.roles()
        const next = [...new Set(msg.roles.filter((id): id is string => typeof id === 'string' && roles.has(id) && id !== this.id))]
        const old = parseJsonList(target.roles)
        const added = next.filter((id) => !old.includes(id))
        const removed = old.filter((id) => !next.includes(id) && roles.has(id))
        if (added.length === 0 && removed.length === 0) return
        const myTop = this.topOf(userId)
        if (!owner && [...added, ...removed].some((id) => roles.get(id)!.position >= myTop)) {
          return this.error(ws, 'Você só pode dar ou tirar cargos abaixo do seu.')
        }
        const before = this.snapshot()
        this.sql.exec('UPDATE members SET roles = ? WHERE user_id = ?', JSON.stringify(next), targetId)
        const describe = (ids: string[], sign: string) => ids.map((id) => `${sign}${roles.get(id)?.name}`)
        this.audit(userId, 'member.roles', targetId, `${name}: ${[...describe(added, '+'), ...describe(removed, '−')].join(', ')}`)
        this.pushAccess(before)
        return this.broadcastMember(targetId)
      }

      case 'member.nick': {
        if (!target) return
        if (self ? !has(perms, P.CHANGE_NICKNAME) : !has(perms, P.MANAGE_NICKNAMES) || !this.outranks(userId, targetId)) {
          return this.error(ws, 'Você não pode mudar esse apelido.')
        }
        const nick = msg.nick === null || msg.nick === '' ? null : cleanLine(msg.nick, 1, 32)
        if (msg.nick && !nick) return this.error(ws, 'O apelido precisa ter de 1 a 32 caracteres.')
        this.sql.exec('UPDATE members SET nick = ? WHERE user_id = ?', nick, targetId)
        if (!self) this.audit(userId, 'member.nick', targetId, `${name}: ${nick ?? '(sem apelido)'}`)
        return this.broadcastMember(targetId)
      }

      case 'member.kick': {
        if (!target || !has(perms, P.KICK_MEMBERS)) return this.error(ws, 'Você não pode expulsar ninguém.')
        if (self || !this.outranks(userId, targetId)) return this.error(ws, 'Essa pessoa está acima de você.')
        const reason = cleanText(msg.reason ?? '', 512) ?? ''
        this.audit(userId, 'member.kick', targetId, `${name}${reason ? `: ${reason}` : ''}`)
        this.removeMember(targetId, 'Você foi expulso do servidor')
        await directory(this.env).memberKicked(this.id, targetId, 'kicked')
        return
      }

      case 'member.ban': {
        if (!has(perms, P.BAN_MEMBERS)) return this.error(ws, 'Você não pode banir ninguém.')
        if (self || targetId === this.ownerId) return this.error(ws, 'Não dá pra banir essa pessoa.')
        if (target && !this.outranks(userId, targetId)) return this.error(ws, 'Essa pessoa está acima de você.')
        if (!target && !this.profile(targetId)) return this.error(ws, 'Pessoa não encontrada.')
        const reason = cleanText(msg.reason ?? '', 512) ?? ''
        this.sql.exec(
          `INSERT INTO bans (user_id, reason, actor_id, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET reason = excluded.reason, actor_id = excluded.actor_id, created_at = excluded.created_at`,
          targetId,
          reason,
          userId,
          Date.now(),
        )
        this.audit(userId, 'member.ban', targetId, `${name}${reason ? `: ${reason}` : ''}`)
        if (msg.deleteMessages) await this.deleteRecentMessages(targetId, 7 * DAY)
        if (target) {
          this.removeMember(targetId, 'Você foi banido do servidor')
          await directory(this.env).memberKicked(this.id, targetId, 'banned')
        }
        return
      }

      case 'member.unban': {
        if (!has(perms, P.BAN_MEMBERS)) return
        this.sql.exec('DELETE FROM bans WHERE user_id = ?', targetId)
        this.audit(userId, 'member.unban', targetId, name)
        return
      }

      case 'member.timeout': {
        if (!target || !has(perms, P.MODERATE_MEMBERS)) return this.error(ws, 'Você não pode castigar ninguém.')
        if (self || !this.outranks(userId, targetId)) return this.error(ws, 'Essa pessoa está acima de você.')
        if (this.isAdmin(targetId)) return this.error(ws, 'Não dá pra castigar um administrador.')
        if (!TIMEOUT_MINUTES.includes(msg.minutes)) return
        const until = msg.minutes === 0 ? null : Date.now() + msg.minutes * MINUTE
        const reason = cleanText(msg.reason ?? '', 512) ?? ''
        const before = this.snapshot()
        this.sql.exec('UPDATE members SET timeout_until = ? WHERE user_id = ?', until, targetId)
        this.audit(userId, 'member.timeout', targetId, `${name}: ${msg.minutes ? `${msg.minutes} min` : 'tirou o castigo'}${reason ? ` — ${reason}` : ''}`)
        this.pushAccess(before)
        return this.broadcastMember(targetId)
      }

      case 'member.voice': {
        if (!target) return
        if (!self && !this.outranks(userId, targetId)) return this.error(ws, 'Essa pessoa está acima de você.')
        const details: string[] = []
        if (msg.serverMuted !== undefined) {
          if (!has(perms, P.MUTE_MEMBERS)) return this.error(ws, 'Você não pode mutar ninguém.')
          this.sql.exec('UPDATE members SET server_muted = ? WHERE user_id = ?', msg.serverMuted ? 1 : 0, targetId)
          details.push(msg.serverMuted ? 'mutou' : 'desmutou')
        }
        if (msg.serverDeafened !== undefined) {
          if (!has(perms, P.DEAFEN_MEMBERS)) return this.error(ws, 'Você não pode ensurdecer ninguém.')
          this.sql.exec('UPDATE members SET server_deafened = ? WHERE user_id = ?', msg.serverDeafened ? 1 : 0, targetId)
          details.push(msg.serverDeafened ? 'ensurdeceu' : 'tirou o ensurdecer')
        }
        if (msg.disconnect || msg.moveTo !== undefined) {
          if (!has(perms, P.MOVE_MEMBERS)) return this.error(ws, 'Você não pode mover ninguém.')
          if (msg.disconnect) {
            this.forceVoice(targetId, null)
            details.push('desconectou da call')
          } else {
            const dest = this.channel(msg.moveTo, 'voice')
            if (!dest || !this.can(userId, dest.id, P.CONNECT) || !this.can(targetId, dest.id, P.VIEW_CHANNEL)) {
              return this.error(ws, 'Não dá pra mover pra esse canal.')
            }
            this.forceVoice(targetId, dest.id)
            details.push(`moveu pra ${dest.name}`)
          }
        }
        if (details.length === 0) return
        if (!self) this.audit(userId, 'member.voice', targetId, `${name}: ${details.join(', ')}`)
        this.broadcastMember(targetId)
        return this.broadcastVoice()
      }
    }
  }

  /** Apaga as mensagens recentes de alguém (ao banir). */
  private async deleteRecentMessages(authorId: string, window: number) {
    const since = (Date.now() - window).toString(36).padStart(10, '0')
    for (;;) {
      const rows = this.sql
        .exec<MessageRow>('SELECT * FROM messages WHERE author_id = ? AND id >= ? AND channel_id NOT LIKE ? LIMIT 200', authorId, since, 'dm:%')
        .toArray()
      if (rows.length === 0) break
      this.store.removeRows(rows)
      this.dropMentions(rows.map((r) => r.id))
      for (const r of rows) this.broadcast({ t: 'chat.deleted', id: r.id, channelId: r.channel_id }, { channelId: r.channel_id })
    }
    await this.reportStorage()
  }

  /** Tira alguém do servidor aqui dentro (o Directory cuida do resto). */
  private removeMember(userId: string, reason: string) {
    if (!this.member(userId)) return
    const sockets = this.socketsOf(userId)
    const dropped = this.dropGhosts((s) => s.userId === userId)
    const hadVoice = dropped.voice || sockets.some((ws) => this.state(ws).voice)
    const hadMap = dropped.map || sockets.some((ws) => this.state(ws).map)
    for (const ws of sockets) ws.close(4003, reason)
    this.sql.exec('DELETE FROM members WHERE user_id = ?', userId)
    this.sql.exec('DELETE FROM read_states WHERE user_id = ?', userId)
    this.sql.exec('DELETE FROM mention_index WHERE user_id = ?', userId)
    this.sql.exec('DELETE FROM notify WHERE user_id = ?', userId)
    this.sql.exec('DELETE FROM slowmode WHERE user_id = ?', userId)
    this.invalidate()
    this.broadcast({ t: 'member.removed', userId })
    if (sockets.length > 0) this.broadcast({ t: 'presence', userId, online: false, presence: { status: 'offline', text: null } })
    if (hadVoice) this.broadcastVoice()
    if (hadMap) this.leftMap()
  }

  // ---------- Mapa compartilhado ----------

  /** Quem está com o mapa aberto (os fantasmas contam: caíram e ainda podem voltar), na ordem em que entrou. */
  private mapViewers(exceptConnId?: string): MapViewer[] {
    return [...this.sockets(exceptConnId).map((ws) => this.state(ws)), ...this.ghostStates(exceptConnId)]
      .filter((s) => !!s.map)
      .sort((a, b) => a.map! - b.map!)
      .map(({ connId, userId, street }) => ({ connId, userId, ...(street ? { street } : {}) }))
  }

  /** Vista, cursores e marcadores só vão pra quem está com o mapa aberto. */
  private toMap(msg: ServerMessage, exceptConnId?: string) {
    const text = JSON.stringify(msg)
    for (const ws of this.sockets(exceptConnId)) if (this.state(ws).map) this.raw(ws, text)
  }

  /** Alguém saiu do mapa: todo mundo atualiza quem está lá; sem ninguém, a vista vai pro banco já. */
  private leftMap(exceptConnId?: string) {
    const viewers = this.mapViewers(exceptConnId)
    this.broadcast({ t: 'map.viewers', viewers }, { except: exceptConnId })
    if (viewers.length === 0) this.flushMapView()
  }

  private currentMapView(): MapView | null {
    if (this.mapView === undefined) this.mapView = parseView(this.meta('map_view'))
    return this.mapView
  }

  private storeMapView(view: MapView) {
    this.mapView = view
    this.mapDirty = true
    if (this.mapSaveTimer) return
    this.mapSaveTimer = setTimeout(() => this.flushMapView(), Math.max(0, this.mapSavedAt + MAP_SAVE_EVERY - Date.now()))
  }

  private flushMapView() {
    if (this.mapSaveTimer) clearTimeout(this.mapSaveTimer)
    this.mapSaveTimer = null
    if (!this.mapDirty || !this.mapView || !this.id) return
    this.mapDirty = false
    this.mapSavedAt = Date.now()
    this.setMeta('map_view', JSON.stringify(this.mapView))
  }

  private mapPins(): MapPin[] {
    return this.sql
      .exec<{ id: string; author_id: string; lng: number; lat: number; label: string; color: number; created_at: number }>(
        'SELECT * FROM map_pins ORDER BY id',
      )
      .toArray()
      .map((r) => ({ id: r.id, authorId: r.author_id, lng: r.lng, lat: r.lat, label: r.label, color: r.color, createdAt: r.created_at }))
  }

  /** Vista e cursor: muitas por segundo, então não passam pelo `handle` (nem pelo limite geral). */
  private mapMotion(state: ConnState, msg: Extract<ClientMessage, { t: 'map.view' | 'map.cursor' }>, member: MemberRow) {
    // De castigo, a pessoa olha o mapa mas não mexe no dos outros.
    if (!state.map || this.timedOut(member)) return
    if (msg.t === 'map.view') {
      const view = cleanView(msg.view)
      if (!view) return
      this.storeMapView(view)
      return this.toMap({ t: 'map.view', view, connId: state.connId, userId: state.userId }, state.connId)
    }
    const at = msg.lng === null || msg.lat === null ? null : cleanPoint(msg.lng, msg.lat)
    if (at === null && (msg.lng !== null || msg.lat !== null)) return
    this.toMap({ t: 'map.cursor', connId: state.connId, userId: state.userId, lng: at?.lng ?? null, lat: at?.lat ?? null }, state.connId)
  }

  private handleMap(
    ws: WebSocket,
    state: ConnState,
    msg: Extract<ClientMessage, { t: 'map.join' | 'map.leave' | 'map.street' | 'map.pin.add' | 'map.pin.remove' }>,
  ) {
    const userId = state.userId
    switch (msg.t) {
      case 'map.join': {
        // De novo (o app reconectou com o mapa aberto): só manda o estado, ninguém vê entrar outra vez.
        const joined = !state.map
        if (joined) this.save(ws, { ...state, map: Date.now() })
        const viewers = this.mapViewers()
        this.send(ws, { t: 'map.state', view: this.currentMapView(), pins: this.mapPins(), viewers })
        if (joined) this.broadcast({ t: 'map.viewers', viewers }, { except: state.connId })
        return
      }

      case 'map.leave':
        if (!state.map) return
        this.save(ws, { ...state, map: undefined, street: undefined })
        return this.leftMap()

      case 'map.street': {
        if (!state.map) return
        const street = msg.at === null ? undefined : (cleanStreet(msg.at) ?? undefined)
        if (msg.at !== null && !street) return
        this.save(ws, { ...state, street })
        return this.broadcast({ t: 'map.viewers', viewers: this.mapViewers() })
      }

      case 'map.pin.add': {
        if (this.timedOut(this.member(userId))) return this.error(ws, 'Você está de castigo e não pode marcar lugares agora.')
        const at = cleanPoint(msg.lng, msg.lat)
        const label = cleanLine(msg.label, 1, MAX_MAP_PIN_LABEL)
        const tint = color(msg.color)
        if (!at || !label || tint === null || tint === undefined) return this.error(ws, 'Marcador inválido.')
        if (!this.allow(`pin:${userId}`, 10, MINUTE)) return this.error(ws, 'Calma! Marcadores demais de uma vez.')
        if (this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM map_pins').one().n >= MAX_MAP_PINS) {
          return this.error(ws, `O mapa já tem ${MAX_MAP_PINS} marcadores. Apague algum antes.`)
        }
        const pin: MapPin = { id: newId(), authorId: userId, ...at, label, color: tint, createdAt: Date.now() }
        this.sql.exec(
          'INSERT INTO map_pins (id, author_id, lng, lat, label, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          pin.id,
          pin.authorId,
          pin.lng,
          pin.lat,
          pin.label,
          pin.color,
          pin.createdAt,
        )
        return this.toMap({ t: 'map.pin', pin })
      }

      case 'map.pin.remove': {
        if (typeof msg.id !== 'string') return
        const row = this.sql.exec<{ author_id: string }>('SELECT author_id FROM map_pins WHERE id = ?', msg.id).toArray()[0]
        if (!row) return
        if (row.author_id !== userId && !has(this.guildPerms(userId), P.MANAGE_MESSAGES)) {
          return this.error(ws, 'Só quem marcou (ou um moderador) apaga esse marcador.')
        }
        this.sql.exec('DELETE FROM map_pins WHERE id = ?', msg.id)
        return this.toMap({ t: 'map.pin.removed', id: msg.id })
      }
    }
  }

  // ---------- Chamadas do Directory (RPC) ----------

  /** Servidor novo: cargo @everyone, o dono e os canais iniciais. */
  async setup(info: GuildInfo, owner: User) {
    if (this.id) return
    this.id = info.id
    this.setMeta('guild_id', info.id)
    this.setMeta('name', info.name)
    this.setMeta('owner_id', info.ownerId)
    if (info.icon) this.setMeta('icon', info.icon)
    this.sql.exec(
      "INSERT INTO roles (id, name, color, position, permissions) VALUES (?, '@everyone', NULL, 0, ?) ON CONFLICT DO NOTHING",
      info.id,
      DEFAULT_PERMISSIONS,
    )
    this.saveProfile(owner)
    this.sql.exec('INSERT INTO members (user_id, joined_at) VALUES (?, ?) ON CONFLICT DO NOTHING', owner.id, Date.now())
    const text = newId()
    const voice = newId()
    this.sql.exec("INSERT INTO channels (id, name, kind, position) VALUES (?, 'Canais de texto', 'category', 0)", text)
    this.sql.exec("INSERT INTO channels (id, name, kind, position) VALUES (?, 'Canais de voz', 'category', 1)", voice)
    this.sql.exec("INSERT INTO channels (id, name, kind, position, parent_id) VALUES (?, 'geral', 'text', 0, ?)", newId(), text)
    this.sql.exec("INSERT INTO channels (id, name, kind, position, parent_id) VALUES (?, 'Geral', 'voice', 0, ?)", newId(), voice)
    this.invalidate()
  }

  /** Dados da 0.5 que só o Space "main" tem (contas, sessões, convites, conversas privadas). */
  exportLegacy(): LegacyExport {
    const tables = new Set(
      this.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((r) => r.name),
    )
    if (!tables.has('users')) return { users: [], sessions: [], invites: [], dmChannels: [] }
    return {
      users: this.sql
        .exec<LegacyExport['users'][number] & Record<string, SqlStorageValue>>(
          'SELECT id, name, pass_hash, pass_salt, admin, created_at FROM users',
        )
        .toArray(),
      sessions: tables.has('sessions')
        ? this.sql
            .exec<LegacyExport['sessions'][number] & Record<string, SqlStorageValue>>('SELECT token_hash, user_id, created_at FROM sessions')
            .toArray()
        : [],
      invites: tables.has('invites')
        ? this.sql
            .exec<LegacyExport['invites'][number] & Record<string, SqlStorageValue>>(
              'SELECT code, created_by, created_at, used_by FROM invites',
            )
            .toArray()
        : [],
      dmChannels: this.sql
        .exec<{ channel_id: string }>("SELECT DISTINCT channel_id FROM messages WHERE channel_id LIKE 'dm:%'")
        .toArray()
        .map((r) => r.channel_id),
    }
  }

  /** O Directory já copiou as contas: este vira o servidor do grupo, com todo mundo dentro. */
  legacyImported(info: GuildInfo, profiles: User[]) {
    if (this.id) return
    this.id = info.id
    this.setMeta('guild_id', info.id)
    this.setMeta('name', info.name)
    this.setMeta('owner_id', info.ownerId)
    this.sql.exec(
      "INSERT INTO roles (id, name, color, position, permissions) VALUES (?, '@everyone', NULL, 0, ?) ON CONFLICT DO NOTHING",
      info.id,
      DEFAULT_PERMISSIONS,
    )
    const joined = new Map(
      this.sql
        .exec<{ id: string; created_at: number }>('SELECT id, created_at FROM users')
        .toArray()
        .map((r) => [r.id, r.created_at]),
    )
    for (const profile of profiles) {
      this.saveProfile(profile)
      this.sql.exec(
        'INSERT INTO members (user_id, joined_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
        profile.id,
        joined.get(profile.id) ?? Date.now(),
      )
    }
    this.invalidate()
    // Ninguém começa com tudo "não lido" depois da atualização.
    for (const profile of profiles) this.markAllRead(profile.id)
  }

  /** Um lote das mensagens de uma conversa privada antiga (a migração vai copiando). */
  legacyDmBatch(channelId: string, afterId: string): { messages: MessageRow[]; attachments: AttachmentRow[] } {
    const messages = this.sql
      .exec<MessageRow>('SELECT * FROM messages WHERE channel_id = ? AND id > ? ORDER BY id LIMIT 200', channelId, afterId)
      .toArray()
    const attachments =
      messages.length === 0
        ? []
        : this.sql
            .exec<AttachmentRow>(`SELECT * FROM attachments WHERE message_id ${IN_LIST}`, list(messages.map((m) => m.id)))
            .toArray()
    return { messages, attachments }
  }

  async dropLegacyDm(channelId: string) {
    if (!dmMembers(channelId)) return
    if (this.store.removeChannel(channelId) > 0) await this.reportStorage()
  }

  isBanned(userId: string): boolean {
    return this.sql.exec('SELECT 1 FROM bans WHERE user_id = ?', userId).toArray().length > 0
  }

  addMember(user: User) {
    if (!this.id || this.member(user.id)) return
    this.saveProfile(user)
    this.sql.exec('INSERT INTO members (user_id, joined_at) VALUES (?, ?)', user.id, Date.now())
    this.invalidate()
    this.markAllRead(user.id)
    this.broadcastMember(user.id)
  }

  /** Saiu do servidor ou excluiu a conta. */
  memberRemoved(userId: string, user: User | null) {
    if (user && this.saveProfile(user)) this.broadcast({ t: 'user.upsert', user: this.user(userId)! })
    this.removeMember(userId, 'Você saiu do servidor')
  }

  profileUpdated(user: User) {
    if (!this.saveProfile(user)) return
    if (this.member(user.id)) this.broadcastMember(user.id)
    else this.broadcast({ t: 'user.upsert', user: this.user(user.id)! })
  }

  /** Sessões encerradas (sair, trocar senha, derrubar aparelho): fecha as conexões delas. */
  closeSessions(tokenHashes: string[]) {
    const set = new Set(tokenHashes)
    for (const ws of this.ctx.getWebSockets()) {
      const state = this.state(ws)
      if (state.pending || !set.has(state.session)) continue
      ws.close(4001, 'Sessão encerrada')
      this.dropConnection(ws, state, false)
    }
    const dropped = this.dropGhosts((s) => set.has(s.session))
    if (dropped.voice) this.broadcastVoice()
    if (dropped.map) this.leftMap()
  }

  async destroy() {
    this.dropGhosts(() => true)
    // Nada de gravar a vista do mapa depois de apagar tudo.
    if (this.mapSaveTimer) clearTimeout(this.mapSaveTimer)
    this.mapSaveTimer = null
    this.mapView = undefined
    this.mapDirty = false
    for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'Servidor excluído')
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.id = ''
    this.invalidate()
  }
}
