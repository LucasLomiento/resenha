import { DurableObject } from 'cloudflare:workers'
import {
  MAX_ANIMATED_BYTES,
  MAX_AVATAR_BYTES,
  MAX_BANNER_BYTES,
  MAX_GUILDS_PER_USER,
  type AuthResponse,
  type DmPolicy,
  type Friend,
  type GuildInfo,
  type Invite,
  type InvitePreview,
  type Me,
  type SessionInfo,
  type User,
} from '../../shared/protocol'
import { hashPassword, hashToken, randomToken, verifyPassword } from './auth'
import { newId } from './ids'
import { columns } from './messages'
import { conversation as conversationStub, guild as guildStub, home as homeStub } from './stubs'
import { applyStylePatch, isAnimated, parseStyle, publicStyle, styleText } from './style'
import { cleanLine, cleanText, color, passwordProblem, slugUsername, username as validUsername } from './validate'
import { MAX_USAGE_REPORT, MEASURE_EVERY, MEDIA_BUDGET, analyticsConfig, measuredUsage, usageMonth } from './media'

// O Directory é o cadastro central: contas, sessões, limites de tentativa,
// fotos de perfil, a lista de servidores e quem é membro de qual, convites,
// amizades e bloqueios. Um só pra plataforma inteira.

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string }
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error })
const ok = <T>(value: T): Result<T> => ({ ok: true, value })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** Sessão parada por mais que isso expira. */
const SESSION_IDLE = 30 * DAY
/** Atualiza o "visto por último" no máximo de hora em hora (poupa escrita). */
const SEEN_EVERY = HOUR

const FLAG_STAFF = 1
const FLAG_BANNED = 2
const FLAG_DELETED = 4

/** Teto de anexos da plataforma inteira (o plano grátis tem 5 GB pra tudo). */
const STORAGE_LIMIT = 4 * 1024 ** 3
/** Quanto cada pessoa pode enviar por dia (a dona da plataforma não tem limite). */
const USER_DAILY_UPLOAD = 500 * 1024 ** 2
/** Reserva de envio que não fechou nesse tempo deixa de contar. */
const RESERVATION_TTL = 15 * MINUTE

const INVITE_AGES = [0, 1800, 3600, 6 * 3600, 12 * 3600, 86400, 7 * 86400]
const INVITE_USES = [1, 5, 10, 25, 50, 100]

interface UserRow {
  id: string
  username: string
  name: string
  pass_hash: string
  pass_salt: string
  avatar: string | null
  bio: string
  accent: number | null
  /** Personalização do perfil (JSON, ver style.ts). */
  style: string | null
  flags: number
  dm_policy: string
  created_at: number
  password_changed_at: number
  [key: string]: SqlStorageValue
}

interface SessionRow {
  id: string
  token_hash: string
  user_id: string
  device: string
  country: string | null
  created_at: number
  last_seen_at: number
  expires_at: number
  [key: string]: SqlStorageValue
}

interface GuildRow {
  id: string
  name: string
  icon: string | null
  owner_id: string
  created_at: number
  [key: string]: SqlStorageValue
}

interface InviteRow {
  code: string
  guild_id: string
  inviter_id: string
  created_at: number
  expires_at: number | null
  max_uses: number | null
  uses: number
  [key: string]: SqlStorageValue
}

export interface ClientInfo {
  device: string
  /** IP já embaralhado (hashIp) — nunca o IP puro. */
  ipHash: string
  country: string | null
}

export interface AuthContext {
  me: Me
  sessionId: string
  tokenHash: string
}

/** Dados da 0.5 que vêm do Space "main" na migração. */
export interface LegacyExport {
  users: { id: string; name: string; pass_hash: string; pass_salt: string; admin: number; created_at: number }[]
  sessions: { token_hash: string; user_id: string; created_at: number }[]
  invites: { code: string; created_by: string; created_at: number; used_by: string | null }[]
  dmChannels: string[]
}

function imageType(bytes: Uint8Array): string | null {
  const b = bytes
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp'
  return null
}

/** 524288 -> "512 KB", 1572864 -> "1,5 MB". */
const sizeLabel = (bytes: number) =>
  bytes >= 1024 ** 2 ? `${String(Math.round((bytes / 1024 ** 2) * 10) / 10).replace('.', ',')} MB` : `${Math.round(bytes / 1024)} KB`

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])

export class Directory extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    ctx.blockConcurrencyWhile(async () => {
      this.schema()
      await this.importLegacy()
    })
  }

  private schema() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      pass_salt TEXT NOT NULL,
      avatar TEXT,
      bio TEXT NOT NULL DEFAULT '',
      accent INTEGER,
      flags INTEGER NOT NULL DEFAULT 0,
      dm_policy TEXT NOT NULL DEFAULT 'servers',
      created_at INTEGER NOT NULL,
      password_changed_at INTEGER NOT NULL
    )`)
    // 1.1: personalização do perfil (coluna nova; as contas antigas ficam com NULL = padrão).
    if (!columns(this.sql, 'users').has('style')) this.sql.exec('ALTER TABLE users ADD COLUMN style TEXT')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      device TEXT NOT NULL,
      country TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id)')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS limits (
      key TEXT PRIMARY KEY,
      failures INTEGER NOT NULL,
      window_start INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL DEFAULT 0
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      type TEXT NOT NULL,
      bytes BLOB NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      done INTEGER NOT NULL DEFAULT 0
    )`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS reservations_by_user ON reservations (user_id, created_at)')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS guilds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT,
      owner_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS members (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS members_by_user ON members (user_id)')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      inviter_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      max_uses INTEGER,
      uses INTEGER NOT NULL DEFAULT 0
    )`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS invites_by_guild ON invites (guild_id)')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS friendships (
      low TEXT NOT NULL,
      high TEXT NOT NULL,
      state TEXT NOT NULL,
      requester TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (low, high)
    )`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS friendships_by_high ON friendships (high)')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS blocks (
      blocker TEXT NOT NULL,
      blocked TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (blocker, blocked)
    )`)
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    // Apelido da 0.5 (com espaço, maiúscula…) que continua servindo pra entrar.
    this.sql.exec('CREATE TABLE IF NOT EXISTS aliases (alias TEXT PRIMARY KEY, user_id TEXT NOT NULL)')
    // Espaço de anexos usado por servidor/conversa ("g:<id>" ou "c:<id>").
    this.sql.exec('CREATE TABLE IF NOT EXISTS storage (scope TEXT PRIMARY KEY, bytes INTEGER NOT NULL)')
    // GB de mídia que passaram pelo Cloudflare (SFU e TURN) por mês: contados pelos
    // apps (bytes) e medidos pelo próprio Cloudflare (measured, conferido de hora em hora).
    this.sql.exec('CREATE TABLE IF NOT EXISTS media_usage (month TEXT PRIMARY KEY, bytes INTEGER NOT NULL, measured INTEGER NOT NULL DEFAULT 0)')
  }

  // ---------- Mídia pelo Cloudflare (media.ts) ----------

  /** Quanto já passou pelo Cloudflare neste mês (o maior entre a conta dos apps e a medida), e se ainda cabe no grátis. */
  mediaUsage(): { month: string; bytes: number; allowed: boolean } {
    const month = usageMonth()
    const row = this.sql.exec<{ bytes: number; measured: number }>('SELECT bytes, measured FROM media_usage WHERE month = ?', month).toArray()[0]
    const bytes = Math.max(row?.bytes ?? 0, row?.measured ?? 0)
    this.ctx.waitUntil(this.measureMedia())
    return { month, bytes, allowed: bytes < MEDIA_BUDGET }
  }

  private measuring: Promise<void> | null = null

  /** Confere o que o Cloudflare mediu no mês (no máximo de hora em hora; sem o token, nada). */
  measureMedia(now = Date.now()): Promise<void> {
    const config = analyticsConfig(this.env)
    if (!config || this.measuring || now - Number(this.meta('media_measured_at') ?? 0) < MEASURE_EVERY) return this.measuring ?? Promise.resolve()
    this.setMeta('media_measured_at', String(now))
    this.measuring = measuredUsage(config, now)
      .then((measured) => {
        this.sql.exec(
          'INSERT INTO media_usage (month, bytes, measured) VALUES (?, 0, ?) ON CONFLICT (month) DO UPDATE SET measured = excluded.measured',
          usageMonth(now),
          measured,
        )
      })
      .catch((err) => console.error('[mídia] não deu pra conferir o uso no Cloudflare:', (err as Error).message))
      .finally(() => (this.measuring = null))
    return this.measuring
  }

  /** O app conta o que recebeu pelo SFU e o que passou pelo TURN (a cada minuto). */
  addMediaUsage(bytes: number): { month: string; bytes: number; allowed: boolean } {
    const amount = Math.min(MAX_USAGE_REPORT, Math.max(0, Math.round(Number.isFinite(bytes) ? bytes : 0)))
    if (amount > 0) {
      this.sql.exec(
        'INSERT INTO media_usage (month, bytes) VALUES (?, ?) ON CONFLICT (month) DO UPDATE SET bytes = bytes + excluded.bytes',
        usageMonth(),
        amount,
      )
    }
    return this.mediaUsage()
  }

  private meta(key: string): string | null {
    return this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value ?? null
  }

  private setMeta(key: string, value: string) {
    this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value)
  }

  // ---------- Stubs dos outros DOs ----------

  private guild(id: string) {
    return guildStub(this.env, id)
  }

  private home(userId: string) {
    return homeStub(this.env, userId)
  }

  private conversation(id: string) {
    return conversationStub(this.env, id)
  }

  // ---------- Perfis ----------

  private user(id: string): UserRow | null {
    return this.sql.exec<UserRow>('SELECT * FROM users WHERE id = ?', id).toArray()[0] ?? null
  }

  private toUser(row: UserRow): User {
    const deleted = (row.flags & FLAG_DELETED) !== 0
    const style = deleted ? undefined : publicStyle(parseStyle(row.style), (row.flags & FLAG_STAFF) !== 0)
    return {
      id: row.id,
      username: row.username,
      name: row.name,
      avatar: row.avatar,
      bio: row.bio,
      accent: row.accent,
      admin: false,
      ...(deleted ? { deleted: true } : {}),
      ...(style ? { style } : {}),
    }
  }

  private toMe(row: UserRow): Me {
    return {
      ...this.toUser(row),
      staff: (row.flags & FLAG_STAFF) !== 0,
      dmPolicy: row.dm_policy as DmPolicy,
      createdAt: row.created_at,
    }
  }

  getUsers(ids: string[]): User[] {
    const unique = [...new Set(ids)].slice(0, 1000)
    if (unique.length === 0) return []
    return this.sql
      .exec<UserRow>('SELECT * FROM users WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(unique))
      .toArray()
      .map((row) => this.toUser(row))
  }

  getUser(id: string): User | null {
    const row = this.user(id)
    return row ? this.toUser(row) : null
  }

  findByUsername(name: string): User | null {
    const row = this.sql.exec<UserRow>('SELECT * FROM users WHERE username = ?', name.trim().toLowerCase()).toArray()[0]
    return row && !(row.flags & FLAG_DELETED) ? this.toUser(row) : null
  }

  // ---------- Limites de tentativa (persistentes) ----------

  /** Quanto falta (ms) pra liberar a chave; 0 = pode tentar. */
  private waitFor(key: string, now = Date.now()): number {
    const row = this.sql.exec<{ blocked_until: number }>('SELECT blocked_until FROM limits WHERE key = ?', key).toArray()[0]
    return row && row.blocked_until > now ? row.blocked_until - now : 0
  }

  /**
   * Conta uma falha. Passou de `max` na janela: bloqueia por `block`, dobrando
   * a cada falha a mais (até 1 hora).
   */
  private failure(key: string, max: number, window: number, block: number, now = Date.now()) {
    const row = this.sql
      .exec<{ failures: number; window_start: number }>('SELECT failures, window_start FROM limits WHERE key = ?', key)
      .toArray()[0]
    const fresh = !row || now - row.window_start > window
    const failures = (fresh ? 0 : row.failures) + 1
    const windowStart = fresh ? now : row.window_start
    const blockedUntil = failures >= max ? now + Math.min(block * 2 ** (failures - max), HOUR) : 0
    this.sql.exec(
      `INSERT INTO limits (key, failures, window_start, blocked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET failures = excluded.failures, window_start = excluded.window_start,
       blocked_until = excluded.blocked_until`,
      key,
      failures,
      windowStart,
      blockedUntil,
    )
  }

  private clearLimit(key: string) {
    this.sql.exec('DELETE FROM limits WHERE key = ?', key)
  }

  private tooMany(wait: number): Result<never> {
    const minutes = Math.ceil(wait / MINUTE)
    return fail(429, minutes <= 1 ? 'Muitas tentativas. Tente de novo em um minuto.' : `Muitas tentativas. Tente de novo em ${minutes} minutos.`)
  }

  // ---------- Contas ----------

  status(): { signup: 'invite' | 'open'; users: number } {
    return { signup: this.meta('signup_mode') === 'open' ? 'open' : 'invite', users: this.userCount() }
  }

  private userCount(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM users').one().n
  }

  async register(
    input: { username?: unknown; name?: unknown; password?: unknown; invite?: unknown; turnstile?: boolean },
    client: ClientInfo,
  ): Promise<Result<AuthResponse>> {
    const now = Date.now()
    const ipKey = `signup:${client.ipHash}`
    const wait = this.waitFor(ipKey, now)
    if (wait) return this.tooMany(wait)
    // Conta toda tentativa de cadastro (não só falha): no máximo 10 por hora por IP.
    this.failure(ipKey, 10, HOUR, HOUR, now)

    // O app 0.5 manda só o apelido ("name"): vira o nome de usuário mais parecido.
    const username = validUsername(
      input.username === undefined && typeof input.name === 'string' ? slugUsername(input.name) : input.username,
    )
    if (!username) return fail(400, 'O nome de usuário precisa ter de 2 a 32 letras minúsculas, números, _ ou ponto.')
    const name = input.name === undefined ? username : cleanLine(input.name, 1, 32)
    if (!name) return fail(400, 'O nome de exibição precisa ter de 1 a 32 caracteres.')
    const problem = passwordProblem(input.password, username)
    if (problem) return fail(400, problem)
    const password = input.password as string
    const code = typeof input.invite === 'string' ? input.invite.trim() : ''

    const { hash, salt } = await hashPassword(password)

    // Depois do hash (assíncrono), confere de novo o que outra requisição pode ter mudado.
    const first = this.userCount() === 0
    let invite: InviteRow | null = null
    if (code) {
      if (!this.validInvite(code, now)) return fail(403, 'Convite inválido, vencido ou já usado.')
    } else if (!first && !(this.status().signup === 'open' && input.turnstile)) {
      return fail(403, this.status().signup === 'open' ? 'Confirme que você não é um robô.' : 'Pra criar conta você precisa de um convite.')
    }
    if (
      this.sql.exec('SELECT 1 FROM users WHERE username = ?', username).toArray().length > 0 ||
      this.sql.exec('SELECT 1 FROM aliases WHERE alias = ?', username).toArray().length > 0
    ) {
      return fail(409, 'Esse nome de usuário já está em uso.')
    }
    if (code) {
      invite = this.claimInvite(code, now)
      if (!invite) return fail(403, 'Convite inválido, vencido ou já usado.')
    }

    const id = newId()
    this.sql.exec(
      `INSERT INTO users (id, username, name, pass_hash, pass_salt, flags, created_at, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      username,
      name,
      hash,
      salt,
      first ? FLAG_STAFF : 0,
      now,
      now,
    )
    const token = await this.createSession(id, client, now)
    const row = this.user(id)!
    if (invite) await this.addToGuild(invite.guild_id, row, invite.code)
    return ok({ token, user: this.toMe(row) })
  }

  async login(input: { username?: unknown; name?: unknown; password?: unknown }, client: ClientInfo): Promise<Result<AuthResponse>> {
    const now = Date.now()
    // A 0.5 manda "name" (o apelido); a nova manda "username".
    const given = typeof input.username === 'string' ? input.username : input.name
    const name = typeof given === 'string' ? given.trim().toLowerCase().slice(0, 64) : ''
    const password = typeof input.password === 'string' ? input.password : ''
    if (!name || !password) return fail(400, 'Preencha usuário e senha.')

    const row =
      this.sql.exec<UserRow>('SELECT * FROM users WHERE username = ?', name).toArray()[0] ??
      this.sql.exec<UserRow>('SELECT u.* FROM aliases a JOIN users u ON u.id = a.user_id WHERE a.alias = ?', name).toArray()[0]
    // A trava é por conta + IP: quem erra de propósito não tranca a conta dos outros.
    // Um teto geral por conta segura tentativa espalhada por muitos IPs.
    const account = row?.id ?? name
    const ipKey = `login:${client.ipHash}`
    const userKey = `login:user:${account}:${client.ipHash}`
    const globalKey = `login:all:${account}`
    const wait = Math.max(this.waitFor(ipKey, now), this.waitFor(userKey, now), this.waitFor(globalKey, now))
    if (wait) return this.tooMany(wait)

    const usable = row && !(row.flags & FLAG_DELETED) && row.pass_hash
    // Usuário inexistente gasta o mesmo tempo de um existente: não dá pra descobrir quem existe.
    const valid = usable
      ? await verifyPassword(password, row.pass_hash, row.pass_salt)
      : (await verifyPassword(password, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA'), false)
    if (!valid) {
      this.failure(ipKey, 20, 15 * MINUTE, 15 * MINUTE, now)
      this.failure(userKey, 5, 15 * MINUTE, 30_000, now)
      this.failure(globalKey, 100, HOUR, 15 * MINUTE, now)
      return fail(401, 'Usuário ou senha incorretos.')
    }
    if (row.flags & FLAG_BANNED) return fail(403, 'Esta conta foi suspensa.')
    this.clearLimit(userKey)
    return ok({ token: await this.createSession(row.id, client, now), user: this.toMe(row) })
  }

  private async createSession(userId: string, client: ClientInfo, now: number): Promise<string> {
    const token = randomToken()
    this.sql.exec(
      `INSERT INTO sessions (id, token_hash, user_id, device, country, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      randomToken(12),
      await hashToken(token),
      userId,
      cleanLine(client.device, 1, 80) ?? 'Aparelho desconhecido',
      client.country,
      now,
      now,
      now + SESSION_IDLE,
    )
    return token
  }

  async authenticate(token: string): Promise<AuthContext | null> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
    const tokenHash = await hashToken(token)
    const now = Date.now()
    const session = this.sql
      .exec<SessionRow>('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', tokenHash, now)
      .toArray()[0]
    if (!session) return null
    const row = this.user(session.user_id)
    if (!row || row.flags & (FLAG_BANNED | FLAG_DELETED)) return null
    if (now - session.last_seen_at > SEEN_EVERY) {
      this.sql.exec('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', now, now + SESSION_IDLE, session.id)
    }
    return { me: this.toMe(row), sessionId: session.id, tokenHash }
  }

  async logout(token: string) {
    const auth = await this.authenticate(token)
    if (!auth) return
    this.sql.exec('DELETE FROM sessions WHERE id = ?', auth.sessionId)
    await this.closeSockets(auth.me.id, [auth.tokenHash])
  }

  sessions(userId: string, currentSessionId: string): SessionInfo[] {
    return this.sql
      .exec<SessionRow>('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC', userId, Date.now())
      .toArray()
      .map((s) => ({
        id: s.id,
        device: s.device,
        country: s.country,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        current: s.id === currentSessionId,
      }))
  }

  async revokeSession(userId: string, sessionId: string): Promise<Result<null>> {
    const session = this.sql
      .exec<SessionRow>('SELECT * FROM sessions WHERE id = ? AND user_id = ?', sessionId, userId)
      .toArray()[0]
    if (!session) return fail(404, 'Esse aparelho já saiu.')
    this.sql.exec('DELETE FROM sessions WHERE id = ?', sessionId)
    await this.closeSockets(userId, [session.token_hash])
    return ok(null)
  }

  async revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
    const others = this.sql
      .exec<SessionRow>('SELECT * FROM sessions WHERE user_id = ? AND id != ?', userId, currentSessionId)
      .toArray()
    this.sql.exec('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, currentSessionId)
    await this.closeSockets(
      userId,
      others.map((s) => s.token_hash),
    )
    return others.length
  }

  /** Derruba na hora as conexões abertas dessas sessões (servidores e pessoal). */
  private async closeSockets(userId: string, tokenHashes: string[], guildIds?: string[]) {
    if (tokenHashes.length === 0) return
    const guilds = guildIds ?? this.sql.exec<{ guild_id: string }>('SELECT guild_id FROM members WHERE user_id = ?', userId).toArray().map((g) => g.guild_id)
    await Promise.allSettled([...guilds.map((g) => this.guild(g).closeSessions(tokenHashes)), this.home(userId).closeSessions(tokenHashes)])
  }

  async changePassword(
    userId: string,
    sessionId: string,
    current: unknown,
    next: unknown,
  ): Promise<Result<null>> {
    const now = Date.now()
    const row = this.user(userId)
    if (!row) return fail(404, 'Conta não encontrada.')
    const key = `password:${userId}`
    const wait = this.waitFor(key, now)
    if (wait) return this.tooMany(wait)
    if (typeof current !== 'string' || !(await verifyPassword(current, row.pass_hash, row.pass_salt))) {
      this.failure(key, 5, 15 * MINUTE, 60_000, now)
      return fail(401, 'A senha atual está errada.')
    }
    const problem = passwordProblem(next, row.username)
    if (problem) return fail(400, problem)
    const { hash, salt } = await hashPassword(next as string)
    this.sql.exec('UPDATE users SET pass_hash = ?, pass_salt = ?, password_changed_at = ? WHERE id = ?', hash, salt, now, userId)
    this.clearLimit(key)
    // Senha nova: todos os outros aparelhos saem.
    await this.revokeOtherSessions(userId, sessionId)
    return ok(null)
  }

  // ---------- Perfil ----------

  async updateProfile(
    userId: string,
    patch: { name?: unknown; bio?: unknown; accent?: unknown; dmPolicy?: unknown; style?: unknown },
  ): Promise<Result<Me>> {
    const row = this.user(userId)
    if (!row) return fail(404, 'Conta não encontrada.')
    const limit = this.action(`profile:${userId}`, 20, MINUTE)
    if (limit) return limit
    const sets: string[] = []
    const args: SqlStorageValue[] = []
    if (patch.name !== undefined) {
      const name = cleanLine(patch.name, 1, 32)
      if (!name) return fail(400, 'O nome de exibição precisa ter de 1 a 32 caracteres.')
      sets.push('name = ?')
      args.push(name)
    }
    if (patch.bio !== undefined) {
      const bio = cleanText(patch.bio, 190)
      if (bio === null) return fail(400, 'O "sobre mim" pode ter até 190 caracteres.')
      sets.push('bio = ?')
      args.push(bio)
    }
    if (patch.accent !== undefined) {
      const accent = color(patch.accent)
      if (accent === undefined) return fail(400, 'Cor inválida.')
      sets.push('accent = ?')
      args.push(accent)
    }
    if (patch.dmPolicy !== undefined) {
      if (!['everyone', 'servers', 'friends'].includes(patch.dmPolicy as string)) return fail(400, 'Opção inválida.')
      sets.push('dm_policy = ?')
      args.push(patch.dmPolicy as string)
    }
    if (patch.style !== undefined) {
      const style = applyStylePatch(parseStyle(row.style), patch.style, (row.flags & FLAG_STAFF) !== 0)
      if (!style.ok) return fail(400, style.error)
      sets.push('style = ?')
      args.push(styleText(style.value))
    }
    if (sets.length > 0) this.sql.exec(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...args, userId)
    const updated = this.user(userId)!
    await this.propagateProfile(updated)
    return ok(this.toMe(updated))
  }

  /**
   * Foto parada (até 512 KB) ou animada (GIF/WebP até 1,5 MB). A animada vem
   * com um quadro parado (`still`), que é o que aparece nas listas.
   */
  async setAvatar(userId: string, data: ArrayBuffer, still?: ArrayBuffer | null): Promise<Result<Me>> {
    const row = this.user(userId)
    if (!row) return fail(404, 'Conta não encontrada.')
    const animated = isAnimated(new Uint8Array(data))
    if (animated && !still) return fail(400, 'Falta o quadro parado da foto animada.')
    if (!animated && data.byteLength > MAX_AVATAR_BYTES) return fail(413, 'A foto pode ter até 512 KB (animada, até 1,5 MB).')
    const stored = this.storeImage(userId, 'avatar', data, animated ? MAX_ANIMATED_BYTES : MAX_AVATAR_BYTES)
    if (!stored.ok) return stored
    let stillId: string | undefined
    if (animated) {
      const storedStill = this.storeImage(userId, 'avatar_still', still!, MAX_AVATAR_BYTES)
      if (!storedStill.ok) {
        this.sql.exec('DELETE FROM media WHERE id = ?', stored.value)
        return storedStill
      }
      stillId = storedStill.value
    }
    const style = parseStyle(row.style)
    this.dropMedia(row.avatar, style?.avatarStill)
    this.sql.exec('UPDATE users SET avatar = ?, style = ? WHERE id = ?', stored.value, styleText({ ...style, avatarStill: stillId }), userId)
    const updated = this.user(userId)!
    await this.propagateProfile(updated)
    return ok(this.toMe(updated))
  }

  async clearAvatar(userId: string): Promise<Result<Me>> {
    const row = this.user(userId)
    if (!row) return fail(404, 'Conta não encontrada.')
    const style = parseStyle(row.style)
    this.dropMedia(row.avatar, style?.avatarStill)
    this.sql.exec('UPDATE users SET avatar = NULL, style = ? WHERE id = ?', styleText({ ...style, avatarStill: undefined }), userId)
    const updated = this.user(userId)!
    await this.propagateProfile(updated)
    return ok(this.toMe(updated))
  }

  /** Imagem do topo do cartão de perfil (pode ser animada). */
  async setBanner(userId: string, data: ArrayBuffer): Promise<Result<Me>> {
    const row = this.user(userId)
    if (!row) return fail(404, 'Conta não encontrada.')
    const stored = this.storeImage(userId, 'banner', data, MAX_BANNER_BYTES)
    if (!stored.ok) return stored
    const style = parseStyle(row.style)
    this.dropMedia(style?.banner)
    this.sql.exec('UPDATE users SET style = ? WHERE id = ?', styleText({ ...style, banner: stored.value }), userId)
    const updated = this.user(userId)!
    await this.propagateProfile(updated)
    return ok(this.toMe(updated))
  }

  async clearBanner(userId: string): Promise<Result<Me>> {
    const row = this.user(userId)
    if (!row) return fail(404, 'Conta não encontrada.')
    const style = parseStyle(row.style)
    this.dropMedia(style?.banner)
    this.sql.exec('UPDATE users SET style = ? WHERE id = ?', styleText({ ...style, banner: undefined }), userId)
    const updated = this.user(userId)!
    await this.propagateProfile(updated)
    return ok(this.toMe(updated))
  }

  private dropMedia(...ids: (string | null | undefined)[]) {
    for (const id of ids) if (id) this.sql.exec('DELETE FROM media WHERE id = ?', id)
  }

  /** Guarda uma imagem (foto, banner, ícone) conferindo o tipo pelos bytes, não pelo que o app diz. */
  private storeImage(ownerId: string, kind: string, data: ArrayBuffer, max = MAX_AVATAR_BYTES): Result<string> {
    if (data.byteLength === 0 || data.byteLength > max) {
      return fail(413, `A imagem pode ter até ${sizeLabel(max)}.`)
    }
    const type = imageType(new Uint8Array(data.slice(0, 16)))
    if (!type) return fail(415, 'Use uma imagem PNG, JPEG, WebP ou GIF.')
    const limit = this.action(`media:${ownerId}`, 20, HOUR)
    if (limit) return limit
    if (this.storageUsed() + data.byteLength > STORAGE_LIMIT) return fail(507, 'O espaço da plataforma está cheio.')
    const id = randomToken(16)
    this.sql.exec(
      'INSERT INTO media (id, owner_id, kind, type, bytes, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      ownerId,
      kind,
      type,
      data,
      data.byteLength,
      Date.now(),
    )
    return ok(id)
  }

  /** Ícone de servidor (só quem enviou consegue usar em `guild.update`). Fica no máximo um solto por pessoa. */
  uploadGuildIcon(userId: string, data: ArrayBuffer): Result<string> {
    const stored = this.storeImage(userId, 'guild_icon', data)
    if (stored.ok) {
      this.sql.exec(
        `DELETE FROM media WHERE kind = 'guild_icon' AND owner_id = ? AND id != ?
         AND id NOT IN (SELECT icon FROM guilds WHERE icon IS NOT NULL)`,
        userId,
        stored.value,
      )
    }
    return stored
  }

  /**
   * Conta uma ação e diz se passou do limite (`max` na janela). Diferente de
   * `failure`, conta toda tentativa, não só as que deram errado.
   */
  private action(key: string, max: number, window: number): Result<never> | null {
    const now = Date.now()
    const wait = this.waitFor(key, now)
    if (wait) return this.tooMany(wait)
    this.failure(key, max, window, window, now)
    return null
  }

  mediaOwner(id: string): string | null {
    return this.sql.exec<{ owner_id: string }>('SELECT owner_id FROM media WHERE id = ?', id).toArray()[0]?.owner_id ?? null
  }

  getMedia(id: string): { type: string; bytes: ArrayBuffer } | null {
    const row = this.sql.exec<{ type: string; bytes: ArrayBuffer }>('SELECT type, bytes FROM media WHERE id = ?', id).toArray()[0]
    return row ? { type: row.type, bytes: row.bytes } : null
  }

  /** Perfil mudou: avisa os servidores da pessoa, os amigos e os aparelhos dela. */
  private async propagateProfile(row: UserRow) {
    const user = this.toUser(row)
    const guilds = this.sql.exec<{ guild_id: string }>('SELECT guild_id FROM members WHERE user_id = ?', row.id).toArray()
    const friends = this.friendIds(row.id)
    await Promise.allSettled([
      ...guilds.map((g) => this.guild(g.guild_id).profileUpdated(user)),
      ...friends.map((f) => this.home(f).userUpdated(user)),
      this.home(row.id).meUpdated(this.toMe(row)),
    ])
  }

  async deleteAccount(userId: string, password: unknown): Promise<Result<null>> {
    const row = this.user(userId)
    if (!row) return fail(404, 'Conta não encontrada.')
    // Dono de servidor nem chega a testar a senha (não vira um jeito de adivinhar).
    const owned = this.sql.exec<GuildRow>('SELECT * FROM guilds WHERE owner_id = ?', userId).toArray()
    if (owned.length > 0) {
      return fail(409, `Antes, transfira ou exclua seus servidores: ${owned.map((g) => g.name).join(', ')}.`)
    }
    const key = `password:${userId}`
    const wait = this.waitFor(key)
    if (wait) return this.tooMany(wait)
    if (typeof password !== 'string' || !(await verifyPassword(password, row.pass_hash, row.pass_salt))) {
      this.failure(key, 5, 15 * MINUTE, 60_000)
      return fail(401, 'Senha incorreta.')
    }
    this.clearLimit(key)

    // Tudo no banco de uma vez (sem pausa no meio): ou a conta some inteira, ou nada muda.
    const sessions = this.sql.exec<SessionRow>('SELECT * FROM sessions WHERE user_id = ?', userId).toArray()
    const friends = this.friendIds(userId)
    const guilds = this.sql.exec<{ guild_id: string }>('SELECT guild_id FROM members WHERE user_id = ?', userId).toArray()
    this.ctx.storage.transactionSync(() => {
      // A conta vira "Usuário excluído": as mensagens antigas continuam, sem nome nem foto.
      // O nome reservado tem ":", que não vale em nome de usuário: ninguém consegue tomar antes.
      this.sql.exec(
        `UPDATE users SET username = ?, name = 'Usuário excluído', avatar = NULL, bio = '', accent = NULL, style = NULL,
         pass_hash = '', pass_salt = '', flags = flags | ? WHERE id = ?`,
        `deleted:${userId}`,
        FLAG_DELETED,
        userId,
      )
      this.sql.exec('DELETE FROM aliases WHERE user_id = ?', userId)
      this.sql.exec('DELETE FROM sessions WHERE user_id = ?', userId)
      this.sql.exec('DELETE FROM friendships WHERE low = ? OR high = ?', userId, userId)
      this.sql.exec('DELETE FROM blocks WHERE blocker = ? OR blocked = ?', userId, userId)
      this.sql.exec('DELETE FROM media WHERE owner_id = ?', userId)
      this.sql.exec('DELETE FROM members WHERE user_id = ?', userId)
    })
    const deleted = this.toUser(this.user(userId)!)
    await this.closeSockets(
      userId,
      sessions.map((s) => s.token_hash),
      guilds.map((g) => g.guild_id),
    )
    await Promise.allSettled([
      ...guilds.map((g) => this.guild(g.guild_id).memberRemoved(userId, deleted)),
      ...friends.map((f) => this.pushFriends(f)),
      this.home(userId).wipe(),
    ])
    return ok(null)
  }

  // ---------- Servidores ----------

  private toGuild(row: GuildRow): GuildInfo {
    return { id: row.id, name: row.name, icon: row.icon, ownerId: row.owner_id }
  }

  guildInfo(guildId: string): GuildInfo | null {
    const row = this.sql.exec<GuildRow>('SELECT * FROM guilds WHERE id = ?', guildId).toArray()[0]
    return row ? this.toGuild(row) : null
  }

  guildsOf(userId: string): GuildInfo[] {
    return this.sql
      .exec<GuildRow>(
        'SELECT g.* FROM members m JOIN guilds g ON g.id = m.guild_id WHERE m.user_id = ? ORDER BY m.joined_at',
        userId,
      )
      .toArray()
      .map((row) => this.toGuild(row))
  }

  async createGuild(userId: string, nameInput: unknown): Promise<Result<GuildInfo>> {
    const owner = this.user(userId)
    if (!owner) return fail(404, 'Conta não encontrada.')
    const name = cleanLine(nameInput, 2, 64)
    if (!name) return fail(400, 'O nome do servidor precisa ter de 2 a 64 caracteres.')
    if (this.membershipCount(userId) >= MAX_GUILDS_PER_USER) return fail(409, `Você já está em ${MAX_GUILDS_PER_USER} servidores.`)
    const recent = this.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM guilds WHERE owner_id = ? AND created_at > ?', userId, Date.now() - DAY)
      .one().n
    if (recent >= 10) return fail(429, 'Você já criou muitos servidores hoje. Tente amanhã.')

    const now = Date.now()
    const id = newId()
    this.sql.exec('INSERT INTO guilds (id, name, icon, owner_id, created_at) VALUES (?, ?, NULL, ?, ?)', id, name, userId, now)
    this.sql.exec('INSERT INTO members (guild_id, user_id, joined_at) VALUES (?, ?, ?)', id, userId, now)
    const info: GuildInfo = { id, name, icon: null, ownerId: userId }
    await this.guild(id).setup(info, this.toUser(owner))
    await this.home(userId).guildJoined(info)
    return ok(info)
  }

  /** Chamado pelo Guild depois de checar a permissão. */
  async guildUpdated(guildId: string, patch: { name?: string; icon?: string | null }): Promise<GuildInfo | null> {
    const row = this.sql.exec<GuildRow>('SELECT * FROM guilds WHERE id = ?', guildId).toArray()[0]
    if (!row) return null
    if (patch.name !== undefined) this.sql.exec('UPDATE guilds SET name = ? WHERE id = ?', patch.name, guildId)
    if (patch.icon !== undefined) {
      if (row.icon && row.icon !== patch.icon) this.sql.exec('DELETE FROM media WHERE id = ?', row.icon)
      this.sql.exec('UPDATE guilds SET icon = ? WHERE id = ?', patch.icon, guildId)
    }
    const info = this.guildInfo(guildId)!
    await this.notifyMembers(guildId, (home) => home.guildUpdated(info))
    return info
  }

  async setGuildOwner(guildId: string, ownerId: string): Promise<GuildInfo | null> {
    if (!this.isMember(guildId, ownerId)) return null
    this.sql.exec('UPDATE guilds SET owner_id = ? WHERE id = ?', ownerId, guildId)
    const info = this.guildInfo(guildId)
    if (info) await this.notifyMembers(guildId, (home) => home.guildUpdated(info))
    return info
  }

  /** Excluir de vez: o dono confirma digitando o nome do servidor. */
  async deleteGuild(guildId: string, actorId: string, confirmName: unknown): Promise<Result<null>> {
    const row = this.sql.exec<GuildRow>('SELECT * FROM guilds WHERE id = ?', guildId).toArray()[0]
    if (!row) return fail(404, 'Servidor não existe.')
    if (row.owner_id !== actorId) return fail(403, 'Só o dono pode excluir o servidor.')
    if (typeof confirmName !== 'string' || confirmName.trim().toLowerCase() !== row.name.trim().toLowerCase()) {
      return fail(400, 'Digite o nome do servidor pra confirmar.')
    }
    const members = this.memberIds(guildId)
    this.sql.exec('DELETE FROM members WHERE guild_id = ?', guildId)
    this.sql.exec('DELETE FROM invites WHERE guild_id = ?', guildId)
    this.sql.exec('DELETE FROM guilds WHERE id = ?', guildId)
    this.sql.exec('DELETE FROM storage WHERE scope = ?', `g:${guildId}`)
    if (row.icon) this.sql.exec('DELETE FROM media WHERE id = ?', row.icon)
    await this.guild(guildId).destroy()
    await Promise.allSettled(members.map((m) => this.home(m).guildLeft(guildId, 'deleted')))
    return ok(null)
  }

  private async notifyMembers(guildId: string, fn: (home: ReturnType<Directory['home']>) => Promise<unknown>) {
    await Promise.allSettled(this.memberIds(guildId).map((m) => fn(this.home(m))))
  }

  // ---------- Membros ----------

  isMember(guildId: string, userId: string): boolean {
    return this.sql.exec('SELECT 1 FROM members WHERE guild_id = ? AND user_id = ?', guildId, userId).toArray().length > 0
  }

  memberIds(guildId: string): string[] {
    return this.sql.exec<{ user_id: string }>('SELECT user_id FROM members WHERE guild_id = ?', guildId).toArray().map((r) => r.user_id)
  }

  private membershipCount(userId: string): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM members WHERE user_id = ?', userId).one().n
  }

  private validInvite(code: string, now: number): InviteRow | null {
    const row = this.sql.exec<InviteRow>('SELECT * FROM invites WHERE code = ?', code).toArray()[0]
    if (!row) return null
    if (row.expires_at !== null && row.expires_at <= now) return null
    if (row.max_uses !== null && row.uses >= row.max_uses) return null
    return row
  }

  /**
   * Gasta um uso do convite na mesma instrução que confere se ele ainda vale:
   * dois pedidos ao mesmo tempo nunca usam a mesma vaga.
   */
  private claimInvite(code: string, now: number): InviteRow | null {
    const claimed = this.sql.exec(
      `UPDATE invites SET uses = uses + 1 WHERE code = ? AND (expires_at IS NULL OR expires_at > ?)
       AND (max_uses IS NULL OR uses < max_uses)`,
      code,
      now,
    ).rowsWritten
    return claimed > 0 ? this.sql.exec<InviteRow>('SELECT * FROM invites WHERE code = ?', code).one() : null
  }

  private unclaimInvite(code: string) {
    this.sql.exec('UPDATE invites SET uses = MAX(uses - 1, 0) WHERE code = ?', code)
  }

  /** Entra num servidor (o uso do convite, se houver, já foi gasto: devolve se não entrar). */
  private async addToGuild(guildId: string, user: UserRow, code: string | null): Promise<Result<GuildInfo>> {
    const giveBack = () => {
      if (code) this.unclaimInvite(code)
    }
    const info = this.guildInfo(guildId)
    if (!info) {
      giveBack()
      return fail(404, 'Esse servidor não existe mais.')
    }
    if (this.isMember(guildId, user.id)) {
      giveBack()
      return ok(info)
    }
    if (this.membershipCount(user.id) >= MAX_GUILDS_PER_USER) {
      giveBack()
      return fail(409, `Você já está em ${MAX_GUILDS_PER_USER} servidores.`)
    }
    const banned = await this.guild(guildId).isBanned(user.id)
    // Durante a espera, outro pedido da mesma pessoa pode ter entrado.
    if (banned || this.isMember(guildId, user.id)) {
      giveBack()
      return banned ? fail(403, 'Você foi banido desse servidor.') : ok(info)
    }
    this.sql.exec('INSERT INTO members (guild_id, user_id, joined_at) VALUES (?, ?, ?)', guildId, user.id, Date.now())
    await this.guild(guildId).addMember(this.toUser(user))
    await this.home(user.id).guildJoined(info)
    return ok(info)
  }

  async joinByInvite(userId: string, code: unknown): Promise<Result<GuildInfo>> {
    const row = this.user(userId)
    if (!row) return fail(404, 'Conta não encontrada.')
    const limit = this.action(`join:${userId}`, 30, HOUR)
    if (limit) return limit
    const invite = typeof code === 'string' ? this.claimInvite(code.trim(), Date.now()) : null
    if (!invite) return fail(404, 'Convite inválido, vencido ou já usado.')
    return this.addToGuild(invite.guild_id, row, invite.code)
  }

  async leaveGuild(userId: string, guildId: string): Promise<Result<null>> {
    const info = this.guildInfo(guildId)
    if (!info || !this.isMember(guildId, userId)) return fail(404, 'Você não está nesse servidor.')
    if (info.ownerId === userId) return fail(409, 'Você é o dono: transfira o servidor ou exclua ele.')
    this.sql.exec('DELETE FROM members WHERE guild_id = ? AND user_id = ?', guildId, userId)
    const user = this.getUser(userId)
    await this.guild(guildId).memberRemoved(userId, user)
    await this.home(userId).guildLeft(guildId, 'left')
    return ok(null)
  }

  /** O Guild expulsou ou baniu alguém (já checou a permissão). */
  async memberKicked(guildId: string, userId: string, reason: 'kicked' | 'banned') {
    this.sql.exec('DELETE FROM members WHERE guild_id = ? AND user_id = ?', guildId, userId)
    await this.home(userId).guildLeft(guildId, reason)
  }

  /** Servidores em comum (pra política de DM "quem está nos meus servidores"). */
  private shareGuild(a: string, b: string): boolean {
    return (
      this.sql
        .exec(
          'SELECT 1 FROM members x JOIN members y ON x.guild_id = y.guild_id WHERE x.user_id = ? AND y.user_id = ? LIMIT 1',
          a,
          b,
        )
        .toArray().length > 0
    )
  }

  // ---------- Convites ----------

  private toInvite(row: InviteRow): Invite {
    return {
      code: row.code,
      guildId: row.guild_id,
      inviterId: row.inviter_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      maxUses: row.max_uses,
      uses: row.uses,
    }
  }

  createInvite(guildId: string, inviterId: string, options: { maxAge?: unknown; maxUses?: unknown }): Result<Invite> {
    if (!this.guildInfo(guildId)) return fail(404, 'Servidor não existe.')
    const maxAge = options.maxAge === undefined || options.maxAge === null ? 7 * 86400 : options.maxAge
    if (typeof maxAge !== 'number' || !INVITE_AGES.includes(maxAge)) return fail(400, 'Validade inválida.')
    const maxUses = options.maxUses === undefined ? null : options.maxUses
    if (maxUses !== null && (typeof maxUses !== 'number' || !INVITE_USES.includes(maxUses))) return fail(400, 'Limite de usos inválido.')
    const active = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM invites WHERE guild_id = ?', guildId).one().n
    if (active >= 1000) return fail(429, 'Esse servidor já tem convites demais. Apague alguns.')
    const now = Date.now()
    const row: InviteRow = {
      code: randomToken(6),
      guild_id: guildId,
      inviter_id: inviterId,
      created_at: now,
      expires_at: maxAge === 0 ? null : now + maxAge * 1000,
      max_uses: maxUses as number | null,
      uses: 0,
    }
    this.sql.exec(
      'INSERT INTO invites (code, guild_id, inviter_id, created_at, expires_at, max_uses, uses) VALUES (?, ?, ?, ?, ?, ?, 0)',
      row.code,
      row.guild_id,
      row.inviter_id,
      row.created_at,
      row.expires_at,
      row.max_uses,
    )
    return ok(this.toInvite(row))
  }

  listInvites(guildId: string): Invite[] {
    const now = Date.now()
    return this.sql
      .exec<InviteRow>('SELECT * FROM invites WHERE guild_id = ? ORDER BY created_at DESC', guildId)
      .toArray()
      .filter((r) => (r.expires_at === null || r.expires_at > now) && (r.max_uses === null || r.uses < r.max_uses))
      .map((r) => this.toInvite(r))
  }

  inviteOwner(guildId: string, code: string): string | null {
    return (
      this.sql.exec<{ inviter_id: string }>('SELECT inviter_id FROM invites WHERE guild_id = ? AND code = ?', guildId, code).toArray()[0]
        ?.inviter_id ?? null
    )
  }

  deleteInvite(guildId: string, code: string) {
    this.sql.exec('DELETE FROM invites WHERE guild_id = ? AND code = ?', guildId, code)
  }

  previewInvite(code: string): InvitePreview | null {
    const invite = typeof code === 'string' ? this.validInvite(code.trim(), Date.now()) : null
    if (!invite) return null
    const guild = this.guildInfo(invite.guild_id)
    if (!guild) return null
    return {
      code: invite.code,
      guild,
      memberCount: this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM members WHERE guild_id = ?', guild.id).one().n,
      inviter: this.getUser(invite.inviter_id),
    }
  }

  // ---------- Amizades e bloqueios ----------

  friendIds(userId: string): string[] {
    return this.sql
      .exec<{ other: string }>(
        `SELECT CASE WHEN low = ? THEN high ELSE low END AS other FROM friendships
         WHERE (low = ? OR high = ?) AND state = 'friends'`,
        userId,
        userId,
        userId,
      )
      .toArray()
      .map((r) => r.other)
  }

  friendsOf(userId: string): Friend[] {
    const rows = this.sql
      .exec<{ low: string; high: string; state: string; requester: string; created_at: number }>(
        'SELECT * FROM friendships WHERE low = ? OR high = ?',
        userId,
        userId,
      )
      .toArray()
    const others = rows.map((r) => (r.low === userId ? r.high : r.low))
    const users = new Map(this.getUsers(others).map((u) => [u.id, u]))
    return rows.flatMap((r) => {
      const user = users.get(r.low === userId ? r.high : r.low)
      if (!user || user.deleted) return []
      const state: Friend['state'] = r.state === 'friends' ? 'friends' : r.requester === userId ? 'outgoing' : 'incoming'
      return [{ user, state, since: r.created_at }]
    })
  }

  blockedOf(userId: string): User[] {
    const ids = this.sql.exec<{ blocked: string }>('SELECT blocked FROM blocks WHERE blocker = ?', userId).toArray().map((r) => r.blocked)
    return this.getUsers(ids)
  }

  isBlocked(a: string, b: string): boolean {
    return (
      this.sql.exec('SELECT 1 FROM blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?)', a, b, b, a).toArray()
        .length > 0
    )
  }

  private async pushFriends(userId: string) {
    await this.home(userId).friendsChanged(this.friendsOf(userId), this.blockedOf(userId))
  }

  async friendRequest(userId: string, usernameInput: unknown): Promise<Result<Friend['state']>> {
    if (typeof usernameInput !== 'string') return fail(400, 'Digite o nome de usuário.')
    // O limite vem antes da busca: ninguém usa isso pra varrer quem existe.
    const limit = this.action(`friend:${userId}`, 30, HOUR)
    if (limit) return limit
    const target = this.findByUsername(usernameInput)
    if (!target || target.id === userId) return fail(404, 'Não achamos ninguém com esse nome de usuário.')
    if (this.isBlocked(userId, target.id)) return fail(403, 'Não foi possível enviar o pedido.')

    const [low, high] = pair(userId, target.id)
    const row = this.sql
      .exec<{ state: string; requester: string }>('SELECT state, requester FROM friendships WHERE low = ? AND high = ?', low, high)
      .toArray()[0]
    let state: Friend['state']
    if (row?.state === 'friends') return fail(409, 'Vocês já são amigos.')
    if (row && row.requester !== userId) {
      // A outra pessoa já tinha pedido: vira amizade.
      this.sql.exec("UPDATE friendships SET state = 'friends', created_at = ? WHERE low = ? AND high = ?", Date.now(), low, high)
      state = 'friends'
    } else {
      this.sql.exec(
        `INSERT INTO friendships (low, high, state, requester, created_at) VALUES (?, ?, 'pending', ?, ?)
         ON CONFLICT (low, high) DO NOTHING`,
        low,
        high,
        userId,
        Date.now(),
      )
      state = 'outgoing'
    }
    await Promise.allSettled([this.pushFriends(userId), this.pushFriends(target.id)])
    return ok(state)
  }

  async friendAccept(userId: string, otherId: string): Promise<Result<null>> {
    const [low, high] = pair(userId, otherId)
    const row = this.sql
      .exec<{ state: string; requester: string }>('SELECT state, requester FROM friendships WHERE low = ? AND high = ?', low, high)
      .toArray()[0]
    if (!row || row.state !== 'pending' || row.requester === userId) return fail(404, 'Esse pedido não existe mais.')
    this.sql.exec("UPDATE friendships SET state = 'friends', created_at = ? WHERE low = ? AND high = ?", Date.now(), low, high)
    await Promise.allSettled([this.pushFriends(userId), this.pushFriends(otherId)])
    return ok(null)
  }

  /** Recusa, cancela ou desfaz amizade. */
  async friendRemove(userId: string, otherId: string): Promise<Result<null>> {
    const [low, high] = pair(userId, otherId)
    const removed = this.sql.exec('DELETE FROM friendships WHERE low = ? AND high = ?', low, high).rowsWritten
    if (removed === 0) return ok(null)
    await Promise.allSettled([this.pushFriends(userId), this.pushFriends(otherId)])
    return ok(null)
  }

  async block(userId: string, otherId: string): Promise<Result<null>> {
    if (userId === otherId || !this.user(otherId)) return fail(404, 'Pessoa não encontrada.')
    const [low, high] = pair(userId, otherId)
    this.sql.exec('DELETE FROM friendships WHERE low = ? AND high = ?', low, high)
    this.sql.exec('INSERT INTO blocks (blocker, blocked, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', userId, otherId, Date.now())
    // A conversa (se existir: o Home de quem bloqueou sabe) esquece o "pode mandar" e encerra a chamada.
    await Promise.allSettled([this.pushFriends(userId), this.pushFriends(otherId), this.home(userId).dmBlocked(otherId)])
    return ok(null)
  }

  async unblock(userId: string, otherId: string): Promise<Result<null>> {
    const removed = this.sql.exec('DELETE FROM blocks WHERE blocker = ? AND blocked = ?', userId, otherId).rowsWritten
    if (removed === 0) return ok(null)
    await Promise.allSettled([this.pushFriends(userId), this.home(userId).dmBlocked(otherId)])
    return ok(null)
  }

  /** Pode mandar DM? Ninguém bloqueou ninguém e a política de quem recebe deixa. */
  canDm(senderId: string, recipientId: string): boolean {
    const recipient = this.user(recipientId)
    if (!recipient || recipient.flags & (FLAG_DELETED | FLAG_BANNED) || this.isBlocked(senderId, recipientId)) return false
    const [low, high] = pair(senderId, recipientId)
    const friends =
      this.sql.exec("SELECT 1 FROM friendships WHERE low = ? AND high = ? AND state = 'friends'", low, high).toArray().length > 0
    if (friends || recipient.dm_policy === 'everyone') return true
    if (recipient.dm_policy === 'servers') return this.shareGuild(senderId, recipientId)
    return false
  }

  /** Cópia dos dados da conta (LGPD): perfil, aparelhos, servidores, amigos e bloqueios. */
  exportData(userId: string) {
    const row = this.user(userId)!
    return {
      exportedAt: new Date().toISOString(),
      profile: this.toMe(row),
      sessions: this.sessions(userId, ''),
      guilds: this.guildsOf(userId),
      friends: this.friendsOf(userId).map((f) => ({ username: f.user.username, name: f.user.name, state: f.state, since: f.since })),
      blocked: this.blockedOf(userId).map((u) => ({ username: u.username, name: u.name })),
      note: 'As mensagens ficam em cada servidor e conversa; você pode apagar as suas a qualquer momento.',
    }
  }

  /** Tudo que o Home precisa pro `ready`, numa chamada só. */
  homeSnapshot(userId: string, peerIds: string[]): { me: Me; guilds: GuildInfo[]; friends: Friend[]; blocked: User[]; peers: User[] } {
    const row = this.user(userId)!
    return {
      me: this.toMe(row),
      guilds: this.guildsOf(userId),
      friends: this.friendsOf(userId),
      blocked: this.blockedOf(userId),
      peers: this.getUsers(peerIds),
    }
  }

  // ---------- Espaço de anexos ----------

  /** Anexos guardados + fotos + envios em andamento. */
  private storageUsed(now = Date.now()): number {
    const files = this.sql.exec<{ n: number }>('SELECT COALESCE(SUM(bytes), 0) AS n FROM storage').one().n
    const media = this.sql.exec<{ n: number }>('SELECT COALESCE(SUM(size), 0) AS n FROM media').one().n
    const pending = this.sql
      .exec<{ n: number }>('SELECT COALESCE(SUM(bytes), 0) AS n FROM reservations WHERE done = 0 AND created_at > ?', now - RESERVATION_TTL)
      .one().n
    return files + media + pending
  }

  /**
   * Antes de receber um anexo: o lugar diz quanto já usa (corrige a conta) e
   * quanto quer guardar. Cabe no teto da plataforma e no limite do dia da
   * pessoa? Devolve o id da reserva, que `finishUpload` fecha.
   */
  reserveStorage(scope: string, current: number, bytes: number, userId: string): Result<string> {
    const now = Date.now()
    const user = this.user(userId)
    if (!user) return fail(404, 'Conta não encontrada.')
    this.reportStorage(scope, current)
    if (!(user.flags & FLAG_STAFF)) {
      const today = this.sql
        .exec<{ n: number }>('SELECT COALESCE(SUM(bytes), 0) AS n FROM reservations WHERE user_id = ? AND created_at > ?', userId, now - DAY)
        .one().n
      if (today + bytes > USER_DAILY_UPLOAD) return fail(429, 'Você já enviou muitos arquivos hoje. Tente amanhã.')
    }
    if (this.storageUsed(now) + bytes > STORAGE_LIMIT) return fail(507, 'O espaço de anexos da plataforma está cheio.')
    const id = randomToken(12)
    this.sql.exec('INSERT INTO reservations (id, scope, user_id, bytes, created_at) VALUES (?, ?, ?, ?, ?)', id, scope, userId, bytes, now)
    return ok(id)
  }

  /** O envio acabou (deu certo ou não): a reserva sai e vale o que o lugar diz que usa. */
  finishUpload(id: string, scope: string, current: number) {
    this.sql.exec('UPDATE reservations SET done = 1 WHERE id = ?', id)
    this.reportStorage(scope, current)
  }

  reportStorage(scope: string, current: number) {
    this.sql.exec(
      'INSERT INTO storage (scope, bytes) VALUES (?, ?) ON CONFLICT (scope) DO UPDATE SET bytes = excluded.bytes',
      scope,
      Math.max(0, Math.floor(current)),
    )
  }

  // ---------- Dono da plataforma ----------

  private isStaff(userId: string): boolean {
    const row = this.user(userId)
    return !!row && (row.flags & FLAG_STAFF) !== 0
  }

  adminSettings(staffId: string): Result<{
    signup: 'invite' | 'open'
    users: number
    guilds: number
    storageUsed: number
    storageLimit: number
    mediaUsed: number
    mediaLimit: number
  }> {
    if (!this.isStaff(staffId)) return fail(403, 'Só o dono da plataforma.')
    return ok({
      ...this.status(),
      guilds: this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM guilds').one().n,
      storageUsed: this.storageUsed(),
      storageLimit: STORAGE_LIMIT,
      mediaUsed: this.mediaUsage().bytes,
      mediaLimit: MEDIA_BUDGET,
    })
  }

  adminSetSignup(staffId: string, mode: unknown): Result<null> {
    if (!this.isStaff(staffId)) return fail(403, 'Só o dono da plataforma.')
    if (mode !== 'invite' && mode !== 'open') return fail(400, 'Opção inválida.')
    this.setMeta('signup_mode', mode)
    return ok(null)
  }

  adminUsers(staffId: string, query: unknown): Result<(User & { banned: boolean; createdAt: number })[]> {
    if (!this.isStaff(staffId)) return fail(403, 'Só o dono da plataforma.')
    const q = typeof query === 'string' ? `%${query.trim().toLowerCase().replace(/[%_]/g, '')}%` : '%'
    return ok(
      this.sql
        .exec<UserRow>(
          `SELECT * FROM users WHERE (username LIKE ? OR lower(name) LIKE ?) AND (flags & ?) = 0
           ORDER BY created_at DESC LIMIT 100`,
          q,
          q,
          FLAG_DELETED,
        )
        .toArray()
        .map((r) => ({ ...this.toUser(r), banned: (r.flags & FLAG_BANNED) !== 0, createdAt: r.created_at })),
    )
  }

  async adminSetBanned(staffId: string, userId: string, banned: boolean): Promise<Result<null>> {
    if (!this.isStaff(staffId)) return fail(403, 'Só o dono da plataforma.')
    if (staffId === userId) return fail(400, 'Você não pode suspender a si mesmo.')
    const row = this.user(userId)
    if (!row) return fail(404, 'Conta não encontrada.')
    this.sql.exec(`UPDATE users SET flags = ${banned ? 'flags | ?' : 'flags & ~?'} WHERE id = ?`, FLAG_BANNED, userId)
    if (banned) {
      const sessions = this.sql.exec<SessionRow>('SELECT * FROM sessions WHERE user_id = ?', userId).toArray()
      this.sql.exec('DELETE FROM sessions WHERE user_id = ?', userId)
      await this.closeSockets(
        userId,
        sessions.map((s) => s.token_hash),
      )
    }
    return ok(null)
  }

  // ---------- Limpeza periódica ----------

  async alarm() {
    const now = Date.now()
    if (await this.migrateLegacyDm()) {
      await this.ctx.storage.setAlarm(now + 1000)
      return
    }
    this.sql.exec('DELETE FROM sessions WHERE expires_at < ?', now)
    this.sql.exec('DELETE FROM limits WHERE blocked_until < ? AND window_start < ?', now, now - DAY)
    this.sql.exec('DELETE FROM reservations WHERE created_at < ?', now - 2 * DAY)
    this.sql.exec('DELETE FROM invites WHERE (expires_at IS NOT NULL AND expires_at < ?) OR (max_uses IS NOT NULL AND uses >= max_uses)', now)
    // Ícone enviado e nunca usado.
    this.sql.exec(
      `DELETE FROM media WHERE kind = 'guild_icon' AND created_at < ? AND id NOT IN (SELECT icon FROM guilds WHERE icon IS NOT NULL)`,
      now - DAY,
    )
    await this.ctx.storage.setAlarm(now + DAY)
  }

  // ---------- Migração da 0.5 ----------

  /**
   * Na primeira vez que o Directory sobe, puxa as contas, sessões e convites do
   * Space "main" da 0.5 (os tokens continuam valendo: ninguém precisa entrar de
   * novo), registra o servidor do grupo e move as conversas privadas pros
   * Conversations. Cada passo pode ser repetido sem duplicar nada.
   */
  private async importLegacy() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + DAY)
    if (this.meta('legacy')) return
    const main = this.guild('main')
    const data = await main.exportLegacy()
    if (data.users.length === 0) {
      this.setMeta('legacy', 'done')
      return
    }

    const now = Date.now()
    const taken = new Set<string>()
    const usernames = new Map<string, string>()
    for (const u of [...data.users].sort((a, b) => a.created_at - b.created_at)) {
      let candidate = slugUsername(u.name)
      for (let n = 2; taken.has(candidate) || validUsername(candidate) === null; n++) {
        candidate = `${slugUsername(u.name).slice(0, 28)}_${n}`
      }
      taken.add(candidate)
      usernames.set(u.id, candidate)
    }
    const owner = data.users.find((u) => u.admin === 1) ?? data.users[0]

    for (const u of data.users) {
      const username = usernames.get(u.id)!
      if (u.name.trim().toLowerCase() !== username) {
        this.sql.exec('INSERT INTO aliases (alias, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', u.name.trim().toLowerCase(), u.id)
      }
      this.sql.exec(
        `INSERT INTO users (id, username, name, pass_hash, pass_salt, flags, created_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        u.id,
        usernames.get(u.id)!,
        u.name.slice(0, 32),
        u.pass_hash,
        u.pass_salt,
        u.id === owner.id ? FLAG_STAFF : 0,
        u.created_at,
        u.created_at,
      )
    }
    for (const s of data.sessions) {
      this.sql.exec(
        `INSERT INTO sessions (id, token_hash, user_id, device, country, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, 'Aparelho de antes da atualização', NULL, ?, ?, ?) ON CONFLICT (token_hash) DO NOTHING`,
        randomToken(12),
        s.token_hash,
        s.user_id,
        s.created_at,
        now,
        now + SESSION_IDLE,
      )
    }
    const createdAt = Math.min(...data.users.map((u) => u.created_at))
    this.sql.exec(
      "INSERT INTO guilds (id, name, icon, owner_id, created_at) VALUES ('main', 'Resenha', NULL, ?, ?) ON CONFLICT (id) DO NOTHING",
      owner.id,
      createdAt,
    )
    for (const u of data.users) {
      this.sql.exec(
        "INSERT INTO members (guild_id, user_id, joined_at) VALUES ('main', ?, ?) ON CONFLICT DO NOTHING",
        u.id,
        u.created_at,
      )
    }
    for (const inv of data.invites) {
      if (inv.used_by || inv.created_at < now - 7 * DAY) continue
      this.sql.exec(
        `INSERT INTO invites (code, guild_id, inviter_id, created_at, expires_at, max_uses, uses)
         VALUES (?, 'main', ?, ?, ?, 1, 0) ON CONFLICT (code) DO NOTHING`,
        inv.code,
        inv.created_by,
        inv.created_at,
        inv.created_at + 7 * DAY,
      )
    }

    const profiles = data.users.map((u) => this.toUser(this.user(u.id)!))
    await main.legacyImported({ id: 'main', name: 'Resenha', icon: null, ownerId: owner.id }, profiles)

    // As conversas privadas mudam depois, uma por vez (podem ter arquivos grandes).
    this.setMeta('legacy_dms', JSON.stringify(data.dmChannels))
    this.setMeta('legacy', 'accounts')
    await this.ctx.storage.setAlarm(Date.now() + 1000)
  }

  /** Move uma conversa privada da 0.5 pro Conversation dela. Devolve se ainda falta alguma. */
  private async migrateLegacyDm(): Promise<boolean> {
    if (this.meta('legacy') !== 'accounts') return false
    const pending = JSON.parse(this.meta('legacy_dms') ?? '[]') as string[]
    const channelId = pending[0]
    if (channelId) {
      const imported = await this.conversation(channelId).importLegacy(channelId)
      if (imported) {
        const [a, b] = imported.members
        await this.home(a).registerDm(channelId, b, imported.lastMessageId, imported.lastMessageAt)
        await this.home(b).registerDm(channelId, a, imported.lastMessageId, imported.lastMessageAt)
      }
      await this.guild('main').dropLegacyDm(channelId)
      this.setMeta('legacy_dms', JSON.stringify(pending.slice(1)))
      return true
    }
    this.setMeta('legacy', 'done')
    return false
  }
}
