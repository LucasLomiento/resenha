import { DurableObject } from 'cloudflare:workers'
import {
  MAX_MESSAGE_LENGTH,
  dmMembers,
  type HomeServerMessage,
  type Message,
  type SignalData,
  type VoiceMember,
} from '../../shared/protocol'
import type { Result } from './directory'
import { USER_HEADER } from './guild'
import { newId } from './ids'
import { MessageStore, validEmoji, type UploadTicket } from './messages'
import { directory, guild, home } from './stubs'
import { unfurlAll } from './unfurl'

// Uma conversa privada entre duas pessoas: mensagens, anexos e a chamada.
// O app nunca fala direto com este DO: tudo passa pelo Home de cada um, que
// já sabe quem é a pessoa. Aqui só se confere se ela faz parte da conversa e
// se ainda pode mandar mensagem (bloqueio, privacidade).

const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error })
const ok = <T>(value: T): Result<T> => ({ ok: true, value })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** Teto de anexos por conversa. */
const FILES_LIMIT = 1024 ** 3
const ORPHAN_TTL = DAY
/** Por quanto tempo o telefone toca. */
const RING_TIMEOUT = 45_000
/** Resultado de "pode mandar DM?" fica guardado esse tempo (bloqueio limpa na hora). */
const CAN_DM_TTL = MINUTE

interface CallMember {
  connId: string
  userId: string
  muted: boolean
  deafened: boolean
  sharing: boolean
  camera: boolean
}

interface CallState {
  members: CallMember[]
  ringing: string[]
  ringUntil: number
  video: boolean
}

export class Conversation extends DurableObject<Env> {
  private sql: SqlStorage
  private store: MessageStore
  private channelId = ''
  private canDmCache = new Map<string, { at: number; ok: boolean }>()
  private flood = new Map<string, number[]>()
  private typingAt = new Map<string, number>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.store = new MessageStore(this.sql, env.FILE_SECRET, () => ({ kind: 'c', id: this.channelId }))
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      this.store.migrate()
      this.channelId = this.meta('channel_id') ?? ''
    })
  }

  private meta(key: string): string | null {
    return this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value ?? null
  }

  private setMeta(key: string, value: string | null) {
    if (value === null) this.sql.exec('DELETE FROM meta WHERE key = ?', key)
    else this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value)
  }

  /** Grava de qual conversa este DO cuida (só ao abrir a conversa ou na migração). */
  private ensure(channelId: string): [string, string] | null {
    const pair = dmMembers(channelId)
    if (!pair) return null
    if (!this.channelId) {
      this.channelId = channelId
      this.setMeta('channel_id', channelId)
    }
    return this.channelId === channelId ? pair : null
  }

  /** A pessoa é da conversa (e a conversa já foi aberta)? Nunca cria nada. */
  private member(channelId: string, userId: string): { pair: [string, string]; peer: string } | null {
    if (!this.channelId || this.channelId !== channelId) return null
    const pair = dmMembers(channelId)
    if (!pair || !pair.includes(userId)) return null
    return { pair, peer: pair[0] === userId ? pair[1] : pair[0] }
  }

  private async canSend(userId: string, peer: string): Promise<boolean> {
    const hit = this.canDmCache.get(userId)
    if (hit && Date.now() - hit.at < CAN_DM_TTL) return hit.ok
    const allowed = await directory(this.env).canDm(userId, peer)
    this.canDmCache.set(userId, { at: Date.now(), ok: allowed })
    return allowed
  }

  private allow(key: string, max: number, window: number): boolean {
    const now = Date.now()
    const recent = (this.flood.get(key) ?? []).filter((t) => now - t < window)
    if (recent.length >= max) return false
    recent.push(now)
    this.flood.set(key, recent)
    return true
  }

  /** Entrega um evento pros Homes dos dois (cada um repassa pros aparelhos). */
  private async deliver(event: HomeServerMessage, pair: [string, string]) {
    await Promise.allSettled(
      pair.map((userId) => home(this.env, userId).dmEvent(this.channelId, pair[0] === userId ? pair[1] : pair[0], event)),
    )
  }

  private last(): { id: string | null; at: number | null } {
    const row = this.sql
      .exec<{ id: string; created_at: number }>('SELECT id, created_at FROM messages ORDER BY id DESC LIMIT 1')
      .toArray()[0]
    return { id: row?.id ?? null, at: row?.created_at ?? null }
  }

  // ---------- Chamadas dos Homes (RPC) ----------

  /** Abre a conversa (cria se não existir). O Home já conferiu se pode. */
  open(channelId: string, userId: string): Result<{ lastMessageId: string | null; lastMessageAt: number | null }> {
    if (!this.ensure(channelId)?.includes(userId)) return fail(404, 'Conversa não encontrada.')
    const last = this.last()
    return ok({ lastMessageId: last.id, lastMessageAt: last.at })
  }

  async send(
    channelId: string,
    userId: string,
    input: { content?: unknown; attachmentIds?: unknown; nonce?: unknown; replyTo?: unknown },
  ): Promise<Result<null>> {
    const m = this.member(channelId, userId)
    if (!m) return fail(404, 'Conversa não encontrada.')
    if (!(await this.canSend(userId, m.peer))) return fail(403, 'Não dá pra mandar mensagem pra essa pessoa.')
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    if (content.length > MAX_MESSAGE_LENGTH) return fail(400, 'Mensagem grande demais.')
    const requested = Array.isArray(input.attachmentIds)
      ? input.attachmentIds.filter((id): id is string => typeof id === 'string').slice(0, 10)
      : []
    const attachments = this.store.pendingAttachments(userId, requested)
    if (!content && attachments.length === 0) return ok(null)
    if (!this.allow(`send:${userId}`, 5, 5000)) return fail(429, 'Calma! Você está mandando mensagens rápido demais.')

    const reply = typeof input.replyTo === 'string' ? this.store.get(input.replyTo) : null
    const row = this.store.insert(
      {
        id: newId(),
        channelId,
        authorId: userId,
        content,
        replyTo: reply?.id ?? null,
        mentions: reply && reply.author_id !== userId ? [reply.author_id] : [],
        mentionRoles: [],
        mentionEveryone: false,
      },
      attachments,
    )
    const [message] = await this.store.load([row])
    await this.deliver(
      { t: 'dm.message', channelId, message, nonce: typeof input.nonce === 'string' ? input.nonce.slice(0, 64) : undefined },
      m.pair,
    )
    await this.refreshEmbeds(row.id, content, m.pair)
    return ok(null)
  }

  private async refreshEmbeds(messageId: string, content: string, pair: [string, string]) {
    const embeds = await unfurlAll(content, this.env.FILE_SECRET, '')
    const row = this.store.get(messageId)
    if (!row || row.embeds === JSON.stringify(embeds)) return
    this.store.setEmbeds(messageId, embeds)
    const message = await this.store.loadOne(messageId)
    if (message) await this.deliver({ t: 'dm.edited', channelId: this.channelId, message }, pair)
  }

  async edit(channelId: string, userId: string, id: unknown, contentInput: unknown): Promise<Result<null>> {
    const m = this.member(channelId, userId)
    const row = this.store.get(id)
    if (!m || !row || row.author_id !== userId) return fail(404, 'Mensagem não encontrada.')
    // Bloqueado não reescreve mensagem antiga na tela de quem bloqueou.
    if (!(await this.canSend(userId, m.peer))) return fail(403, 'Não dá pra editar mensagens nessa conversa.')
    if (!this.allow(`edit:${userId}`, 5, 5000)) return fail(429, 'Calma! Edições rápidas demais.')
    const content = typeof contentInput === 'string' ? contentInput.trim() : ''
    if (content.length > MAX_MESSAGE_LENGTH) return fail(400, 'Mensagem grande demais.')
    if (!content && !this.store.hasAttachments(row.id)) return ok(null)
    if (content === row.content) return ok(null)
    this.store.edit(row, content, { mentions: parseMentions(row.mentions), mentionRoles: [], mentionEveryone: false })
    const message = (await this.store.loadOne(row.id))!
    await this.deliver({ t: 'dm.edited', channelId, message }, m.pair)
    await this.refreshEmbeds(row.id, content, m.pair)
    return ok(null)
  }

  /** Em conversa privada, cada um só apaga o que escreveu. */
  async remove(channelId: string, userId: string, id: unknown): Promise<Result<null>> {
    const m = this.member(channelId, userId)
    const row = this.store.get(id)
    if (!m || !row || row.author_id !== userId) return fail(404, 'Mensagem não encontrada.')
    const freed = this.store.removeRows([row])
    await this.deliver({ t: 'dm.deleted', channelId, id: row.id }, m.pair)
    if (freed > 0) await this.reportStorage()
    return ok(null)
  }

  async history(
    channelId: string,
    userId: string,
    opts: { before?: unknown; around?: unknown },
  ): Promise<Result<{ messages: Message[]; hasMore: boolean; hasNewer: boolean }>> {
    if (!this.member(channelId, userId)) return fail(404, 'Conversa não encontrada.')
    return ok(await this.store.history(channelId, opts))
  }

  async react(channelId: string, userId: string, id: unknown, emojiInput: unknown, on: boolean): Promise<Result<null>> {
    const m = this.member(channelId, userId)
    const row = this.store.get(id)
    const emoji = validEmoji(emojiInput)
    if (!m || !row || !emoji) return fail(404, 'Mensagem não encontrada.')
    if (on && !(await this.canSend(userId, m.peer))) return fail(403, 'Não dá pra reagir nessa conversa.')
    if (!this.allow(`react:${userId}`, 15, 5000)) return fail(429, 'Calma! Reações rápidas demais.')
    if (!this.store.react(row.id, userId, emoji, on)) return fail(400, 'Essa mensagem já tem reações demais.')
    await this.deliver({ t: 'dm.reactions', channelId, id: row.id, reactions: this.store.reactions(row.id) }, m.pair)
    return ok(null)
  }

  async typing(channelId: string, userId: string) {
    const m = this.member(channelId, userId)
    if (!m) return
    const now = Date.now()
    if (now - (this.typingAt.get(userId) ?? 0) < 2000) return
    this.typingAt.set(userId, now)
    if (!(await this.canSend(userId, m.peer))) return
    await home(this.env, m.peer).dmEvent(channelId, userId, { t: 'dm.typing', channelId, userId })
  }

  /** Quantas mensagens da outra pessoa depois de um id (pra contagem de não lidas). */
  unreadAfter(channelId: string, userId: string, messageId: string | null): number {
    if (!this.member(channelId, userId)) return 0
    return this.store.countAfter(channelId, messageId, userId)
  }

  /** Alguém bloqueou alguém: esquece o "pode mandar" e encerra a chamada. */
  async blocked() {
    this.canDmCache.clear()
    const call = this.call()
    if (call && this.channelId) {
      this.saveCall(null)
      await this.deliver({ t: 'call.ended', channelId: this.channelId }, dmMembers(this.channelId)!)
    }
  }

  // ---------- Arquivos ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const scope = url.pathname.match(/^\/api\/c\/([^/]+)\/files/)
    const channelId = scope ? decodeURIComponent(scope[1]) : ''
    if (request.method === 'POST' && /\/files$/.test(url.pathname)) {
      const userId = request.headers.get(USER_HEADER) ?? ''
      const m = this.member(channelId, userId)
      if (!m) return Response.json({ error: 'Conversa não encontrada.' }, { status: 404 })
      if (!(await this.canSend(userId, m.peer))) return Response.json({ error: 'Não dá pra mandar arquivo pra essa pessoa.' }, { status: 403 })
      if (!this.allow(`upload:${userId}`, 30, MINUTE)) return Response.json({ error: 'Calma! Muitos arquivos de uma vez.' }, { status: 429 })
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + ORPHAN_TTL)
      return this.store.upload(request, userId, (bytes) => this.reserve(userId, bytes))
    }
    const file = url.pathname.match(/\/files\/([\w-]+)\/[^/]+$/)
    if (file && request.method === 'GET' && this.channelId && this.channelId === channelId) return this.store.serve(request, file[1])
    return Response.json({ error: 'Rota não existe.' }, { status: 404 })
  }

  /** Bytes sendo enviados agora (dois envios ao mesmo tempo não cabem no mesmo espaço). */
  private uploading = 0

  private async reserve(userId: string, bytes: number): Promise<UploadTicket> {
    const used = this.store.filesUsed()
    if (used + this.uploading + bytes > FILES_LIMIT) return { error: 'O espaço de anexos desta conversa está cheio.' }
    this.uploading += bytes
    const scope = `c:${this.channelId}`
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
      await directory(this.env).reportStorage(`c:${this.channelId}`, this.store.filesUsed())
    } catch (err) {
      console.error('não deu pra atualizar o espaço usado', err)
    }
  }

  // ---------- Chamada ----------

  private call(): CallState | null {
    const raw = this.meta('call')
    return raw ? (JSON.parse(raw) as CallState) : null
  }

  private saveCall(call: CallState | null) {
    this.setMeta('call', call ? JSON.stringify(call) : null)
  }

  private async broadcastCall(call: CallState | null, pair: [string, string]) {
    if (!call || (call.members.length === 0 && call.ringing.length === 0)) {
      this.saveCall(null)
      return this.deliver({ t: 'call.ended', channelId: this.channelId }, pair)
    }
    this.saveCall(call)
    const members: VoiceMember[] = call.members.map((m) => ({ ...m, channelId: this.channelId }))
    await this.deliver({ t: 'call.state', channelId: this.channelId, members, ringing: call.ringing }, pair)
  }

  /** Liga (ou entra na chamada que já está rolando). */
  async callRing(channelId: string, userId: string, connId: string, video: boolean): Promise<Result<null>> {
    const m = this.member(channelId, userId)
    if (!m) return fail(404, 'Conversa não encontrada.')
    if (!(await this.canSend(userId, m.peer))) return fail(403, 'Não dá pra ligar pra essa pessoa.')
    const call = this.call() ?? { members: [], ringing: [], ringUntil: 0, video: !!video }
    call.members = call.members.filter((x) => x.userId !== userId)
    call.members.push({ connId, userId, muted: false, deafened: false, sharing: false, camera: false })
    if (!call.members.some((x) => x.userId === m.peer) && !call.ringing.includes(m.peer)) {
      call.ringing = [m.peer]
      call.ringUntil = Date.now() + RING_TIMEOUT
      await home(this.env, m.peer).dmEvent(channelId, userId, { t: 'call.ringing', channelId, from: userId, video: !!video })
      await this.ctx.storage.setAlarm(call.ringUntil)
    }
    await this.broadcastCall(call, m.pair)
    return ok(null)
  }

  async callAnswer(channelId: string, userId: string, connId: string, accept: boolean): Promise<Result<null>> {
    const m = this.member(channelId, userId)
    const call = this.call()
    if (!m || !call) return fail(404, 'Essa chamada já acabou.')
    call.ringing = call.ringing.filter((id) => id !== userId)
    if (accept) {
      call.members = call.members.filter((x) => x.userId !== userId)
      call.members.push({ connId, userId, muted: false, deafened: false, sharing: false, camera: false })
    }
    await this.broadcastCall(call, m.pair)
    return ok(null)
  }

  /** Sai da chamada (connId vazio = todas as conexões dessa pessoa). */
  async callHangup(channelId: string, userId: string, connId: string | null) {
    const m = this.member(channelId, userId)
    const call = this.call()
    if (!m || !call) return
    const before = call.members.length
    call.members = call.members.filter((x) => !(x.userId === userId && (!connId || x.connId === connId)))
    // Quem ligou desligou antes de atenderem: para de tocar.
    if (call.members.length === 0) call.ringing = []
    if (call.members.length === before && !call.ringing.includes(userId)) return
    call.ringing = call.ringing.filter((id) => id !== userId)
    await this.broadcastCall(call, m.pair)
  }

  async callUpdate(
    channelId: string,
    userId: string,
    connId: string,
    flags: { muted: boolean; deafened: boolean; sharing: boolean; camera: boolean },
  ) {
    const m = this.member(channelId, userId)
    const call = this.call()
    const entry = call?.members.find((x) => x.connId === connId && x.userId === userId)
    if (!m || !call || !entry) return
    Object.assign(entry, { muted: !!flags.muted, deafened: !!flags.deafened, sharing: !!flags.sharing, camera: !!flags.camera })
    await this.broadcastCall(call, m.pair)
  }

  /** Repassa a sinalização WebRTC entre duas conexões que estão na chamada. */
  async callSignal(channelId: string, userId: string, fromConnId: string, to: string, data: SignalData) {
    const m = this.member(channelId, userId)
    const call = this.call()
    if (!m || !call || !call.members.some((x) => x.connId === fromConnId && x.userId === userId)) return
    const target = call.members.find((x) => x.connId === to)
    if (!target) return
    await home(this.env, target.userId).callEvent({ t: 'call.signal', channelId, from: fromConnId, data }, target.connId)
  }

  async alarm() {
    const now = Date.now()
    const call = this.call()
    if (call && call.ringing.length > 0 && call.ringUntil <= now && this.channelId) {
      call.ringing = []
      await this.broadcastCall(call, dmMembers(this.channelId)!)
    }
    if (this.store.removeOrphans(now - ORPHAN_TTL) > 0) await this.reportStorage()
    const pending = this.sql.exec('SELECT 1 FROM attachments WHERE message_id IS NULL LIMIT 1').toArray().length > 0
    if (pending) await this.ctx.storage.setAlarm(now + ORPHAN_TTL)
  }

  // ---------- Migração da 0.5 ----------

  /**
   * Copia as mensagens (e os arquivos) de uma conversa privada que morava no
   * "main" da 0.5. Vai em lotes e lembra onde parou: se cair no meio, continua.
   */
  async importLegacy(channelId: string): Promise<{ members: [string, string]; lastMessageId: string | null; lastMessageAt: number | null } | null> {
    const pair = this.ensure(channelId)
    if (!pair) return null
    const main = guild(this.env, 'main')
    let after = this.meta('import_after') ?? ''
    for (;;) {
      const batch = await main.legacyDmBatch(channelId, after)
      if (batch.messages.length === 0) break
      for (const a of batch.attachments) {
        if (this.store.hasAttachment(a.id)) continue
        const res = await main.fetch(new Request(`https://internal/internal/legacy-file/${a.id}`))
        this.store.files.delete([a.id]) // sobra de uma tentativa que caiu no meio
        if (res.ok && res.body) await this.store.files.put(a.id, res.body, Math.max(a.size, 1))
        else if (a.size > 0) continue // o arquivo sumiu: a mensagem fica sem ele
        this.store.importAttachment(a)
      }
      this.store.importRows(batch.messages)
      after = batch.messages[batch.messages.length - 1].id
      this.setMeta('import_after', after)
    }
    await this.reportStorage()
    const last = this.last()
    return { members: pair, lastMessageId: last.id, lastMessageAt: last.at }
  }
}

function parseMentions(text: string): string[] {
  try {
    const value = JSON.parse(text)
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}
