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
  type Message,
  type Presence,
  type PushTestResult,
  type Status,
  type User,
  type VoiceMember,
} from '../../shared/protocol'
import { samePresence } from './presence'
import { PUSH_TEXT, Pusher, pushBody, type PushLocale, type PushMessage } from './push'
import { CLOSE_RETRY, CONN_KEY, GHOST_QUEUE, GHOST_QUEUE_BYTES, IP_HEADER, admitPending, connIdFor, graceFor, unexpectedClose } from './resume'
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
  /** IP embaralhado de quem abriu (só pra vaga das conexões sem login). */
  ip?: string
  /**
   * Ausente automático desta conexão (o aparelho parado). O status escolhido (invisível, não
   * perturbe…) é da pessoa e fica no `meta`: vale pra todas as conexões, até as que acabaram de abrir.
   */
  idle?: boolean
  /** Conversa privada em cuja chamada esta conexão está. */
  call?: string | null
  /** Mandou chave no `auth`: se cair, dá pra voltar na chamada (ver resume.ts). */
  resumable?: boolean
  /** Outra conexão com a mesma chave tomou o lugar desta: ao fechar, não mexe em nada. */
  replaced?: boolean
  /** App do celular (não segura o push: ver `pushDevices`). */
  mobile?: boolean
  /** Computador com a pessoa olhando o app agora (janela em foco e mexida há pouco): segura o push. */
  attention?: boolean
}

interface PushRow {
  token: string
  session: string
  locale: string
  preview: number
  [key: string]: SqlStorageValue
}

/** Conexão que caiu sem avisar, esperando o app voltar. */
interface Ghost {
  state: HomeConn
  timer: ReturnType<typeof setTimeout>
  /** Sinalização da chamada que chegou enquanto isso, entregue na volta. */
  queue: string[]
  /** Tamanho do que está na fila. */
  bytes: number
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
/** Conexões abertas que ainda não se autenticaram. */
const MAX_PENDING = 20
/** Conexões autenticadas ao mesmo tempo (aparelhos e janelas do app, de sobra). */
const MAX_CONNECTIONS = 20
const STATUSES: Status[] = ['online', 'idle', 'dnd', 'invisible']
/** Token do Firebase: letras, números e pontuação simples (uns 160 caracteres hoje). */
const PUSH_TOKEN = /^[\w:.-]{20,4096}$/
const MAX_PUSH_DEVICES = 10
/** O aviso de teste sai depois disso: o tempo de sair do app (com ele na frente, o Android não mostra). */
const PUSH_TEST_DELAY = 5000

/** Cabeçalho que o Worker põe com o id do dono deste Home. */
export const HOME_HEADER = 'X-Resenha-Home'

export class Home extends DurableObject<Env> {
  private sql: SqlStorage
  private userId = ''
  private flood = new Map<string, number[]>()
  /** connId -> conexão que caiu e ainda pode voltar (continua na chamada e online até lá). */
  private ghosts = new Map<string, Ghost>()
  /** Sockets que já saíram (o fechamento e o erro podem chegar os dois). */
  private retired = new WeakSet<WebSocket>()
  /** Mandaram o `auth` e o Directory ainda está conferindo o token. */
  private authenticating = new WeakSet<WebSocket>()
  /** Push pro celular (Firebase); sem a chave, não manda nada. Os testes trocam o `fetchImpl`. */
  private pusher: Pusher

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.pusher = new Pusher(env.FCM_SERVICE_ACCOUNT)
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
      // Aparelhos com push (celular), cada um preso à sessão em que entrou.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS push_tokens (
        token TEXT PRIMARY KEY,
        session TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'pt',
        preview INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      )`)
      // Avisos que foram pro celular e ninguém viu ainda (a etiqueta, e a mensagem do aviso):
      // lidos em qualquer aparelho, saem do celular (pushSeen).
      this.sql.exec('CREATE TABLE IF NOT EXISTS push_open (tag TEXT PRIMARY KEY, message_id TEXT)')
      // Chamadas privadas em andamento nas conversas da pessoa (o `ready` traz como estão agora).
      this.sql.exec('CREATE TABLE IF NOT EXISTS calls (channel_id TEXT PRIMARY KEY, at INTEGER NOT NULL)')
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

  private raw(ws: WebSocket, text: string) {
    try {
      ws.send(text)
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

  /**
   * O que os amigos veem: o status escolhido vale pra todos os aparelhos (invisível aparece
   * offline), e "online" só vira "ausente" com todos os aparelhos parados. Até a 1.14 valia o
   * status que cada conexão dizia, e o app recém-aberto dizia "online" antes de saber o escolhido.
   */
  presence(exceptConnId?: string): Presence {
    return this.presenceOf([...this.sockets(exceptConnId).map((ws) => this.state(ws)), ...this.ghostStates(exceptConnId)])
  }

  private presenceOf(states: HomeConn[]): Presence {
    if (states.length === 0) return { status: 'offline', text: null }
    const { status, text } = this.manual()
    if (status === 'invisible') return { status: 'offline', text: null }
    if (status === 'dnd') return { status: 'dnd', text }
    return { status: status === 'idle' || states.every((s) => s.idle === true) ? 'idle' : 'online', text }
  }

  private ghostStates(exceptConnId?: string): HomeConn[] {
    return [...this.ghosts.values()].map((g) => g.state).filter((s) => s.connId !== exceptConnId)
  }

  // ---------- Reconexão (ver resume.ts) ----------

  /** Caiu sem avisar: continua na chamada e online por um tempo, esperando o app voltar. */
  private holdGhost(state: HomeConn, queue: string[] = []) {
    const existing = this.ghosts.get(state.connId)
    if (existing) clearTimeout(existing.timer)
    const kept = existing?.queue ?? queue
    this.ghosts.set(state.connId, {
      state,
      queue: kept,
      bytes: existing?.bytes ?? kept.reduce((n, text) => n + text.length, 0),
      timer: setTimeout(() => {
        this.releaseGhost(state.connId).catch((err) => console.error('não deu pra encerrar a conexão que caiu', err))
      }, graceFor(this.env)),
    })
  }

  /** O app não voltou a tempo: sai da chamada e fica offline de vez. */
  private async releaseGhost(connId: string) {
    const ghost = this.ghosts.get(connId)
    if (!ghost) return
    const before = this.presence()
    this.ghosts.delete(connId)
    const { call } = ghost.state
    if (call) await conversation(this.env, call).callHangup(call, this.userId, connId)
    await this.announce(before)
  }

  /** Tira os fantasmas que batem (sessão encerrada, conta excluída), desligando as chamadas deles. */
  private async dropGhosts(match: (state: HomeConn) => boolean) {
    const before = this.presence()
    let dropped = false
    for (const [connId, ghost] of [...this.ghosts]) {
      if (!match(ghost.state)) continue
      clearTimeout(ghost.timer)
      this.ghosts.delete(connId)
      dropped = true
      const { call } = ghost.state
      if (call) await conversation(this.env, call).callHangup(call, this.userId, connId)
    }
    // Sem isso, os amigos continuavam vendo online quem teve a sessão encerrada.
    if (dropped) await this.announce(before)
  }

  /**
   * A mesma instância do app voltou (mesmo connId): pega a chamada da conexão
   * anterior, que caiu (fantasma) ou ainda parece aberta mas morreu, e o que
   * ficou guardado pra ela. A anterior fecha sem mexer em nada.
   */
  private takeOver(ws: WebSocket, connId: string): { call: string | null; queue: string[] } {
    let call: string | null = null
    let queue: string[] = []
    const ghost = this.ghosts.get(connId)
    if (ghost) {
      clearTimeout(ghost.timer)
      this.ghosts.delete(connId)
      call = ghost.state.call ?? null
      queue = ghost.queue
    }
    for (const old of this.ctx.getWebSockets()) {
      if (old === ws) continue
      const state = this.state(old)
      if (state.pending || state.connId !== connId) continue
      call = state.call ?? call
      this.retired.add(old)
      try {
        this.save(old, { ...state, call: null, replaced: true })
        old.close(4005, 'Outra conexão tomou o lugar')
      } catch {
        // já estava fechando
      }
    }
    return { call, queue }
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
    // O endereço do nosso servidor (a prévia de link nunca busca ele mesmo).
    const host = new URL(request.url).hostname
    if (this.meta('host') !== host) this.setMeta('host', host)
    const ip = request.headers.get(IP_HEADER)
    const pending = this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN && this.state(ws).pending)
      .map((ws) => ({ ws, ...this.state(ws) }))
    if (!admitPending(pending, ip, MAX_PENDING)) return new Response('Ocupado, tente de novo', { status: 503 })
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    const now = Date.now()
    const state: HomeConn = {
      userId: '',
      connId: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      session: '',
      connectedAt: now,
      pending: true,
      ...(ip ? { ip } : {}),
    }
    server.serializeAttachment(state)
    // A varredura vem logo depois do prazo do `auth` (quem não se autentica não fica ocupando vaga).
    const at = await this.ctx.storage.getAlarm()
    if (at === null || at > now + AUTH_TIMEOUT + 1000) await this.ctx.storage.setAlarm(now + AUTH_TIMEOUT + 1000)
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
    const key = typeof msg.key === 'string' && CONN_KEY.test(msg.key) ? msg.key : null
    const connId = key ? await connIdFor(auth.me.id, key) : pending.connId
    if (ws.readyState !== WebSocket.OPEN) return

    // Aparelhos demais da mesma pessoa (um script abrindo conexões): a nova espera e tenta depois.
    if (this.sockets().filter((s) => this.state(s).connId !== connId).length >= MAX_CONNECTIONS) {
      return ws.close(1013, 'Conexões demais')
    }

    const manual = this.manual()
    const before = this.presence()
    const resumed = key ? this.takeOver(ws, connId) : { call: null, queue: [] }
    const claimed = typeof msg.call === 'string' && this.known(msg.call) ? msg.call : null
    // O app saiu da chamada enquanto estava sem conexão (o "desligar" não chegou): a conexão
    // anterior sai dela agora, em vez de voltar pra lá sem o app saber.
    if (resumed.call && resumed.call !== claimed) {
      await conversation(this.env, resumed.call).callHangup(resumed.call, this.userId, connId)
      resumed.call = null
    }
    // A chamada em que o app estava (a retomada, ou a que ele diz): como está agora.
    const asked = resumed.call ?? claimed
    const callNow = asked ? await conversation(this.env, asked).callSnapshot(asked, this.userId) : null
    // Só volta na chamada se ela ainda conta com esta conexão.
    const call = resumed.call && callNow?.members.some((m) => m.connId === connId) ? resumed.call : null
    const state: HomeConn = {
      ...pending,
      connId,
      resumable: !!key,
      userId: auth.me.id,
      session: auth.tokenHash,
      pending: false,
      // O status vem do que a pessoa escolheu (no `meta`); a conexão só diz se está parada.
      idle: msg.status === 'idle',
      call,
      mobile: msg.mobile === true,
      attention: msg.attention === true,
    }
    // Caiu de novo enquanto voltava: continua esperando (com a chamada e o que estava guardado).
    if (ws.readyState !== WebSocket.OPEN) {
      if (call) this.holdGhost(state, resumed.queue)
      return
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
    const calls = await this.activeCalls(asked && callNow ? { channelId: asked, ...callNow } : null)
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
      resumed: !!call,
      ...(asked ? { call: callNow ? { channelId: asked, ...callNow } : null } : {}),
      calls,
    })
    if (call) for (const queued of resumed.queue) this.raw(ws, queued)
    await this.announce(before)
  }

  /**
   * As chamadas privadas que estão rolando nas conversas da pessoa, como estão agora: quem
   * volta (o celular depois do push, uma queda no meio do toque) vê a ligação tocando, ou
   * que ela já acabou. `known`: a que já foi buscada (a do `auth.call`).
   */
  private async activeCalls(known: { channelId: string; members: VoiceMember[]; ringing: string[] } | null) {
    const ids = this.sql.exec<{ channel_id: string }>('SELECT channel_id FROM calls').toArray().map((r) => r.channel_id)
    const out: { channelId: string; members: VoiceMember[]; ringing: string[] }[] = []
    await Promise.allSettled(
      ids.map(async (channelId) => {
        if (known?.channelId === channelId) return void out.push(known)
        const snapshot = this.known(channelId) ? await conversation(this.env, channelId).callSnapshot(channelId, this.userId) : null
        if (snapshot) out.push({ channelId, ...snapshot })
        else this.sql.exec('DELETE FROM calls WHERE channel_id = ?', channelId)
      }),
    )
    if (known && !out.some((c) => c.channelId === known.channelId)) out.push(known)
    return out
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
      // O app até a 1.14 manda coisas logo depois do `auth`, sem esperar o `ready`. Enquanto o
      // Directory confere o token, o que chega fica de fora: antes fechava com 4001, e o app
      // tratava como sessão vencida (deslogava e saía da call).
      if (this.authenticating.has(ws)) return
      if (msg.t !== 'auth') return ws.close(CLOSE_RETRY, 'Faltou autenticar')
      this.authenticating.add(ws)
      try {
        return await this.completeAuth(ws, state, msg)
      } catch (err) {
        // Directory reiniciando (deploy) ou sobrecarregado: o app tenta de novo, sem deslogar.
        console.error('não deu pra autenticar a conexão', err)
        try {
          ws.close(1011, 'Erro no servidor')
        } catch {
          // já estava fechando
        }
        return
      } finally {
        this.authenticating.delete(ws)
      }
    }
    // Limite por conexão (sinalização da chamada tem folga maior: muitos candidatos ICE de uma vez),
    // e um da pessoa, somando os aparelhos: abrir conexões não multiplica o que dá pra mandar.
    const signal = msg.t === 'call.signal'
    if (
      !this.allow(`${signal ? 'sig' : 'ws'}:${state.connId}`, signal ? 400 : 120, 10_000) ||
      !this.allow(signal ? 'sig' : 'ws', signal ? 800 : 240, 10_000)
    ) {
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
    await this.dropConnection(ws, this.state(ws), unexpectedClose(code))
  }

  async webSocketError(ws: WebSocket) {
    await this.dropConnection(ws, this.state(ws), true)
  }

  /** `unexpected`: caiu sem o app pedir (rede, servidor reiniciando). */
  private async dropConnection(ws: WebSocket, state: HomeConn, unexpected: boolean) {
    if (state.pending || !state.userId || state.replaced || this.retired.has(ws)) return
    this.retired.add(ws)
    // A mesma instância do app já voltou por outra conexão: ela ficou com tudo.
    if (this.sockets().some((s) => s !== ws && this.state(s).connId === state.connId)) return
    if (unexpected && state.resumable) return this.holdGhost(state)
    // O socket que caiu já não está aberto: o "antes" inclui ele à mão.
    const before = this.presenceOf([...this.sockets(state.connId).map((s) => this.state(s)), ...this.ghostStates(state.connId), state])
    if (state.call) await conversation(this.env, state.call).callHangup(state.call, this.userId, state.connId)
    await this.announce(before, state.connId)
  }

  /** Ainda tem quem responda por esse connId (a conexão, ou ela esperando voltar)? */
  private reachable(connId: string): boolean {
    return this.ghosts.has(connId) || this.sockets().some((s) => this.state(s).connId === connId)
  }

  async alarm() {
    const now = Date.now()
    let next = now + SWEEP_EVERY
    for (const ws of this.ctx.getWebSockets()) {
      const state = this.state(ws)
      if (!state.pending) continue
      if (state.connectedAt < now - AUTH_TIMEOUT) ws.close(CLOSE_RETRY, 'Faltou autenticar')
      else next = Math.min(next, state.connectedAt + AUTH_TIMEOUT + 1000)
    }
    for (const ws of this.sockets()) {
      const state = this.state(ws)
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0
      if (Math.max(lastPing, state.connectedAt) < now - DEAD_AFTER) {
        ws.close(4000, 'Sem resposta')
        await this.dropConnection(ws, state, true)
      }
    }
    if (this.ctx.getWebSockets().length > 0) await this.ctx.storage.setAlarm(next)
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
    // Com `reqId`, quem pediu sabe na hora que falhou (sem esperar o tempo-limite).
    const error = (message: string, reqId?: unknown) =>
      this.send(ws, { t: 'error', message, ...(typeof reqId === 'string' ? { reqId: reqId.slice(0, 64) } : {}) })
    const result = (r: { ok: true } | { ok: false; error: string }) => {
      if (!r.ok) error(r.error)
    }

    switch (msg.t) {
      case 'presence': {
        if (!STATUSES.includes(msg.status) || !this.allow(`presence:${state.connId}`, 30, 60_000)) return
        const before = this.presence()
        if (msg.auto) {
          // Ausente automático (o aparelho parado): só desta conexão.
          this.save(ws, { ...state, idle: msg.status === 'idle' })
        } else {
          // Escolha da pessoa: vale pra todos os aparelhos.
          const text = cleanLine(msg.text, 1, 128)
          this.setMeta('status', msg.status)
          this.setMeta('text', text)
          this.save(ws, { ...state, idle: false })
          this.broadcast({ t: 'presence.self', status: msg.status, text }, { except: state.connId })
        }
        return this.announce(before)
      }

      case 'attention': {
        // Estado (não ação): perder o "parei de olhar" deixava o push do celular segurado.
        if (state.mobile || !this.allow(`attention:${state.connId}`, 120, 60_000)) return
        this.save(ws, { ...state, attention: msg.on === true })
        return
      }

      case 'push.test': {
        if (!this.allow(`push-test:${state.connId}`, 3, 60_000)) return
        const devices = this.sql.exec<PushRow>('SELECT * FROM push_tokens WHERE session = ?', state.session).toArray()
        if (!this.pusher.enabled || devices.length === 0) {
          return this.send(ws, { t: 'push.test', result: this.pusher.enabled ? 'no-device' : 'off' })
        }
        // Daqui a 5 s: com o app aberto na frente, o Android não mostra o aviso (quem testa sai do app).
        this.ctx.waitUntil(
          (async () => {
            await new Promise((r) => setTimeout(r, Number(this.env.PUSH_TEST_DELAY_MS ?? PUSH_TEST_DELAY)))
            const result = await this.pushTest(devices)
            if (ws.readyState === WebSocket.OPEN) this.send(ws, { t: 'push.test', result })
          })(),
        )
        return
      }

      case 'push.token': {
        if (!this.allow(`push:${state.connId}`, 10, 60_000)) return
        // O aparelho troca de token de vez em quando: o desta sessão sai e o novo entra.
        this.sql.exec('DELETE FROM push_tokens WHERE session = ?', state.session)
        if (typeof msg.token !== 'string' || !PUSH_TOKEN.test(msg.token)) return
        const locale = msg.locale === 'en' || msg.locale === 'es' ? msg.locale : 'pt'
        this.sql.exec(
          `INSERT INTO push_tokens (token, session, locale, preview, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (token) DO UPDATE SET session = excluded.session, locale = excluded.locale, preview = excluded.preview`,
          msg.token,
          state.session,
          locale,
          msg.preview === false ? 0 : 1,
          Date.now(),
        )
        // Aparelhos demais (sessões esquecidas): ficam os mais novos.
        this.sql.exec(
          'DELETE FROM push_tokens WHERE token NOT IN (SELECT token FROM push_tokens ORDER BY created_at DESC LIMIT ?)',
          MAX_PUSH_DEVICES,
        )
        return
      }

      case 'dm.open': {
        const peerId = typeof msg.userId === 'string' ? msg.userId : ''
        if (!peerId || peerId === me) return
        const channelId = dmChannelId(me, peerId)
        const existing = this.sql.exec<DmRow>('SELECT * FROM dms WHERE channel_id = ?', channelId).toArray()[0]
        const peer = await directory(this.env).getUser(peerId)
        if (!peer || peer.deleted) return error('Pessoa não encontrada.', msg.reqId)
        if (!existing && !(await directory(this.env).canDm(me, peerId))) {
          return error('Essa pessoa só recebe mensagem de amigos.', msg.reqId)
        }
        const opened = await conversation(this.env, channelId).open(channelId, me)
        if (!opened.ok) return error(opened.error, msg.reqId)
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
        const sent = await conversation(this.env, msg.channelId).send(msg.channelId, me, msg, this.meta('host') ?? '')
        // Erro de envio volta com o nonce: o app devolve o texto pro campo.
        if (!sent.ok) this.send(ws, { t: 'error', message: sent.error, ...(nonce ? { nonce } : {}) })
        return
      }

      case 'dm.edit':
        if (!this.known(msg.channelId)) return
        return result(await conversation(this.env, msg.channelId).edit(msg.channelId, me, msg.id, msg.content, this.meta('host') ?? ''))

      case 'dm.delete':
        if (!this.known(msg.channelId)) return
        return result(await conversation(this.env, msg.channelId).remove(msg.channelId, me, msg.id))

      case 'dm.history': {
        if (!this.known(msg.channelId)) return error('Conversa não encontrada.', msg.reqId)
        // `around`: pular pra uma mensagem antiga (a resposta citada, uma fixada).
        const page = await conversation(this.env, msg.channelId).history(msg.channelId, me, { before: msg.before, around: msg.around })
        if (!page.ok) return error(page.error, msg.reqId)
        return this.send(ws, {
          t: 'dm.history',
          reqId: String(msg.reqId),
          channelId: msg.channelId,
          messages: page.value.messages,
          hasMore: page.value.hasMore,
          hasNewer: page.value.hasNewer,
        })
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
        this.ctx.waitUntil(this.pushSeen(`dm:${row.channel_id}`, lastReadId))
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
            ? await room.callRing(msg.channelId, me, state.connId, !!msg.video, msg.state)
            : await room.callAnswer(msg.channelId, me, state.connId, !!msg.accept, msg.state)
        if (!r.ok) {
          if (joining && ws.readyState === WebSocket.OPEN) this.save(ws, { ...this.state(ws), call: null })
          return error(r.error)
        }
        // Caiu enquanto entrava e a queda já foi tratada sem esperar volta (antes de a chamada
        // contar com ela): sai de novo. Se a queda ainda vai ser tratada, ela cuida disso.
        if (joining && ws.readyState !== WebSocket.OPEN && this.retired.has(ws) && !this.reachable(state.connId)) {
          await room.callHangup(msg.channelId, me, state.connId)
        }
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
    // Ligação chegando numa conversa que a pessoa nunca abriu (ou escondeu): a conversa aparece na lista.
    if (event.t === 'call.ringing') {
      const existing = this.dmRow(channelId)
      if (!existing || existing.open === 0) {
        this.sql.exec(
          'INSERT INTO dms (channel_id, peer_id, open) VALUES (?, ?, 1) ON CONFLICT (channel_id) DO UPDATE SET open = 1',
          channelId,
          peerId,
        )
        const peer = await directory(this.env).getUser(peerId)
        const row = this.dmRow(channelId)
        if (peer && row) this.broadcast({ t: 'dm.channel', channel: this.toDm(row, peer) })
      }
    }
    // Chamadas em andamento (o `ready` de quem conecta depois traz como estão).
    if (event.t === 'call.state') {
      this.sql.exec('INSERT INTO calls (channel_id, at) VALUES (?, ?) ON CONFLICT (channel_id) DO UPDATE SET at = excluded.at', channelId, Date.now())
    }
    if (event.t === 'call.ended') this.sql.exec('DELETE FROM calls WHERE channel_id = ?', channelId)
    // Atendeu em outro aparelho, recusou, ou a ligação acabou: o "está ligando" sai do celular.
    if ((event.t === 'call.state' && !event.ringing.includes(this.userId)) || event.t === 'call.ended') {
      this.ctx.waitUntil(this.pushSeen(`call:${channelId}`))
    }
    // Apagaram uma mensagem: a última da conversa e a contagem de não lidas acompanham.
    if (event.t === 'dm.deleted') await this.messageDeleted(channelId, event)
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
      // Respondeu (de qualquer aparelho): leu o que tinha antes.
      if (mine) this.ctx.waitUntil(this.pushSeen(`dm:${channelId}`, event.message.id))
      // Quem recebe o push se decide agora (o computador pode virar "ausente" enquanto o nome chega).
      const devices = mine ? [] : this.pushDevices()
      if (devices.length) this.ctx.waitUntil(this.pushDm(devices, channelId, peerId, event.message))
    }
    if (event.t === 'call.ringing') {
      const devices = this.pushDevices()
      if (devices.length) this.ctx.waitUntil(this.pushCall(devices, channelId, event.from, event.video))
    }
    this.broadcast(event)
  }

  private async messageDeleted(channelId: string, event: Extract<HomeServerMessage, { t: 'dm.deleted' }>) {
    const row = this.dmRow(channelId)
    if (!row) return
    if (event.last !== undefined && row.last_message_id === event.id) {
      this.sql.exec('UPDATE dms SET last_message_id = ?, last_message_at = ? WHERE channel_id = ?', event.last.id, event.last.at, channelId)
    }
    if (row.unread === 0 || (row.last_read_id && event.id <= row.last_read_id)) return
    const unread = await conversation(this.env, channelId).unreadAfter(channelId, this.userId, row.last_read_id)
    if (unread === row.unread) return
    this.sql.exec('UPDATE dms SET unread = ? WHERE channel_id = ?', unread, channelId)
    this.broadcast({ t: 'dm.read', channelId, lastReadId: row.last_read_id, unread })
  }

  /** Mensagem num servidor que pede aviso (menção, ou canal em "todas as mensagens"): vem do Guild. */
  async guildPush(input: {
    guildId: string
    channelId: string
    /** A mensagem do aviso (o "lido" até antes dela não tira o aviso). */
    messageId?: string
    author: string
    channel: string
    server: string
    content: string
    attachments: { name: string }[]
    /** Nome de quem foi mencionado (pro texto: <@id> vira @nome). */
    names: Record<string, string>
    /** Nomes dos cargos e canais citados (<@&id>, <#id>). */
    roles?: Record<string, string>
    channels?: Record<string, string>
  }): Promise<boolean> {
    // Sem aparelho com push, o servidor pode parar de perguntar por um tempo (devolve false).
    if (!this.pusher.enabled || this.sql.exec('SELECT 1 FROM push_tokens LIMIT 1').toArray().length === 0) return false
    const lookup = {
      user: (id: string) => input.names[id] ?? null,
      role: (id: string) => input.roles?.[id] ?? null,
      channel: (id: string) => input.channels?.[id] ?? null,
    }
    await this.push(this.pushDevices(), input.messageId ?? null, (text, preview) => ({
      title: text.inChannel(input.author, input.channel, input.server),
      body: preview ? pushBody(input.content, input.attachments, lookup, text) || text.hidden : text.hidden,
      data: { kind: 'channel', guildId: input.guildId, channelId: input.channelId },
      tag: `channel:${input.channelId}`,
      kind: 'message',
    }))
    return true
  }

  // ---------- Push (celular) ----------

  /**
   * Os aparelhos que recebem push agora: nenhum com "Não perturbe" nem com a pessoa olhando o
   * app no computador (lá ela já vê o aviso). Só o computador aberto, em outra janela ou com a
   * pessoa longe, não segura: até a 1.14.1 segurava por 10 min depois da última mexida (e pra
   * sempre com a janela em foco), e o celular de quem deixava o computador ligado não avisava.
   * Decidido na hora em que o aviso nasce.
   */
  private pushDevices(): PushRow[] {
    if (!this.pusher.enabled || this.manual().status === 'dnd') return []
    const looking = this.sockets().some((ws) => {
      const s = this.state(ws)
      return !s.pending && !s.mobile && s.attention === true
    })
    return looking ? [] : this.sql.exec<PushRow>('SELECT * FROM push_tokens').toArray()
  }

  /** O aviso de teste pros aparelhos desta sessão (sem as regras de quando segurar). */
  private async pushTest(devices: PushRow[]): Promise<PushTestResult> {
    const text = PUSH_TEXT[(devices[0].locale in PUSH_TEXT ? devices[0].locale : 'pt') as PushLocale]
    try {
      const { dead, failed } = await this.pusher.send(
        devices.map((d) => d.token),
        { title: text.testTitle, body: text.testBody, data: { kind: 'test' }, tag: 'test', kind: 'message' },
      )
      for (const token of dead) this.sql.exec('DELETE FROM push_tokens WHERE token = ?', token)
      return dead.length === devices.length ? 'dead' : failed.length === devices.length ? 'failed' : 'sent'
    } catch (err) {
      console.error('push de teste', err)
      return 'failed'
    }
  }

  /**
   * Manda pros aparelhos: uma mensagem por idioma (e por "mostrar o texto"); tira os tokens que morreram.
   * O aviso fica anotado antes de sair, pra um "lido" que chegue durante o envio já tirar ele.
   * `messageId`: a mensagem do aviso (null na ligação).
   */
  private async push(devices: PushRow[], messageId: string | null, build: (text: (typeof PUSH_TEXT)[PushLocale], preview: boolean) => PushMessage) {
    const groups = new Map<string, PushRow[]>()
    for (const row of devices) {
      const key = `${row.locale}:${row.preview}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    let noted = false
    for (const rows of groups.values()) {
      const locale = (rows[0].locale in PUSH_TEXT ? rows[0].locale : 'pt') as PushLocale
      const message = build(PUSH_TEXT[locale], rows[0].preview === 1)
      if (!noted) {
        this.sql.exec(
          'INSERT INTO push_open (tag, message_id) VALUES (?, ?) ON CONFLICT (tag) DO UPDATE SET message_id = excluded.message_id',
          message.tag,
          messageId,
        )
        noted = true
      }
      try {
        const { dead } = await this.pusher.send(
          rows.map((r) => r.token),
          message,
        )
        for (const token of dead) this.sql.exec('DELETE FROM push_tokens WHERE token = ?', token)
      } catch (err) {
        console.error('push', err)
      }
    }
  }

  /**
   * A pessoa viu (leu a conversa ou o canal, atendeu, a ligação acabou), aqui ou em outro aparelho:
   * o aviso que foi pro celular sai de lá. `lastReadId`: até onde leu (o aviso de uma mensagem mais
   * nova fica). Devolve se tem aparelho com push (sem, o Guild para de perguntar por um tempo).
   */
  async pushSeen(tag: string, lastReadId: string | null = null): Promise<boolean> {
    const devices = this.sql.exec<PushRow>('SELECT * FROM push_tokens').toArray()
    if (!this.pusher.enabled || devices.length === 0) return false
    const open = this.sql.exec<{ message_id: string | null }>('SELECT message_id FROM push_open WHERE tag = ?', tag).toArray()[0]
    if (!open || (open.message_id && (!lastReadId || lastReadId < open.message_id))) return true
    this.sql.exec('DELETE FROM push_open WHERE tag = ?', tag)
    try {
      const { dead } = await this.pusher.dismiss(devices.map((d) => d.token), tag)
      for (const token of dead) this.sql.exec('DELETE FROM push_tokens WHERE token = ?', token)
    } catch (err) {
      console.error('push (tirar o aviso)', err)
    }
    return true
  }

  private async pushDm(devices: PushRow[], channelId: string, peerId: string, message: Message) {
    const peer = await directory(this.env).getUser(peerId)
    const name = peer?.name ?? '…'
    await this.push(devices, message.id, (text, preview) => ({
      title: name,
      body: preview ? pushBody(message.content, message.attachments, { user: (id) => (id === peerId ? name : null) }, text) || text.hidden : text.hidden,
      data: { kind: 'dm', channelId },
      tag: `dm:${channelId}`,
      kind: 'message',
    }))
  }

  private async pushCall(devices: PushRow[], channelId: string, from: string, video: boolean) {
    const name = (await directory(this.env).getUser(from))?.name ?? '…'
    await this.push(devices, null, (text) => ({
      title: video ? text.videoCalling(name) : text.calling(name),
      body: text.tapToAnswer,
      data: { kind: 'call', channelId },
      tag: `call:${channelId}`,
      kind: 'call',
    }))
  }

  /** Quem esta pessoa bloqueou/desbloqueou: a conversa entre os dois (se existir) fica sabendo. */
  async dmBlocked(otherId: string) {
    const row = this.sql.exec<DmRow>('SELECT * FROM dms WHERE peer_id = ?', otherId).toArray()[0]
    if (row) await conversation(this.env, row.channel_id).blocked()
  }

  /** Evento de chamada privada; com `connId`, só pra aquela conexão. */
  callEvent(event: HomeServerMessage, connId?: string) {
    // Pra uma conexão que caiu e ainda pode voltar: entrega quando voltar.
    const ghost = connId ? this.ghosts.get(connId) : undefined
    if (ghost) {
      const text = JSON.stringify(event)
      if (ghost.queue.length < GHOST_QUEUE && ghost.bytes + text.length <= GHOST_QUEUE_BYTES) {
        ghost.queue.push(text)
        ghost.bytes += text.length
      }
      return
    }
    this.broadcast(event, connId ? { connId } : {})
  }

  /** Ainda tem quem responda por essa conexão (a chamada não ficou com alguém que sumiu num reinício)? */
  connAlive(connId: string): boolean {
    return this.reachable(connId)
  }

  /** A conversa existe pra esta pessoa (o Worker confere antes de acordar o DO dela). */
  knowsDm(channelId: string): boolean {
    return this.known(channelId)
  }

  async closeSessions(tokenHashes: string[]) {
    const set = new Set(tokenHashes)
    // Saiu (ou a sessão foi encerrada): aquele aparelho para de receber push.
    for (const hash of set) this.sql.exec('DELETE FROM push_tokens WHERE session = ?', hash)
    for (const ws of this.ctx.getWebSockets()) {
      const state = this.state(ws)
      if (state.pending || !set.has(state.session)) continue
      this.send(ws, { t: 'session.revoked' })
      ws.close(4001, 'Sessão encerrada')
      await this.dropConnection(ws, state, false)
    }
    await this.dropGhosts((s) => set.has(s.session))
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
    await this.dropGhosts(() => true)
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
