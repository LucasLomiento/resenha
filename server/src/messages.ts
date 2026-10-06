import {
  HISTORY_PAGE,
  MAX_REACTIONS_PER_MESSAGE,
  MAX_UPLOAD_BYTES,
  type Attachment,
  type Embed,
  type Message,
  type MessageRef,
  type Reaction,
} from '../../shared/protocol'
import { randomToken, signFileUrl, type FileScope } from './auth'
import { FileTooLarge, SqlFileStore } from './files'

// Mensagens, anexos, reações e busca. O mesmo código serve os servidores
// (Guild) e as conversas privadas (Conversation): cada um tem o seu SQLite.

export interface MessageRow {
  id: string
  channel_id: string
  author_id: string
  content: string
  created_at: number
  edited_at: number | null
  reply_to: string | null
  mentions: string
  mention_roles: string
  mention_everyone: number
  pinned_at: number | null
  embeds: string
  fts_id: number | null
  [key: string]: SqlStorageValue
}

export interface AttachmentRow {
  id: string
  message_id: string | null
  uploader_id: string
  name: string
  size: number
  type: string
  created_at: number
  [key: string]: SqlStorageValue
}

export interface NewMessage {
  id: string
  channelId: string
  authorId: string
  content: string
  replyTo: string | null
  mentions: string[]
  mentionRoles: string[]
  mentionEveryone: boolean
}

/** Colunas que a 0.5 não tinha (entram com ALTER TABLE no banco antigo). */
const MESSAGE_COLUMNS: [string, string][] = [
  ['reply_to', 'TEXT'],
  ['mentions', "TEXT NOT NULL DEFAULT '[]'"],
  ['mention_roles', "TEXT NOT NULL DEFAULT '[]'"],
  ['mention_everyone', 'INTEGER NOT NULL DEFAULT 0'],
  ['pinned_at', 'INTEGER'],
  ['embeds', "TEXT NOT NULL DEFAULT '[]'"],
  // Linha correspondente no índice de busca (0 = nada indexado, null = falta indexar).
  ['fts_id', 'INTEGER'],
]

export const SEARCH_PAGE = 25

export function columns(sql: SqlStorage, table: string): Set<string> {
  return new Set(
    sql
      .exec<{ name: string }>(`PRAGMA table_info(${table})`)
      .toArray()
      .map((r) => r.name),
  )
}

/** Lista como um único parâmetro (o SQLite do DO aceita poucos parâmetros por consulta). */
export const list = (values: readonly string[]) => JSON.stringify(values)
export const IN_LIST = 'IN (SELECT value FROM json_each(?))'

/** Emoji de reação: só emoji Unicode (sem texto solto). */
export function validEmoji(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32) return null
  if (!/^[\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣]+$/u.test(value)) return null
  if (!/[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u.test(value)) return null
  return value
}

export function parseJsonList(text: string | null): string[] {
  if (!text) return []
  try {
    const value = JSON.parse(text)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** Termos da busca no formato do FTS5: cada palavra entre aspas e como prefixo. */
function ftsQuery(query: string): string | null {
  const terms = query
    .replace(/["*]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 10)
    .map((t) => `"${t.slice(0, 64)}"*`)
  return terms.length > 0 ? terms.join(' ') : null
}

export class MessageStore {
  readonly files: SqlFileStore

  constructor(
    private sql: SqlStorage,
    private secret: string,
    private scope: () => FileScope,
  ) {
    this.files = new SqlFileStore(sql)
  }

  /** Cria as tabelas, ou atualiza as da 0.5 (colunas novas e índice de busca). */
  migrate() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      edited_at INTEGER
    )`)
    const have = columns(this.sql, 'messages')
    for (const [name, type] of MESSAGE_COLUMNS) {
      if (!have.has(name)) this.sql.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`)
    }
    this.sql.exec('CREATE INDEX IF NOT EXISTS messages_by_channel ON messages (channel_id, id)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS messages_by_author ON messages (author_id, id)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS messages_by_fts ON messages (fts_id)')
    this.sql.exec(
      'CREATE INDEX IF NOT EXISTS messages_pinned ON messages (channel_id, pinned_at) WHERE pinned_at IS NOT NULL',
    )
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
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, emoji, user_id)
    )`)
    // Busca sem acento ("joao" acha "João").
    this.sql.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, tokenize = 'unicode61 remove_diacritics 2')",
    )
    for (const row of this.sql
      .exec<{ id: string; content: string }>('SELECT id, content FROM messages WHERE fts_id IS NULL')
      .toArray()) {
      this.index(row.id, row.content)
    }
  }

  private index(id: string, content: string) {
    if (!content) {
      this.sql.exec('UPDATE messages SET fts_id = 0 WHERE id = ?', id)
      return
    }
    this.sql.exec('INSERT INTO messages_fts (content) VALUES (?)', content)
    const ftsId = this.sql.exec<{ id: number }>('SELECT last_insert_rowid() AS id').one().id
    this.sql.exec('UPDATE messages SET fts_id = ? WHERE id = ?', ftsId, id)
  }

  private unindex(ftsId: number | null) {
    if (ftsId) this.sql.exec('DELETE FROM messages_fts WHERE rowid = ?', ftsId)
  }

  // ---------- Leitura ----------

  get(id: unknown): MessageRow | null {
    if (typeof id !== 'string') return null
    return this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id = ?', id).toArray()[0] ?? null
  }

  lastIds(channelIds: string[]): Record<string, string> {
    if (channelIds.length === 0) return {}
    const rows = this.sql
      .exec<{ channel_id: string; id: string }>(
        `SELECT channel_id, MAX(id) AS id FROM messages WHERE channel_id ${IN_LIST} GROUP BY channel_id`,
        list(channelIds),
      )
      .toArray()
    return Object.fromEntries(rows.map((r) => [r.channel_id, r.id]))
  }

  async load(rows: MessageRow[]): Promise<Message[]> {
    if (rows.length === 0) return []
    const ids = list(rows.map((r) => r.id))
    const scope = this.scope()

    const byMessage = new Map<string, Attachment[]>()
    const files = this.sql
      .exec<AttachmentRow>(`SELECT * FROM attachments WHERE message_id ${IN_LIST} ORDER BY created_at, id`, ids)
      .toArray()
    for (const f of files) {
      const entry: Attachment = {
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        url: await signFileUrl(this.secret, scope, f.id, f.name),
      }
      byMessage.set(f.message_id!, [...(byMessage.get(f.message_id!) ?? []), entry])
    }

    const reactions = new Map<string, Reaction[]>()
    const reactionRows = this.sql
      .exec<{ message_id: string; emoji: string; user_id: string }>(
        `SELECT message_id, emoji, user_id FROM reactions WHERE message_id ${IN_LIST} ORDER BY created_at, rowid`,
        ids,
      )
      .toArray()
    for (const r of reactionRows) {
      const listForMessage = reactions.get(r.message_id) ?? []
      const existing = listForMessage.find((x) => x.emoji === r.emoji)
      if (existing) existing.userIds.push(r.user_id)
      else listForMessage.push({ emoji: r.emoji, userIds: [r.user_id] })
      reactions.set(r.message_id, listForMessage)
    }

    const replyIds = [...new Set(rows.map((r) => r.reply_to).filter((id): id is string => !!id))]
    const refs = new Map<string, MessageRef>()
    if (replyIds.length > 0) {
      for (const r of this.sql
        .exec<{ id: string; author_id: string; content: string }>(
          `SELECT id, author_id, content FROM messages WHERE id ${IN_LIST}`,
          list(replyIds),
        )
        .toArray()) {
        refs.set(r.id, { id: r.id, authorId: r.author_id, content: r.content.slice(0, 200) })
      }
    }

    return rows.map((r) => ({
      id: r.id,
      channelId: r.channel_id,
      authorId: r.author_id,
      content: r.content,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      attachments: byMessage.get(r.id) ?? [],
      // Resposta a mensagem apagada: fica a referência vazia ("mensagem original apagada").
      replyTo: r.reply_to ? (refs.get(r.reply_to) ?? { id: r.reply_to, authorId: '', content: '' }) : null,
      reactions: reactions.get(r.id) ?? [],
      mentions: parseJsonList(r.mentions),
      mentionRoles: parseJsonList(r.mention_roles),
      mentionEveryone: r.mention_everyone === 1,
      pinned: r.pinned_at !== null,
      embeds: parseEmbeds(r.embeds),
    }))
  }

  async loadOne(id: string): Promise<Message | null> {
    const row = this.get(id)
    return row ? ((await this.load([row]))[0] ?? null) : null
  }

  /** Página do histórico: as mais recentes, antes de um id, ou em volta de um id (pular pra mensagem). */
  async history(
    channelId: string,
    opts: { before?: unknown; around?: unknown },
  ): Promise<{ messages: Message[]; hasMore: boolean; hasNewer: boolean }> {
    if (typeof opts.around === 'string') {
      const half = Math.floor(HISTORY_PAGE / 2)
      const older = this.sql
        .exec<MessageRow>(
          'SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
          channelId,
          opts.around,
          half + 1,
        )
        .toArray()
      const newer = this.sql
        .exec<MessageRow>(
          'SELECT * FROM messages WHERE channel_id = ? AND id >= ? ORDER BY id ASC LIMIT ?',
          channelId,
          opts.around,
          half + 1,
        )
        .toArray()
      const rows = [...older.slice(0, half).reverse(), ...newer.slice(0, half)]
      return { messages: await this.load(rows), hasMore: older.length > half, hasNewer: newer.length > half }
    }
    const before = typeof opts.before === 'string' ? opts.before : '~' // '~' fica depois de qualquer id
    const rows = this.sql
      .exec<MessageRow>(
        'SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
        channelId,
        before,
        HISTORY_PAGE + 1,
      )
      .toArray()
    return {
      messages: await this.load(rows.slice(0, HISTORY_PAGE).reverse()),
      hasMore: rows.length > HISTORY_PAGE,
      hasNewer: false,
    }
  }

  async pins(channelId: string): Promise<Message[]> {
    const rows = this.sql
      .exec<MessageRow>(
        'SELECT * FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL ORDER BY pinned_at DESC LIMIT 50',
        channelId,
      )
      .toArray()
    return this.load(rows)
  }

  pinCount(channelId: string): number {
    return this.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL', channelId)
      .one().n
  }

  async search(
    channelIds: string[],
    query: unknown,
    opts: { authorId?: unknown; before?: unknown },
  ): Promise<{ messages: Message[]; total: number }> {
    const match = typeof query === 'string' ? ftsQuery(query.slice(0, 200)) : null
    const authorId = typeof opts.authorId === 'string' ? opts.authorId : null
    if (channelIds.length === 0 || (!match && !authorId)) return { messages: [], total: 0 }
    const where: string[] = [`m.channel_id ${IN_LIST}`]
    const args: SqlStorageValue[] = [list(channelIds)]
    if (match) {
      where.push('m.fts_id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)')
      args.push(match)
    }
    if (authorId) {
      where.push('m.author_id = ?')
      args.push(authorId)
    }
    const total = this.sql
      .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM messages m WHERE ${where.join(' AND ')} LIMIT 1000)`, ...args)
      .one().n
    if (typeof opts.before === 'string') {
      where.push('m.id < ?')
      args.push(opts.before)
    }
    const rows = this.sql
      .exec<MessageRow>(`SELECT m.* FROM messages m WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ?`, ...args, SEARCH_PAGE)
      .toArray()
    return { messages: await this.load(rows), total }
  }

  // ---------- Escrita ----------

  /** Anexos que essa pessoa enviou e ainda não usou, entre os pedidos. */
  pendingAttachments(uploaderId: string, ids: string[]): string[] {
    if (ids.length === 0) return []
    return this.sql
      .exec<{ id: string }>(
        `SELECT id FROM attachments WHERE uploader_id = ? AND message_id IS NULL AND id ${IN_LIST}`,
        uploaderId,
        list(ids),
      )
      .toArray()
      .map((r) => r.id)
  }

  insert(m: NewMessage, attachmentIds: string[], now = Date.now()): MessageRow {
    this.sql.exec(
      `INSERT INTO messages (id, channel_id, author_id, content, created_at, reply_to, mentions, mention_roles, mention_everyone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.id,
      m.channelId,
      m.authorId,
      m.content,
      now,
      m.replyTo,
      JSON.stringify(m.mentions),
      JSON.stringify(m.mentionRoles),
      m.mentionEveryone ? 1 : 0,
    )
    if (attachmentIds.length > 0) {
      this.sql.exec(
        `UPDATE attachments SET message_id = ? WHERE uploader_id = ? AND message_id IS NULL AND id ${IN_LIST}`,
        m.id,
        m.authorId,
        list(attachmentIds),
      )
    }
    this.index(m.id, m.content)
    return this.get(m.id)!
  }

  /** Copia mensagens prontas (migração das conversas privadas da 0.5). */
  importRows(rows: MessageRow[]) {
    for (const r of rows) {
      const inserted = this.sql.exec(
        `INSERT INTO messages (id, channel_id, author_id, content, created_at, edited_at, reply_to, mentions, mention_roles,
         mention_everyone, pinned_at, embeds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        r.id,
        r.channel_id,
        r.author_id,
        r.content,
        r.created_at,
        r.edited_at,
        r.reply_to ?? null,
        r.mentions ?? '[]',
        r.mention_roles ?? '[]',
        r.mention_everyone ?? 0,
        r.pinned_at ?? null,
        r.embeds ?? '[]',
      ).rowsWritten
      if (inserted > 0) this.index(r.id, r.content)
    }
  }

  importAttachment(a: AttachmentRow) {
    this.sql.exec(
      `INSERT INTO attachments (id, message_id, uploader_id, name, size, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      a.id,
      a.message_id,
      a.uploader_id,
      a.name,
      a.size,
      a.type,
      a.created_at,
    )
  }

  hasAttachment(id: string): boolean {
    return this.sql.exec('SELECT 1 FROM attachments WHERE id = ?', id).toArray().length > 0
  }

  /** Quantas mensagens dos outros depois de um id (não lidas). */
  countAfter(channelId: string, afterId: string | null, exceptAuthor: string): number {
    return this.sql
      .exec<{ n: number }>(
        'SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND id > ? AND author_id != ?',
        channelId,
        afterId ?? '',
        exceptAuthor,
      )
      .one().n
  }

  edit(
    row: MessageRow,
    content: string,
    mentions: { mentions: string[]; mentionRoles: string[]; mentionEveryone: boolean },
    now = Date.now(),
  ) {
    this.unindex(row.fts_id)
    this.sql.exec(
      'UPDATE messages SET content = ?, edited_at = ?, mentions = ?, mention_roles = ?, mention_everyone = ? WHERE id = ?',
      content,
      now,
      JSON.stringify(mentions.mentions),
      JSON.stringify(mentions.mentionRoles),
      mentions.mentionEveryone ? 1 : 0,
      row.id,
    )
    this.index(row.id, content)
  }

  hasAttachments(messageId: string): boolean {
    return this.sql.exec('SELECT 1 FROM attachments WHERE message_id = ? LIMIT 1', messageId).toArray().length > 0
  }

  setEmbeds(id: string, embeds: Embed[]) {
    this.sql.exec('UPDATE messages SET embeds = ? WHERE id = ?', JSON.stringify(embeds), id)
  }

  setPinned(id: string, on: boolean, now = Date.now()) {
    this.sql.exec('UPDATE messages SET pinned_at = ? WHERE id = ?', on ? now : null, id)
  }

  /** Apaga mensagens (com anexos, reações e índice). Devolve quantos bytes de arquivo liberou. */
  removeRows(rows: { id: string; fts_id: number | null }[]): number {
    if (rows.length === 0) return 0
    const ids = list(rows.map((r) => r.id))
    const files = this.sql
      .exec<{ id: string; size: number }>(`SELECT id, size FROM attachments WHERE message_id ${IN_LIST}`, ids)
      .toArray()
    this.files.delete(files.map((f) => f.id))
    this.sql.exec(`DELETE FROM attachments WHERE message_id ${IN_LIST}`, ids)
    this.sql.exec(`DELETE FROM reactions WHERE message_id ${IN_LIST}`, ids)
    for (const r of rows) this.unindex(r.fts_id)
    this.sql.exec(`DELETE FROM messages WHERE id ${IN_LIST}`, ids)
    return files.reduce((sum, f) => sum + f.size, 0)
  }

  /** Apaga um canal inteiro, em lotes. */
  removeChannel(channelId: string): number {
    let freed = 0
    for (;;) {
      const rows = this.sql
        .exec<{ id: string; fts_id: number | null }>('SELECT id, fts_id FROM messages WHERE channel_id = ? LIMIT 500', channelId)
        .toArray()
      if (rows.length === 0) return freed
      freed += this.removeRows(rows)
    }
  }

  // ---------- Reações ----------

  reactions(messageId: string): Reaction[] {
    const out: Reaction[] = []
    for (const r of this.sql
      .exec<{ emoji: string; user_id: string }>(
        'SELECT emoji, user_id FROM reactions WHERE message_id = ? ORDER BY created_at, rowid',
        messageId,
      )
      .toArray()) {
      const existing = out.find((x) => x.emoji === r.emoji)
      if (existing) existing.userIds.push(r.user_id)
      else out.push({ emoji: r.emoji, userIds: [r.user_id] })
    }
    return out
  }

  hasReaction(messageId: string, emoji: string): boolean {
    return this.sql.exec('SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ? LIMIT 1', messageId, emoji).toArray().length > 0
  }

  /** Liga/desliga uma reação. `false` = a mensagem já tem emojis diferentes demais. */
  react(messageId: string, userId: string, emoji: string, on: boolean, now = Date.now()): boolean {
    if (!on) {
      this.sql.exec('DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND user_id = ?', messageId, emoji, userId)
      return true
    }
    if (!this.hasReaction(messageId, emoji)) {
      const distinct = this.sql
        .exec<{ n: number }>('SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id = ?', messageId)
        .one().n
      if (distinct >= MAX_REACTIONS_PER_MESSAGE) return false
    }
    this.sql.exec(
      'INSERT INTO reactions (message_id, emoji, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      messageId,
      emoji,
      userId,
      now,
    )
    return true
  }

  // ---------- Arquivos ----------

  filesUsed(): number {
    return this.sql.exec<{ n: number }>('SELECT COALESCE(SUM(size), 0) AS n FROM attachments').one().n
  }

  /**
   * Recebe um anexo. `reserve` confere o espaço (deste lugar e da plataforma)
   * antes de gravar; devolve a mensagem de erro ou null.
   */
  async upload(
    request: Request,
    uploaderId: string,
    reserve: (bytes: number) => Promise<string | null>,
  ): Promise<Response> {
    const declared = Number(request.headers.get('Content-Length'))
    if (!declared || !request.body) return Response.json({ error: 'Faltou o tamanho do arquivo.' }, { status: 411 })
    if (declared > MAX_UPLOAD_BYTES) return Response.json({ error: 'Arquivo maior que 25 MB.' }, { status: 413 })
    const problem = await reserve(declared)
    if (problem) return Response.json({ error: problem }, { status: 507 })

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
      size = await this.files.put(id, request.body, declared)
    } catch (err) {
      if (err instanceof FileTooLarge) return Response.json({ error: 'O arquivo veio maior do que o anunciado.' }, { status: 413 })
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
    const attachment: Attachment = { id, name, size, type, url: await signFileUrl(this.secret, this.scope(), id, name) }
    return Response.json(attachment)
  }

  /** Serve um anexo (a assinatura já foi conferida no Worker), com suporte a Range pra vídeo. */
  serve(request: Request, id: string): Response {
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

  /** Anexos enviados e nunca usados numa mensagem. Devolve quantos bytes liberou. */
  removeOrphans(olderThan: number): number {
    const orphans = this.sql
      .exec<{ id: string; size: number }>('SELECT id, size FROM attachments WHERE message_id IS NULL AND created_at < ?', olderThan)
      .toArray()
    if (orphans.length === 0) return 0
    const ids = orphans.map((o) => o.id)
    this.sql.exec(`DELETE FROM attachments WHERE id ${IN_LIST}`, list(ids))
    this.files.delete(ids)
    return orphans.reduce((sum, o) => sum + o.size, 0)
  }
}

function parseEmbeds(text: string | null): Embed[] {
  if (!text) return []
  try {
    const value = JSON.parse(text)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}
