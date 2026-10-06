import {
  dmChannelId,
  dmMembers,
  type Channel,
  type ClientMessage,
  type Message,
  type ServerMessage,
  type User,
  type VoiceMember,
} from '../../../../shared/protocol'
import type { DesktopPrefs, PlatformInfo, SavedSession, ShortcutAction, UpdateState } from '../../preload/api'
import { Api } from './api'
import { Call } from './call.svelte'
import { playSound } from './sounds'
import { ui } from './ui.svelte'
import { Connection, type ConnectionStatus } from './ws'

/** O servidor do grupo é sempre o mesmo; definido no build (VITE_DEFAULT_SERVER) pra testes locais. */
export const DEFAULT_SERVER = import.meta.env.VITE_DEFAULT_SERVER || 'https://resenha.lucaslomiento.workers.dev'

export interface Toast {
  id: number
  text: string
  kind: 'error' | 'info'
}

let toastId = 0
let reqId = 0

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
}

class Store {
  phase = $state<'boot' | 'login' | 'app'>('boot')
  status = $state<ConnectionStatus>('connecting')
  platform = $state<PlatformInfo | null>(null)
  desktop = $state<DesktopPrefs | null>(null)
  update = $state<UpdateState>({ status: 'idle' })

  me = $state<User | null>(null)
  connId = $state<string | null>(null)
  users = $state<Record<string, User>>({})
  online = $state<Record<string, boolean>>({})
  channels = $state<Channel[]>([])
  voice = $state<VoiceMember[]>([])

  messages = $state<Record<string, Message[]>>({})
  hasMore = $state<Record<string, boolean>>({})
  loadingHistory = $state<Record<string, boolean>>({})
  unread = $state<Record<string, boolean>>({})
  /** canal -> usuário -> até quando mostrar "digitando" */
  typing = $state<Record<string, Record<string, number>>>({})
  now = $state(Date.now())

  currentChannel = $state<string | null>(null)
  /** chat | stream (assistindo uma tela) | call (os blocos de vídeo/avatar de quem está na call) */
  view = $state<'chat' | 'stream' | 'call'>('chat')
  invite = $state<string | null>(null)
  toasts = $state<Toast[]>([])

  api: Api | null = null
  private conn: Connection | null = null
  /** Mensagens enviadas esperando confirmação, pra limpar o campo só quando chegarem. */
  private pending = new Map<string, () => void>()

  readonly call = new Call({
    send: (msg) => this.send(msg),
    connId: () => this.connId,
    members: () => this.voice,
    api: () => this.api,
    platform: () => this.platform,
    toast: (text, kind) => this.toast(text, kind),
  })

  constructor() {
    setInterval(() => (this.now = Date.now()), 1000)
  }

  // ---------- Sessão ----------

  async boot() {
    this.platform = await window.resenha.platform()
    this.desktop = await window.resenha.desktop.get()
    this.update = await window.resenha.update.state()
    window.resenha.update.onState((state) => (this.update = state))
    window.resenha.onAction((action) => this.runAction(action))
    const saved = await window.resenha.session.get()
    if (saved) this.start(saved)
    else this.phase = 'login'
  }

  async start(session: SavedSession) {
    await window.resenha.session.set(session)
    this.api = new Api(session.server, session.token)
    this.conn = new Connection(() => this.api!.wsUrl(), {
      message: (msg) => this.handle(msg),
      status: (status) => (this.status = status),
      unauthorized: () => {
        this.toast('Sua sessão expirou. Entre de novo.')
        this.reset()
      },
    })
    this.conn.connect()
    this.phase = 'app'
  }

  get server(): string {
    return this.api?.server ?? ''
  }

  async logout() {
    try {
      await this.api?.logout()
    } catch {
      // sai mesmo sem falar com o servidor
    }
    this.reset()
  }

  private reset() {
    this.call.leave()
    this.conn?.close()
    this.conn = null
    window.resenha.session.set(null)
    this.me = null
    this.connId = null
    this.users = {}
    this.channels = []
    this.voice = []
    this.messages = {}
    this.hasMore = {}
    this.unread = {}
    this.currentChannel = null
    this.phase = 'login'
  }

  private lastAction: Partial<Record<ShortcutAction, number>> = {}

  /** Atalho (global ou da janela), item da bandeja ou `resenha --action=...`. */
  runAction(action: ShortcutAction) {
    // Atalho global e o da janela podem disparar juntos: ignora a repetição imediata.
    if (Date.now() - (this.lastAction[action] ?? 0) < 250) return
    this.lastAction[action] = Date.now()
    switch (action) {
      case 'toggle-mute':
        return this.call.toggleMute()
      case 'toggle-deafen':
        return this.call.toggleDeafen()
      case 'leave-call':
        return this.call.leave()
      case 'toggle-share':
        if (this.call.sharing) return this.call.stopShare()
        if (this.call.channelId) ui.share = true
        return
    }
  }

  async setDesktop(patch: Partial<DesktopPrefs>) {
    const { prefs, failed } = await window.resenha.desktop.set($state.snapshot(patch) as Partial<DesktopPrefs>)
    this.desktop = prefs
    return failed
  }

  send(msg: ClientMessage): boolean {
    const ok = this.conn?.send(msg) ?? false
    if (!ok) this.toast('Sem conexão com o servidor agora.')
    return ok
  }

  toast(text: string, kind: Toast['kind'] = 'error') {
    const id = ++toastId
    this.toasts.push({ id, text, kind })
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 4500)
  }

  // ---------- Mensagens do servidor ----------

  private handle(msg: ServerMessage) {
    switch (msg.t) {
      case 'ready': {
        this.me = msg.me
        this.connId = msg.connId
        this.users = Object.fromEntries(msg.users.map((u) => [u.id, u]))
        this.online = Object.fromEntries(msg.online.map((id) => [id, true]))
        this.channels = msg.channels
        this.voice = msg.voice
        const dmPeer = this.currentChannel ? this.dmPeer(this.currentChannel) : null
        const stillThere = dmPeer ? !!this.users[dmPeer] : msg.channels.some((c) => c.id === this.currentChannel)
        if (!this.currentChannel || !stillThere) {
          this.currentChannel = msg.channels.find((c) => c.kind === 'text')?.id ?? null
        }
        // Reconectou: busca o que perdeu no canal aberto e volta pra call.
        this.messages = {}
        this.hasMore = {}
        if (this.currentChannel) this.loadHistory(this.currentChannel)
        this.call.rejoin()
        return
      }

      case 'chat.message': {
        const { message } = msg
        if (msg.nonce) {
          this.pending.get(msg.nonce)?.()
          this.pending.delete(msg.nonce)
        }
        if (this.messages[message.channelId]) {
          this.messages[message.channelId] = mergeMessages(this.messages[message.channelId], [message])
        }
        const typing = this.typing[message.channelId]
        if (typing) delete typing[message.authorId]
        if (message.authorId !== this.me?.id) this.notify(message)
        return
      }

      case 'chat.edited':
        if (this.messages[msg.message.channelId]) {
          this.messages[msg.message.channelId] = mergeMessages(this.messages[msg.message.channelId], [msg.message])
        }
        return

      case 'chat.deleted':
        if (this.messages[msg.channelId]) {
          this.messages[msg.channelId] = this.messages[msg.channelId].filter((m) => m.id !== msg.id)
        }
        return

      case 'chat.history':
        this.messages[msg.channelId] = mergeMessages(this.messages[msg.channelId] ?? [], msg.messages)
        this.hasMore[msg.channelId] = msg.hasMore
        this.loadingHistory[msg.channelId] = false
        return

      case 'typing':
        this.typing[msg.channelId] ??= {}
        this.typing[msg.channelId][msg.userId] = Date.now() + 6000
        return

      case 'channel.upsert': {
        const others = this.channels.filter((c) => c.id !== msg.channel.id)
        this.channels = [...others, msg.channel].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
        return
      }

      case 'channel.removed':
        this.channels = this.channels.filter((c) => c.id !== msg.id)
        if (this.currentChannel === msg.id) this.currentChannel = this.channels.find((c) => c.kind === 'text')?.id ?? null
        if (this.call.channelId === msg.id) this.call.leave()
        return

      case 'user.upsert':
        this.users[msg.user.id] = msg.user
        return

      case 'presence':
        this.online[msg.userId] = msg.online
        return

      case 'voice.state':
        this.voice = msg.members
        this.call.sync(msg.members)
        return

      case 'rtc.signal':
        this.call.signal(msg.from, msg.data)
        return

      case 'invite.created':
        this.invite = msg.code
        return

      case 'error':
        this.toast(msg.message)
        return
    }
  }

  private notify(message: Message) {
    const focused = document.hasFocus()
    if (focused && this.currentChannel === message.channelId && this.view === 'chat') return
    this.unread[message.channelId] = true
    playSound('message')
    if (focused) return
    const author = this.users[message.authorId]?.name ?? 'Alguém'
    const isDm = !!dmMembers(message.channelId)
    const channel = this.channels.find((c) => c.id === message.channelId)?.name ?? ''
    const body = message.content || (message.attachments.length ? `📎 ${message.attachments[0].name}` : '')
    const notification = new Notification(isDm ? `${author} (mensagem privada)` : `${author} em #${channel}`, {
      body: body.slice(0, 200),
      silent: true,
    })
    notification.onclick = () => this.openChannel(message.channelId)
    window.resenha.attention()
  }

  // ---------- Ações ----------

  /** Com quem é a conversa privada (ou null se não for DM). */
  dmPeer(channelId: string): string | null {
    const members = dmMembers(channelId)
    if (!members || !this.me) return null
    return members[0] === this.me.id ? members[1] : members[0]
  }

  openDm(userId: string) {
    if (!this.me || userId === this.me.id) return
    this.openChannel(dmChannelId(this.me.id, userId))
  }

  openChannel(id: string) {
    if (this.dmPeer(id)) {
      this.currentChannel = id
      this.view = 'chat'
      this.unread[id] = false
      if (!this.messages[id]) this.loadHistory(id)
      return
    }
    const channel = this.channels.find((c) => c.id === id)
    if (!channel) return
    if (channel.kind === 'voice') {
      // Já está nessa call: abre a tela da call (câmeras e avatares).
      if (this.call.channelId === id) this.view = 'call'
      else this.call.join(id)
      return
    }
    this.currentChannel = id
    this.view = 'chat'
    this.unread[id] = false
    if (!this.messages[id]) this.loadHistory(id)
  }

  loadHistory(channelId: string, before?: string) {
    if (this.loadingHistory[channelId]) return
    this.loadingHistory[channelId] = true
    if (!this.send({ t: 'chat.history', reqId: `h${++reqId}`, channelId, before })) {
      this.loadingHistory[channelId] = false
    }
  }

  sendMessage(channelId: string, content: string, attachmentIds: string[]): Promise<void> {
    const nonce = `${Date.now()}-${++reqId}`
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'chat.send', channelId, content, attachmentIds, nonce })) return reject(new Error('offline'))
      this.pending.set(nonce, resolve)
      setTimeout(() => {
        if (this.pending.delete(nonce)) reject(new Error('timeout'))
      }, 10_000)
    })
  }

  typingIn(channelId: string): User[] {
    const entries = this.typing[channelId] ?? {}
    return Object.entries(entries)
      .filter(([userId, until]) => until > this.now && userId !== this.me?.id)
      .map(([userId]) => this.users[userId])
      .filter(Boolean)
  }

  membersOf(channelId: string): VoiceMember[] {
    return this.voice.filter((m) => m.channelId === channelId)
  }
}

export const store = new Store()
