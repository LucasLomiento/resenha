import type {
  GuildInfo,
  Me,
  Message,
  Presence,
  ProfileStyle,
  SignalData,
  Status,
  User,
  VisibleStatus,
  VoiceMember,
} from '../../../../shared/protocol'
import type { DesktopPrefs, PlatformInfo, SavedSession, ShortcutAction, UpdateState } from '../../preload/api'
import { untrack } from 'svelte'
import { Api, HttpError } from './api'
import { Call, type CallTransport } from './call.svelte'
import { GuildState, type GuildHost } from './guild.svelte'
import { HomeState, type HomeHost } from './home.svelte'
import { m } from './i18n.svelte'
import { badgeOf } from './profile'
import { attachmentLabel } from './voice-note'
import { settings } from './settings.svelte'
import { playSound } from './sounds'
import { ui } from './ui.svelte'
import type { CloseReason, ConnectionStatus } from './ws'

/** O servidor da plataforma; definido no build (VITE_DEFAULT_SERVER) pra testes locais. */
export const DEFAULT_SERVER = import.meta.env.VITE_DEFAULT_SERVER || 'https://resenha.lucaslomiento.workers.dev'

export interface Toast {
  id: number
  text: string
  kind: 'error' | 'info'
}

/** Onde a pessoa está no app. */
export type Route =
  | { kind: 'home' }
  | { kind: 'dm'; channelId: string }
  | { kind: 'guild'; guildId: string; channelId: string | null }

/** Sem mexer no PC esse tempo, o status vira "ausente" sozinho. */
const IDLE_AFTER = 10 * 60_000
const LAST_CHANNEL_KEY = 'resenha.lastChannel'
/** Depois disso a volta não vale mais (a atualização pelo terminal, com senha, pode demorar uns minutos). */
const REJOIN_TTL = 10 * 60 * 1000

interface Rejoin {
  kind: 'guild' | 'dm'
  /** Servidor (só na call de servidor). */
  guildId?: string
  /** Canal de voz, ou a conversa da ligação privada. */
  channelId: string
  muted: boolean
  deafened: boolean
  at: number
}

/**
 * A call pra voltar depois de atualizar. Fica num arquivo do processo principal
 * (gravado na hora, antes de o app fechar pra instalar); lê uma vez só.
 */
async function takeRejoin(): Promise<Rejoin | null> {
  try {
    let saved = (await window.resenha.update.takeRejoin()) as Rejoin | null
    // A 1.5.1 gravava no armazenamento da página: vale pra quem atualiza a partir dela.
    try {
      const legacy = localStorage.getItem('resenha.rejoin')
      localStorage.removeItem('resenha.rejoin')
      if (!saved && legacy) saved = JSON.parse(legacy) as Rejoin
    } catch {
      // sem armazenamento
    }
    const fresh = saved && typeof saved.channelId === 'string' && (saved.kind === 'guild' || saved.kind === 'dm') && Date.now() - saved.at < REJOIN_TTL
    return fresh ? saved : null
  } catch {
    return null
  }
}

let toastId = 0

/** Aceita o código puro ou um link de convite (resenha://invite/x, https://.../i/x). */
export function inviteCode(input: string): string {
  const text = input.trim()
  const match = /(?:invite\/|\/i\/)([\w-]{4,32})\/?$/.exec(text)
  return match ? match[1] : text
}

function loadLastChannels(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_CHANNEL_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/**
 * O app inteiro: a sessão, a conexão pessoal, uma conexão por servidor, a
 * navegação, a call e os avisos. A interface só lê daqui e chama as ações.
 */
class Client implements GuildHost, HomeHost {
  phase = $state<'boot' | 'login' | 'app'>('boot')
  platform = $state<PlatformInfo | null>(null)
  desktop = $state<DesktopPrefs | null>(null)
  update = $state<UpdateState>({ status: 'idle' })

  home = $state<HomeState | null>(null)
  guilds = $state<Record<string, GuildState>>({})
  route = $state<Route>({ kind: 'home' })
  /** Área principal: conversa, transmissão em tela cheia, a grade da call ou o mapa do servidor. */
  view = $state<'chat' | 'stream' | 'call' | 'map'>('chat')
  /** Status escolhido (vale pra todos os aparelhos). */
  status = $state<Status>('online')
  statusText = $state<string | null>(null)
  /** Ausente automático (sem mexer no PC). */
  idle = $state(false)
  toasts = $state<Toast[]>([])
  now = $state(Date.now())
  /** Chamada privada tocando pra mim. */
  incomingCall = $state<{ channelId: string; from: string; video: boolean } | null>(null)
  /** Convite aberto por link (resenha://invite/...) esperando a pessoa confirmar. */
  pendingInvite = $state<string | null>(null)

  api: Api | null = null
  private session: SavedSession | null = null
  private lastChannels = loadLastChannels()
  private lastInput = Date.now()
  private ringTimer: ReturnType<typeof setInterval> | null = null
  private ringbackTimer: ReturnType<typeof setInterval> | null = null
  /** Servidor que acabei de criar/entrar: abre quando a conexão pessoal confirmar. */
  private openWhenJoined: string | null = null
  /** Call pra voltar assim que o servidor (ou a conexão pessoal) abrir: o app reiniciou pra atualizar no meio dela. */
  private rejoin: Rejoin | null = null
  /** Depois de atualizar: a call em que a pessoa estava. Nome e lugar nulos: ligação privada (o texto sai no idioma da hora). */
  private rejoinSaved = $state<(Rejoin & { label: string | null; place: string | null }) | null>(null)
  private lastAction: Partial<Record<ShortcutAction, number>> = {}

  readonly call: Call = new Call({
    api: () => this.api,
    platform: () => this.platform,
    toast: (text, kind) => this.toast(text, kind),
    name: (userId): string => this.user(userId, this.call.guildId)?.name ?? m.lib.someone,
    badge: (userId) => badgeOf(userId ? this.user(userId, this.call.guildId) : this.me),
    relayWanted: (transport) => transport.kind === 'guild' && !!this.guilds[transport.scopeId]?.channel(transport.channelId)?.relay,
  })

  constructor() {
    // O dono marcou (ou desmarcou) a sala da call: as conexões trocam de caminho na hora.
    $effect.root(() => {
      $effect(() => {
        const { guildId, channelId } = this.call
        void (guildId && channelId && this.guilds[guildId]?.channel(channelId)?.relay)
        untrack(() => this.call.updateRelay())
      })
    })
    setInterval(() => {
      this.now = Date.now()
      this.checkIdle()
    }, 1000)
    for (const event of ['pointermove', 'keydown', 'wheel', 'pointerdown']) {
      window.addEventListener(event, () => this.activity(), { passive: true, capture: true })
    }
    window.addEventListener('focus', () => this.activity())
    window.addEventListener('online', () => this.nudge())
    // Fechando (ou recarregando) o app: fecha as conexões de propósito, pro servidor tirar da
    // call na hora em vez de esperar o app voltar (como faria numa queda de rede).
    window.addEventListener('pagehide', () => {
      this.home?.close()
      for (const guild of Object.values(this.guilds)) guild.close()
    })
  }

  // ---------- Sessão ----------

  async boot() {
    this.platform = await window.resenha.platform()
    const os = this.platform.platform === 'win32' ? 'Windows' : this.platform.platform === 'darwin' ? 'macOS' : 'Linux'
    Api.device = `App no ${os}`
    this.desktop = await window.resenha.desktop.get()
    this.rejoin = await takeRejoin()
    this.update = await window.resenha.update.state()
    window.resenha.update.onState((state) => (this.update = state))
    window.resenha.onAction((action) => this.runAction(action))
    window.resenha.onInvite((code) => (this.pendingInvite = code))
    this.pendingInvite = await window.resenha.pendingInvite()
    const saved = await window.resenha.session.get()
    if (saved) await this.start(saved)
    else this.phase = 'login'
  }

  /** Entrou (ou tinha sessão salva): abre a conexão pessoal e, por ela, os servidores. */
  async start(session: SavedSession) {
    this.api = new Api(session.server, session.token)
    if (!session.userId) {
      // Sessão salva pela 0.5: descobre quem é.
      try {
        session = { ...session, userId: (await this.api.me()).id }
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) return this.reset(m.lib.client.sessionExpired)
        this.toast(m.lib.client.retrying)
        setTimeout(() => this.start(session), 5000)
        return
      }
    }
    this.session = session
    await window.resenha.session.set(session)
    const home = new HomeState(this)
    this.home = home
    home.connect()
    this.phase = 'app'
  }

  get me(): Me | null {
    return this.home?.me ?? null
  }

  get server(): string {
    return this.api?.server ?? ''
  }

  // ---------- Leitura pra interface ----------

  /** Servidor aberto agora (null na tela inicial ou numa conversa privada). */
  get guild(): GuildState | null {
    return this.route.kind === 'guild' ? (this.guilds[this.route.guildId] ?? null) : null
  }

  /** Servidores na ordem do trilho (a da conexão pessoal). */
  get guildList(): GuildState[] {
    return (this.home?.guilds ?? []).map((g) => this.guilds[g.id]).filter((g): g is GuildState => !!g)
  }

  /** Servidor da call (null fora de call ou numa chamada privada). */
  get callGuild(): GuildState | null {
    return this.call.guildId ? (this.guilds[this.call.guildId] ?? null) : null
  }

  /** Minha conexão na call (pra saber qual bloco sou eu). */
  get callConnId(): string | null {
    return this.call.current?.connId() ?? null
  }

  /** Quem está na minha call. */
  get callMembers(): VoiceMember[] {
    return this.call.current?.members() ?? []
  }

  /** Nome e lugar da call, pro dock: "Geral" em "Turma", ou a pessoa da chamada privada. */
  get callPlace(): { name: string; where: string } | null {
    if (!this.call.channelId) return null
    const guild = this.callGuild
    if (guild) return { name: guild.channel(this.call.channelId)?.name ?? m.lib.client.call, where: guild.info.name }
    const dm = this.call.dmId ? this.home?.dm(this.call.dmId) : undefined
    return { name: dm?.user.name ?? m.lib.client.dmCall, where: m.lib.client.dmPlace }
  }

  /** Perfil de alguém, de onde a gente tiver (servidor, amigos, conversas). */
  user(userId: string, guildId?: string | null): User | undefined {
    if (userId === this.me?.id) return this.me ?? undefined
    const found = guildId ? this.guilds[guildId]?.users[userId] : undefined
    if (found) return found
    for (const g of Object.values(this.guilds)) if (g.users[userId]) return g.users[userId]
    return this.home?.friends.find((f) => f.user.id === userId)?.user ?? this.home?.dms.find((d) => d.user.id === userId)?.user
  }

  /** Nome pra mostrar: apelido no servidor, senão o nome de exibição. */
  displayName(userId: string, guildId?: string | null): string {
    const nick = guildId ? this.guilds[guildId]?.members[userId]?.nick : null
    return nick || this.user(userId, guildId)?.name || m.lib.someone
  }

  /** Foto de alguém (URL completa), ou null pro degradê com iniciais. Foto animada vem parada (o primeiro quadro). */
  avatarOf(userId: string, guildId?: string | null): string | null {
    const user = this.user(userId, guildId)
    return this.api?.media(user?.style?.avatarStill ?? user?.avatar ?? null) ?? null
  }

  /** A foto animada de alguém (só se for animada), pro cartão de perfil e o hover. */
  animatedAvatarOf(userId: string, guildId?: string | null): string | null {
    const user = this.user(userId, guildId)
    return user?.style?.avatarStill ? (this.api?.media(user.avatar) ?? null) : null
  }

  /** Personalização do perfil de alguém (moldura, nome…). */
  styleOf(userId: string, guildId?: string | null): ProfileStyle | undefined {
    const user = this.user(userId, guildId)
    return user?.deleted ? undefined : user?.style
  }

  /** Status visível de alguém (de algum servidor em comum, ou dos amigos). Eu: o meu de agora. */
  presenceOf(userId: string): Presence {
    if (userId === this.me?.id) {
      const status = this.effectiveStatus
      return { status: (status === 'invisible' ? 'offline' : status) as VisibleStatus, text: this.statusText }
    }
    for (const g of Object.values(this.guilds)) {
      const p = g.presences[userId]
      if (p) return p
    }
    return this.home?.presences[userId] ?? { status: 'offline', text: null }
  }

  /** Conexão com o servidor: a pior entre a pessoal e a do servidor aberto. */
  get connection(): ConnectionStatus {
    const states = [this.home?.status ?? 'connecting', this.guild?.status]
    if (states.includes('offline')) return 'offline'
    if (states.includes('connecting')) return 'connecting'
    return 'open'
  }

  async logout() {
    try {
      await this.api?.logout()
    } catch {
      // sai mesmo sem falar com o servidor
    }
    this.reset()
  }

  /** Saindo de propósito (excluindo a conta): a conexão fechada não vira aviso de "sessão expirou". */
  private leaving = false

  async deleteAccount(password: string) {
    if (!this.api) return
    this.leaving = true
    try {
      await this.api.deleteAccount(password)
    } catch (err) {
      this.leaving = false
      throw err
    }
    this.reset(m.lib.client.accountDeleted, 'info')
    this.leaving = false
  }

  private reset(message?: string, kind: Toast['kind'] = 'error') {
    if (message) this.toast(message, kind)
    this.call.leave()
    this.home?.close()
    for (const g of Object.values(this.guilds)) g.close()
    this.home = null
    this.guilds = {}
    this.session = null
    this.api = null
    this.route = { kind: 'home' }
    this.view = 'chat'
    this.incomingCall = null
    this.stopRinging()
    window.resenha.session.set(null)
    this.phase = 'login'
  }

  /** A rede voltou: reconecta tudo já. */
  private nudge() {
    this.home?.nudge()
    for (const g of Object.values(this.guilds)) g.nudge()
  }

  // ---------- Avisos ----------

  toast(text: string, kind: Toast['kind'] = 'error') {
    const id = ++toastId
    this.toasts.push({ id, text, kind })
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 4500)
  }

  // ---------- Status (online, ausente, não perturbe, invisível) ----------

  /** O que os outros veem agora (o ausente automático só troca "online"). */
  get effectiveStatus(): Status {
    return this.idle && this.status === 'online' ? 'idle' : this.status
  }

  presence(): { status: Status; text: string | null } {
    return { status: this.effectiveStatus, text: this.statusText }
  }

  setStatus(status: Status, text: string | null = this.statusText) {
    this.status = status
    this.statusText = text
    this.home?.setPresence(status, text)
    this.pushPresence()
  }

  private pushPresence() {
    const { status, text } = this.presence()
    for (const g of Object.values(this.guilds)) g.setPresence(status, text)
  }

  private activity() {
    this.lastInput = Date.now()
    if (this.idle) {
      this.idle = false
      if (this.status === 'online') this.pushAuto()
    }
  }

  private checkIdle() {
    if (this.idle || document.hasFocus() || Date.now() - this.lastInput < IDLE_AFTER) return
    this.idle = true
    if (this.status === 'online') this.pushAuto()
  }

  private pushAuto() {
    const { status, text } = this.presence()
    this.home?.setPresence(status, text, true)
    this.pushPresence()
  }

  // ---------- Conexões (chamadas pelo HomeState e pelos GuildStates) ----------

  http(): Api {
    return this.api!
  }

  token(): string {
    return this.session?.token ?? ''
  }

  userId(): string {
    return this.session?.userId ?? ''
  }

  meId(): string {
    return this.session?.userId ?? ''
  }

  presenceSelf(status: Status, text: string | null) {
    this.status = status
    this.statusText = text
    this.pushPresence()
  }

  /** Reinicia pra instalar a versão nova; estando numa call, o app volta pra ela quando abrir. */
  installUpdate() {
    const { guildId, dmId, channelId, muted, deafened } = this.call
    const target = guildId && channelId ? { kind: 'guild', guildId, channelId } : dmId ? { kind: 'dm', channelId: dmId } : null
    void window.resenha.update.install(target ? { ...target, muted, deafened, at: Date.now() } : null)
  }

  /** Voltando de uma atualização: oferece (numa pílula em cima) voltar pra call em que estava. */
  private resumeAfterUpdate(target: HomeState | GuildState) {
    const saved = this.rejoin
    if (!saved || this.call.channelId) return
    if (saved.kind === 'guild') {
      if (!(target instanceof GuildState) || target.id !== saved.guildId) return
      this.rejoin = null
      const channel = target.channel(saved.channelId)
      if (channel?.kind !== 'voice') return
      this.rejoinSaved = { ...saved, label: channel.name, place: target.info.name }
      return
    }
    if (!(target instanceof HomeState)) return
    this.rejoin = null
    // Ligação privada: só se a outra pessoa continua nela (nunca liga de novo sozinho).
    const other = target.calls[saved.channelId]?.members.find((m) => m.userId !== this.meId())
    if (!other) return
    this.rejoinSaved = { ...saved, label: this.user(other.userId)?.name ?? null, place: null }
  }

  /** A call oferecida numa pílula em cima ("Reconectar?"). */
  get rejoinOffer(): (Rejoin & { label: string; place: string }) | null {
    const saved = this.rejoinSaved
    return saved && { ...saved, label: saved.label ?? m.lib.client.rejoinCall, place: saved.place ?? m.lib.client.rejoinPlace }
  }

  /** "Reconectar": volta pra call, com o mudo/ensurdecido de antes. */
  acceptRejoin() {
    const offer = this.rejoinOffer
    this.rejoinSaved = null
    if (!offer || this.call.channelId) return
    this.call.muted = offer.muted || offer.deafened
    this.call.deafened = offer.deafened
    if (offer.kind === 'guild' && offer.guildId) this.joinVoice(offer.guildId, offer.channelId)
    else if (offer.kind === 'dm' && this.home?.calls[offer.channelId]?.members.length) void this.startDmCall(offer.channelId)
  }

  dismissRejoin() {
    this.rejoinSaved = null
  }

  ready(target: HomeState | GuildState, reconnected: boolean, resumed: boolean) {
    if (!reconnected) this.resumeAfterUpdate(target)
    if (target instanceof HomeState) return this.homeReady(reconnected, resumed)
    const guild = target
    if (this.call.guildId === guild.id) {
      if (reconnected) this.call.reconnected(resumed)
      else this.call.sync()
    }
    if (this.route.kind === 'guild' && this.route.guildId === guild.id) this.ensureChannel(guild)
  }

  dmCallId(): string | null {
    return this.call.dmId
  }

  /** A conexão pessoal (re)abriu: abre uma conexão pra cada servidor da lista. */
  private homeReady(reconnected: boolean, resumed: boolean) {
    const home = this.home!
    const wanted = new Set(home.guilds.map((g) => g.id))
    for (const id of Object.keys(this.guilds)) {
      if (!wanted.has(id)) this.dropGuild(id)
    }
    for (const info of home.guilds) this.addGuild(info)
    if (this.route.kind === 'guild' && !wanted.has(this.route.guildId)) this.route = { kind: 'home' }
    if (this.route.kind === 'dm') this.openDmChannel(this.route.channelId)
    const dm = this.call.dmId
    if (!dm || !reconnected) return
    // A chamada acabou (ou a outra pessoa saiu) enquanto a conexão estava caída: sai sem ligar de novo.
    if (!resumed && !home.calls[dm]?.members.some((m) => m.userId !== this.meId())) {
      this.call.leave(false)
      this.toast(m.lib.client.callDropped, 'info')
      return
    }
    this.call.reconnected(resumed)
  }

  private addGuild(info: GuildInfo) {
    const existing = this.guilds[info.id]
    if (existing) {
      existing.info = info
      return existing
    }
    const guild = new GuildState(this, info)
    this.guilds[info.id] = guild
    guild.connect()
    return guild
  }

  /** Nome dos servidores que saíram da lista (pro aviso que chega depois dizer qual foi). */
  private droppedNames: Record<string, string> = {}

  private dropGuild(id: string) {
    const guild = this.guilds[id]
    if (!guild) return
    this.droppedNames[id] = guild.info.name
    guild.close()
    delete this.guilds[id]
    if (this.call.guildId === id) this.call.leave(false)
    if (this.route.kind === 'guild' && this.route.guildId === id) {
      this.route = { kind: 'home' }
      if (this.view === 'map') this.view = 'chat'
    }
  }

  guildJoined(info: GuildInfo) {
    this.addGuild(info)
    if (this.openWhenJoined === info.id) {
      this.openWhenJoined = null
      this.openGuild(info.id)
    }
  }

  guildUpdated(info: GuildInfo) {
    const guild = this.guilds[info.id]
    if (guild) guild.info = info
  }

  guildLeft(guildId: string, reason: 'left' | 'kicked' | 'banned' | 'deleted') {
    const name = this.guilds[guildId]?.info.name ?? this.droppedNames[guildId]
    this.dropGuild(guildId)
    const t = m.lib.client
    if (reason === 'kicked') this.toast(name ? t.kickedFrom(name) : t.kicked)
    if (reason === 'banned') this.toast(name ? t.bannedFrom(name) : t.banned)
    if (reason === 'deleted') this.toast(name ? t.serverDeleted(name) : t.someServerDeleted, 'info')
  }

  closed(target: GuildState | CloseReason, reason?: CloseReason) {
    const expired = () => (this.leaving ? undefined : m.lib.client.sessionExpired)
    // Conexão pessoal: sessão inválida.
    if (!(target instanceof GuildState)) {
      if (target === 'unauthorized' && this.phase === 'app') this.reset(expired())
      return
    }
    if (reason === 'unauthorized') return this.phase === 'app' ? this.reset(expired()) : undefined
    // Saiu do servidor (ou ele foi excluído): a conexão pessoal confirma e tira da lista.
    this.dropGuild(target.id)
  }

  incoming(target: GuildState | string, message: Message) {
    if (target instanceof GuildState) return this.guildMessage(target, message)
    return this.dmMessage(target, message)
  }

  viewing(a: string, b?: string): boolean {
    if (!document.hasFocus() || this.view !== 'chat') return false
    if (b === undefined) return this.route.kind === 'dm' && this.route.channelId === a
    return this.route.kind === 'guild' && this.route.guildId === a && this.route.channelId === b
  }

  voice(guild: GuildState) {
    if (this.call.guildId === guild.id) this.call.sync()
  }

  voiceForced(guild: GuildState, channelId: string | null) {
    if (this.call.guildId !== guild.id) return
    this.call.leave(false)
    if (channelId) {
      const name = guild.channel(channelId)?.name
      this.toast(name ? m.lib.client.movedTo(name) : m.lib.client.movedElsewhere, 'info')
      this.call.join(this.guildTransport(guild, channelId))
    } else {
      this.toast(m.lib.client.disconnected, 'info')
    }
  }

  signal(guild: GuildState, from: string, data: SignalData) {
    if (this.call.guildId === guild.id) this.call.signal(from, data)
  }

  callState(channelId: string) {
    if (this.call.dmId === channelId) this.call.sync()
    const state = this.home?.calls[channelId]
    const me = this.meId()
    // Parou de tocar pra mim (atendi em outro aparelho, ou desistiram).
    if (this.incomingCall?.channelId === channelId && !state?.ringing.includes(me)) this.stopRinging()
    // Do meu lado, o "chamando…" acaba quando alguém entra ou ninguém atende.
    if (this.call.dmId === channelId && (!state?.ringing.length || (state?.members.length ?? 0) > 1)) this.stopRingback()
  }

  callEnded(channelId: string) {
    if (this.call.dmId === channelId) this.call.leave(false)
    if (this.incomingCall?.channelId === channelId) this.stopRinging()
    this.stopRingback()
  }

  ringing(channelId: string, from: string, video: boolean) {
    this.incomingCall = { channelId, from, video }
    // Não perturbe: a ligação aparece, mas sem tocar nem notificar.
    if (this.status === 'dnd') return
    playSound('ring')
    this.ringTimer = setInterval(() => playSound('ring'), 2600)
    if (!document.hasFocus()) {
      const name = this.home?.dm(channelId)?.user.name ?? m.lib.someone
      new Notification(m.lib.notify.calling(name), { body: m.lib.notify.callingBody, silent: true }).onclick = () => {
        window.resenha.showWindow()
        this.navigate({ kind: 'dm', channelId })
      }
      window.resenha.attention()
    }
  }

  callSignal(channelId: string, from: string, data: SignalData) {
    if (this.call.dmId === channelId) this.call.signal(from, data)
  }

  private stopRinging() {
    this.incomingCall = null
    if (this.ringTimer) clearInterval(this.ringTimer)
    this.ringTimer = null
  }

  private stopRingback() {
    if (this.ringbackTimer) clearInterval(this.ringbackTimer)
    this.ringbackTimer = null
  }

  // ---------- Notificações ----------

  private guildMessage(guild: GuildState, message: Message) {
    if (this.status === 'dnd') return
    const level = guild.levelFor(message.channelId)
    if (level === 'none' || (level === 'mentions' && !guild.mentionsMe(message))) return
    const focused = document.hasFocus()
    if (focused && this.viewing(guild.id, message.channelId)) return
    playSound(guild.mentionsMe(message) ? 'mention' : 'message')
    if (focused) return
    const channel = guild.channel(message.channelId)?.name ?? ''
    this.notify(m.lib.notify.channelMessage(guild.displayName(message.authorId), channel, guild.info.name), message, () =>
      this.openChannel(guild.id, message.channelId),
    )
  }

  private dmMessage(channelId: string, message: Message) {
    if (this.status === 'dnd') return
    const focused = document.hasFocus()
    if (focused && this.viewing(channelId)) return
    playSound('message')
    if (focused) return
    const name = this.home?.dm(channelId)?.user.name ?? m.lib.someone
    this.notify(name, message, () => this.navigate({ kind: 'dm', channelId }))
  }

  private notify(title: string, message: Message, open: () => void) {
    const body = message.content || (message.attachments.length ? attachmentLabel(message.attachments[0]) : '')
    // Com "esconder o texto", a notificação só diz que chegou mensagem (bom com a tela compartilhada).
    const notification = new Notification(title, { body: settings.notifyContent ? body.slice(0, 200) : m.lib.notify.hiddenMessage, silent: true })
    notification.onclick = () => {
      window.resenha.showWindow()
      open()
    }
    window.resenha.attention()
  }

  /** Total pro ícone da bandeja/barra: menções e conversas privadas não lidas. */
  get badge(): number {
    const dms = this.home?.dms.reduce((sum, d) => sum + d.unread, 0) ?? 0
    const mentions = Object.values(this.guilds).reduce((sum, g) => sum + (g.muted ? 0 : g.mentionTotal), 0)
    return dms + mentions + (this.home?.pendingRequests ?? 0)
  }

  // ---------- Navegação ----------

  navigate(route: Route) {
    this.route = route
    this.view = 'chat'
    if (route.kind === 'guild') {
      const guild = this.guilds[route.guildId]
      if (guild) this.ensureChannel(guild)
    } else if (route.kind === 'dm') {
      this.openDmChannel(route.channelId)
    }
  }

  openHome() {
    this.navigate({ kind: 'home' })
  }

  openGuild(guildId: string) {
    const guild = this.guilds[guildId]
    if (!guild) return
    const last = this.lastChannels[guildId]
    const channel = guild.channel(last)?.kind === 'text' && guild.can(last, 1) ? last : guild.firstTextChannel?.id ?? null
    this.navigate({ kind: 'guild', guildId, channelId: channel })
  }

  /** Abre o mapa compartilhado do servidor (o aberto agora, se não disser qual) no painel principal. */
  openMap(guildId = this.guild?.id) {
    const guild = guildId ? this.guilds[guildId] : null
    if (!guild) return
    const here = this.route.kind === 'guild' && this.route.guildId === guild.id
    if (!here) this.openGuild(guild.id)
    this.view = 'map'
  }

  /** Mapa aberto agora (de qual servidor), ou null. */
  get mapGuild(): GuildState | null {
    return this.view === 'map' ? this.guild : null
  }

  /** Canal de texto abre a conversa; de voz entra na call (ou mostra a call, se já estiver nela). */
  openChannel(guildId: string, channelId: string) {
    const guild = this.guilds[guildId]
    const channel = guild?.channel(channelId)
    if (!guild || !channel) return
    if (channel.kind === 'voice') {
      if (this.call.guildId === guildId && this.call.channelId === channelId) {
        this.route = { kind: 'guild', guildId, channelId: this.route.kind === 'guild' && this.route.guildId === guildId ? this.route.channelId : guild.firstTextChannel?.id ?? null }
        this.view = 'call'
      } else {
        this.joinVoice(guildId, channelId)
      }
      return
    }
    if (channel.kind !== 'text') return
    this.lastChannels[guildId] = channelId
    try {
      localStorage.setItem(LAST_CHANNEL_KEY, JSON.stringify(this.lastChannels))
    } catch {
      // sem armazenamento
    }
    this.navigate({ kind: 'guild', guildId, channelId })
  }

  /** Abre o canal atual de um servidor (ou o primeiro de texto) e busca o histórico. */
  private ensureChannel(guild: GuildState) {
    if (this.route.kind !== 'guild' || this.route.guildId !== guild.id || !guild.loaded) return
    let channelId = this.route.channelId
    const channel = guild.channel(channelId)
    if (!channel || channel.kind !== 'text' || guild.permissions[channel.id] === undefined) {
      channelId = guild.firstTextChannel?.id ?? null
      this.route = { kind: 'guild', guildId: guild.id, channelId }
    }
    if (!channelId) return
    if (!guild.messages[channelId]) guild.loadHistory(channelId)
    if (document.hasFocus()) guild.ack(channelId)
  }

  private openDmChannel(channelId: string) {
    const home = this.home
    if (!home?.loaded) return
    if (!home.messages[channelId]) home.loadHistory(channelId)
    if (document.hasFocus()) home.ack(channelId)
  }

  /** Abre (ou cria) a conversa privada com alguém. */
  async openDm(userId: string) {
    if (!this.home) return
    try {
      const channelId = await this.home.openDm(userId)
      this.navigate({ kind: 'dm', channelId })
    } catch (err) {
      this.toast((err as Error).message)
    }
  }

  /** Volta o foco pra janela: marca como lido o que está aberto. */
  focused() {
    const route = this.route
    if (this.view !== 'chat') return
    if (route.kind === 'guild' && route.channelId) this.guilds[route.guildId]?.ack(route.channelId)
    if (route.kind === 'dm') this.home?.ack(route.channelId)
  }

  // ---------- Call ----------

  guildTransport(guild: GuildState, channelId: string): CallTransport {
    return {
      kind: 'guild',
      scopeId: guild.id,
      channelId,
      connId: () => guild.connId,
      members: () => guild.voiceIn(channelId),
      join: (muted, deafened, back) => guild.send({ t: 'voice.join', channelId, muted, deafened, ...back }),
      leave: () => void guild.send({ t: 'voice.leave' }),
      update: (state) => void guild.send({ t: 'voice.update', ...state }),
      signal: (to, data) => guild.send({ t: 'rtc.signal', to, data }),
    }
  }

  private dmTransport(home: HomeState, channelId: string, video: boolean): CallTransport {
    return {
      kind: 'dm',
      scopeId: channelId,
      channelId,
      connId: () => home.connId,
      members: () => home.calls[channelId]?.members ?? [],
      join: (muted, deafened, back) => {
        // Voltando (a conexão caiu e a chamada continuou): entra como estava, nunca liga de novo.
        if (back) return home.send({ t: 'call.answer', channelId, accept: true, state: { muted, deafened, ...back } })
        const live = home.calls[channelId]?.members.length
        const ok = live ? home.send({ t: 'call.answer', channelId, accept: true }) : home.send({ t: 'call.ring', channelId, video })
        if (ok && (muted || deafened)) home.send({ t: 'call.update', channelId, muted, deafened, sharing: false, camera: false })
        return ok
      },
      leave: () => void home.send({ t: 'call.hangup', channelId }),
      update: (state) => void home.send({ t: 'call.update', channelId, ...state }),
      signal: (to, data) => home.send({ t: 'call.signal', channelId, to, data }),
    }
  }

  joinVoice(guildId: string, channelId: string) {
    const guild = this.guilds[guildId]
    if (!guild) return
    this.rejoinSaved = null
    this.stopRinging()
    this.call.join(this.guildTransport(guild, channelId))
  }

  /** Liga pra alguém (ou entra na chamada que já está rolando na conversa). */
  async startDmCall(channelId: string, video = false) {
    const home = this.home
    if (!home) return
    this.rejoinSaved = null
    const ringing = !home.calls[channelId]?.members.length
    await this.call.join(this.dmTransport(home, channelId, video))
    if (ringing && this.call.dmId === channelId) {
      playSound('ringback')
      this.ringbackTimer = setInterval(() => playSound('ringback'), 3000)
    }
    if (video && this.call.dmId === channelId && !this.call.camera) await this.call.toggleCamera()
  }

  async acceptCall() {
    const incoming = this.incomingCall
    if (!incoming || !this.home) return
    this.stopRinging()
    this.navigate({ kind: 'dm', channelId: incoming.channelId })
    await this.call.join(this.dmTransport(this.home, incoming.channelId, incoming.video))
  }

  declineCall() {
    const incoming = this.incomingCall
    if (!incoming) return
    this.stopRinging()
    this.home?.send({ t: 'call.answer', channelId: incoming.channelId, accept: false })
  }

  leaveCall() {
    this.stopRingback()
    this.call.leave()
    if (this.view !== 'chat') this.view = 'chat'
  }

  // ---------- Servidores ----------

  /** Cria um servidor e abre ele assim que a conexão pessoal confirmar. */
  async createGuild(name: string): Promise<GuildInfo | null> {
    if (!this.api) return null
    const info = await this.api.createGuild(name)
    this.openWhenJoined = info.id
    if (this.guilds[info.id]) this.guildJoined(info)
    return info
  }

  async joinInvite(code: string) {
    if (!this.api) return
    const info = await this.api.joinInvite(inviteCode(code))
    this.pendingInvite = null
    if (this.guilds[info.id]) this.openGuild(info.id)
    else this.openWhenJoined = info.id
  }

  async leaveGuild(guildId: string) {
    await this.api?.leaveGuild(guildId)
    this.dropGuild(guildId)
  }

  // ---------- Atalhos e app ----------

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
        return this.leaveCall()
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
}

export const client = new Client()
