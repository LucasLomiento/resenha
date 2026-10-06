// Tipos trocados entre o app e o servidor (HTTP e WebSocket).
// Importado pelos dois lados por caminho relativo, então só pode ter tipos e
// constantes puras, sem dependência de Node, DOM ou Workers.
//
// Compatibilidade: o app 0.5 ainda fala com o servidor do grupo ("main") por
// /ws. Tudo que existia na 0.5 continua com o mesmo nome e formato; o que é
// novo é campo ou mensagem a mais, que a 0.5 simplesmente ignora.

export const MAX_MESSAGE_LENGTH = 4000
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const HISTORY_PAGE = 50
export const MAX_REACTIONS_PER_MESSAGE = 20
export const MAX_PINS_PER_CHANNEL = 50
export const MAX_GUILDS_PER_USER = 100

// ---------- Permissões (bits) ----------

export const P = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  ATTACH_FILES: 1 << 2,
  ADD_REACTIONS: 1 << 3,
  MENTION_EVERYONE: 1 << 4,
  /** Apagar e fixar mensagens dos outros. */
  MANAGE_MESSAGES: 1 << 5,
  READ_HISTORY: 1 << 6,
  CONNECT: 1 << 7,
  SPEAK: 1 << 8,
  /** Câmera e compartilhar tela. */
  VIDEO: 1 << 9,
  MUTE_MEMBERS: 1 << 10,
  DEAFEN_MEMBERS: 1 << 11,
  MOVE_MEMBERS: 1 << 12,
  CREATE_INVITE: 1 << 13,
  CHANGE_NICKNAME: 1 << 14,
  MANAGE_NICKNAMES: 1 << 15,
  KICK_MEMBERS: 1 << 16,
  BAN_MEMBERS: 1 << 17,
  MANAGE_CHANNELS: 1 << 18,
  MANAGE_ROLES: 1 << 19,
  MANAGE_GUILD: 1 << 20,
  VIEW_AUDIT_LOG: 1 << 21,
  ADMINISTRATOR: 1 << 22,
  /** Castigo: tirar alguém de falar/escrever por um tempo. */
  MODERATE_MEMBERS: 1 << 23,
} as const

export type PermissionName = keyof typeof P
export const ALL_PERMISSIONS = Object.values(P).reduce((a, b) => a | b, 0)

/** O que todo mundo pode por padrão num servidor novo (cargo @everyone). */
export const DEFAULT_PERMISSIONS =
  P.VIEW_CHANNEL |
  P.SEND_MESSAGES |
  P.ATTACH_FILES |
  P.ADD_REACTIONS |
  P.READ_HISTORY |
  P.CONNECT |
  P.SPEAK |
  P.VIDEO |
  P.CREATE_INVITE |
  P.CHANGE_NICKNAME

export function has(permissions: number, bit: number): boolean {
  return (permissions & P.ADMINISTRATOR) !== 0 || (permissions & bit) === bit
}

// ---------- Identidade ----------

/** Perfil público de uma pessoa. */
export interface User {
  id: string
  /** Nome de usuário, único (letras minúsculas, números, _ e .). */
  username: string
  /** Nome de exibição. */
  name: string
  /** Id da imagem (servida em /media/<id>), ou null. */
  avatar: string | null
  bio: string
  /** Cor do perfil, 0xRRGGBB. */
  accent: number | null
  /** No contexto de um servidor: pode administrar (compat 0.5 e atalho pro app). */
  admin: boolean
  /** Conta excluída: aparece como "Usuário excluído". */
  deleted?: boolean
}

/** O dono da conta vê mais coisas sobre si. */
export interface Me extends User {
  /** Dono da plataforma (painel de administração). */
  staff: boolean
  dmPolicy: DmPolicy
  createdAt: number
}

/** Quem pode me mandar mensagem privada. */
export type DmPolicy = 'everyone' | 'servers' | 'friends'

export type Status = 'online' | 'idle' | 'dnd' | 'invisible'
/** O que os outros veem (invisível aparece como offline). */
export type VisibleStatus = 'online' | 'idle' | 'dnd' | 'offline'

export interface Presence {
  status: VisibleStatus
  /** Status personalizado ("jogando…", "estudando"). */
  text: string | null
}

// ---------- Servidores ----------

export interface GuildInfo {
  id: string
  name: string
  icon: string | null
  ownerId: string
}

export interface Role {
  id: string
  name: string
  color: number | null
  /** Maior = mais alto. @everyone é sempre 0 e tem o id do servidor. */
  position: number
  permissions: number
  /** Aparece separado na lista de membros. */
  hoist: boolean
  mentionable: boolean
}

export interface Member {
  userId: string
  nick: string | null
  roles: string[]
  joinedAt: number
  /** Castigo até (ms) — não fala nem escreve até lá. */
  timeoutUntil: number | null
  /** Mutado/ensurdecido por moderador (vale em todos os canais de voz do servidor). */
  serverMuted: boolean
  serverDeafened: boolean
}

export type ChannelKind = 'text' | 'voice' | 'category'

export interface Overwrite {
  /** Id do cargo ou da pessoa. */
  id: string
  type: 'role' | 'member'
  allow: number
  deny: number
}

export interface Channel {
  id: string
  name: string
  kind: ChannelKind
  position: number
  /** Categoria em que está (null = solto no topo). */
  parentId: string | null
  topic: string
  /** Vazio = herda da categoria. */
  overwrites: Overwrite[]
  /** Voz: máximo de pessoas (0 = sem limite). */
  userLimit: number
  /** Texto: segundos entre mensagens da mesma pessoa (0 = livre). */
  slowmode: number
}

export interface Invite {
  code: string
  guildId: string
  inviterId: string
  createdAt: number
  expiresAt: number | null
  maxUses: number | null
  uses: number
}

export interface InvitePreview {
  code: string
  guild: GuildInfo
  memberCount: number
  inviter: User | null
}

export interface Ban {
  userId: string
  reason: string
  actorId: string
  createdAt: number
  user: User | null
}

export type AuditAction =
  | 'guild.update'
  | 'channel.create'
  | 'channel.update'
  | 'channel.delete'
  | 'role.create'
  | 'role.update'
  | 'role.delete'
  | 'member.roles'
  | 'member.nick'
  | 'member.kick'
  | 'member.ban'
  | 'member.unban'
  | 'member.timeout'
  | 'member.voice'
  | 'message.delete'
  | 'message.pin'
  | 'invite.create'
  | 'invite.delete'

export interface AuditEntry {
  id: string
  actorId: string
  action: AuditAction
  targetId: string | null
  /** Detalhes legíveis (nome antigo/novo, motivo…). */
  detail: string
  createdAt: number
}

// ---------- Mensagens ----------

export interface Attachment {
  id: string
  name: string
  size: number
  type: string
  /** Caminho assinado relativo ao servidor. */
  url: string
  /** Imagem/vídeo: tamanho em pixels (o app reserva o espaço e a rolagem não pula). */
  width?: number | null
  height?: number | null
}

/** Prévia de link, montada pelo servidor (o app nunca acessa o site). */
export interface Embed {
  url: string
  title: string
  description: string
  siteName: string
  /** Imagem já passando pelo servidor (proxy assinado), ou null. */
  image: string | null
}

export interface Reaction {
  emoji: string
  userIds: string[]
}

export interface MessageRef {
  id: string
  authorId: string
  /** Começo do texto, pra mostrar na resposta. */
  content: string
}

export interface Message {
  id: string
  channelId: string
  authorId: string
  content: string
  createdAt: number
  editedAt: number | null
  attachments: Attachment[]
  replyTo: MessageRef | null
  reactions: Reaction[]
  /** Ids de pessoas mencionadas (o servidor extrai de <@id>). */
  mentions: string[]
  mentionRoles: string[]
  mentionEveryone: boolean
  pinned: boolean
  embeds: Embed[]
}

/** Até onde cada pessoa leu em cada canal, e quantas menções ainda não viu. */
export interface ReadState {
  channelId: string
  lastReadId: string | null
  mentions: number
}

export type NotifyLevel = 'all' | 'mentions' | 'none'

export interface NotifySettings {
  /** Do servidor inteiro. */
  level: NotifyLevel
  /** Silenciado até (ms), ou null. */
  mutedUntil: number | null
  /** Por canal: sobrescreve o do servidor. */
  channels: Record<string, { level: NotifyLevel | null; mutedUntil: number | null }>
}

// ---------- Voz ----------

/** Uma conexão (aba/instância do app) dentro de um canal de voz. */
export interface VoiceMember {
  connId: string
  userId: string
  channelId: string
  muted: boolean
  deafened: boolean
  sharing: boolean
  camera: boolean
  /** Mutado/ensurdecido por moderador: quem recebe não toca o áudio. */
  serverMuted?: boolean
  serverDeafened?: boolean
}

// ---------- Sinalização WebRTC (repassada pelo servidor sem olhar) ----------

// Cópias mínimas dos tipos do DOM, porque o servidor não tem os tipos de WebRTC.
export interface SessionDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback'
  sdp?: string
}

export interface IceCandidate {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export type SignalData = (
  | {
      kind: 'description'
      description: SessionDescription
      /** streamId -> o que é, pra quem recebe saber qual faixa é mic, tela ou câmera. */
      streams: Record<string, 'mic' | 'screen' | 'camera'>
    }
  | { kind: 'candidate'; candidate: IceCandidate | null }
  | { kind: 'watch' }
  | { kind: 'unwatch' }
) & {
  /**
   * Id da RTCPeerConnection de quem manda e o da de quem recebe, até onde quem
   * manda sabe (null = ainda não conhece). Se um dos lados recriou a conexão
   * (reconectou sem conseguir retomar), o outro percebe e recria a dele também.
   */
  pc?: string
  ack?: string | null
}

// ---------- HTTP ----------

export interface AuthResponse {
  token: string
  user: Me
}

export interface StatusResponse {
  /** Compat 0.5: true = cadastro só com convite. */
  needsInvite: boolean
  signup: 'invite' | 'open'
  /** Chave pública do Turnstile, quando o cadastro aberto usa anti-robô. */
  turnstileSiteKey: string | null
}

export interface SessionInfo {
  id: string
  device: string
  country: string | null
  createdAt: number
  lastSeenAt: number
  current: boolean
}

export interface ApiError {
  error: string
}

// ---------- WebSocket do servidor (Guild): app -> servidor ----------

export type ClientMessage =
  /**
   * Primeira mensagem da conexão: o token vai aqui, nunca na URL (URL vai parar em log).
   * O status já vai junto, pra quem está invisível não aparecer online nem por um instante.
   */
  | {
      t: 'auth'
      token: string
      status?: Status
      text?: string | null
      /** Chave desta instância do app, a mesma em toda reconexão: o connId sai dela e a call continua. */
      key?: string
    }
  /** `auto`: ausente automático (sem mexer no PC) — não muda o status escolhido. */
  | { t: 'presence'; status: Status; text: string | null; auto?: boolean }
  | {
      t: 'chat.send'
      channelId: string
      content: string
      attachmentIds: string[]
      nonce: string
      replyTo?: string | null
    }
  | { t: 'chat.edit'; id: string; content: string }
  | { t: 'chat.delete'; id: string }
  | { t: 'chat.history'; reqId: string; channelId: string; before?: string; around?: string }
  | { t: 'chat.react'; id: string; emoji: string; on: boolean }
  | { t: 'chat.pin'; id: string; on: boolean }
  | { t: 'chat.pins'; reqId: string; channelId: string }
  | { t: 'chat.search'; reqId: string; query: string; channelId?: string; authorId?: string; before?: string }
  | { t: 'chat.ack'; channelId: string; messageId: string }
  | { t: 'typing'; channelId: string }
  | {
      t: 'channel.create'
      name: string
      kind: ChannelKind
      parentId?: string | null
      overwrites?: Overwrite[]
    }
  | { t: 'channel.rename'; id: string; name: string }
  | {
      t: 'channel.update'
      id: string
      name?: string
      topic?: string
      parentId?: string | null
      overwrites?: Overwrite[]
      /** Copia as permissões da categoria (volta a ficar "sincronizado"). */
      syncWithCategory?: boolean
      userLimit?: number
      slowmode?: number
    }
  /** Nova ordem: lista completa de [id, posição, categoria]. */
  | { t: 'channel.reorder'; order: { id: string; position: number; parentId: string | null }[] }
  | { t: 'channel.delete'; id: string }
  | { t: 'guild.update'; name?: string; icon?: string | null }
  /** Só o dono: passa o servidor pra outra pessoa. */
  | { t: 'guild.transfer'; userId: string }
  | { t: 'role.create'; name: string }
  | {
      t: 'role.update'
      id: string
      name?: string
      color?: number | null
      permissions?: number
      hoist?: boolean
      mentionable?: boolean
    }
  | { t: 'role.reorder'; order: string[] }
  | { t: 'role.delete'; id: string }
  | { t: 'member.roles'; userId: string; roles: string[] }
  | { t: 'member.nick'; userId: string; nick: string | null }
  | { t: 'member.kick'; userId: string; reason: string }
  | { t: 'member.ban'; userId: string; reason: string; deleteMessages: boolean }
  | { t: 'member.unban'; userId: string }
  | { t: 'member.timeout'; userId: string; minutes: number; reason: string }
  | {
      t: 'member.voice'
      userId: string
      serverMuted?: boolean
      serverDeafened?: boolean
      disconnect?: boolean
      moveTo?: string
    }
  | { t: 'bans.list'; reqId: string }
  | { t: 'audit.list'; reqId: string; before?: string }
  /** `nonce`: volta no `invite.created` (ou no `error`) pra saber de qual pedido é. */
  | { t: 'invite.create'; maxAge?: number | null; maxUses?: number | null; nonce?: string }
  | { t: 'invites.list'; reqId: string }
  | { t: 'invite.delete'; code: string }
  | { t: 'notify.update'; settings: NotifySettings }
  /** `sharing`/`camera`: voltando depois de o servidor perder a call (tudo numa mensagem só, sem piscar). */
  | { t: 'voice.join'; channelId: string; muted: boolean; deafened: boolean; sharing?: boolean; camera?: boolean }
  | { t: 'voice.leave' }
  | { t: 'voice.update'; muted: boolean; deafened: boolean; sharing: boolean; camera?: boolean }
  | { t: 'rtc.signal'; to: string; data: SignalData }

// ---------- WebSocket do servidor (Guild): servidor -> app ----------

export type ServerMessage =
  | {
      t: 'ready'
      /** Compat 0.5: `me.admin` = pode administrar este servidor. */
      me: User
      connId: string
      /** Perfis de todos os membros (compat 0.5: `users`). */
      users: User[]
      channels: Channel[]
      voice: VoiceMember[]
      /** Ids de quem está online (compat 0.5). */
      online: string[]
      guild?: GuildInfo
      roles?: Role[]
      members?: Member[]
      presences?: Record<string, Presence>
      /** Minhas permissões efetivas por canal (o app só mostra o que pode fazer). */
      permissions?: Record<string, number>
      readStates?: ReadState[]
      /** Último id de mensagem de cada canal de texto (pra saber o que tem de novo). */
      lastMessageIds?: Record<string, string>
      notify?: NotifySettings
      /** A conexão anterior (mesma chave) ainda estava na call: voltou nela sem ninguém perceber. */
      resumed?: boolean
    }
  | { t: 'chat.message'; message: Message; nonce?: string }
  | { t: 'chat.edited'; message: Message }
  | { t: 'chat.deleted'; id: string; channelId: string }
  | {
      t: 'chat.history'
      reqId: string
      channelId: string
      messages: Message[]
      hasMore: boolean
      hasNewer?: boolean
    }
  | { t: 'chat.reactions'; id: string; channelId: string; reactions: Reaction[] }
  | { t: 'chat.pins'; reqId: string; channelId: string; messages: Message[] }
  | { t: 'chat.search'; reqId: string; messages: Message[]; total: number }
  | { t: 'read.state'; state: ReadState }
  | { t: 'typing'; channelId: string; userId: string }
  | { t: 'channel.upsert'; channel: Channel }
  | { t: 'channel.removed'; id: string }
  | { t: 'channels.reordered'; channels: Channel[] }
  | { t: 'guild.updated'; guild: GuildInfo }
  | { t: 'roles'; roles: Role[] }
  | { t: 'member.upsert'; member: Member; user: User }
  | { t: 'member.removed'; userId: string }
  | { t: 'permissions'; permissions: Record<string, number> }
  | { t: 'user.upsert'; user: User }
  | { t: 'presence'; userId: string; online: boolean; presence?: Presence }
  | { t: 'voice.state'; members: VoiceMember[] }
  /** Um moderador me tirou da call ou me moveu de canal. */
  | { t: 'voice.forced'; channelId: string | null }
  | { t: 'rtc.signal'; from: string; data: SignalData }
  | { t: 'invite.created'; code: string; invite?: Invite; nonce?: string }
  | { t: 'invites.list'; reqId: string; invites: Invite[] }
  | { t: 'bans.list'; reqId: string; bans: Ban[] }
  | { t: 'audit.list'; reqId: string; entries: AuditEntry[]; hasMore: boolean }
  | { t: 'notify.settings'; settings: NotifySettings }
  /** `nonce`: o erro é de uma mensagem enviada (o app devolve o texto pro campo). */
  | { t: 'error'; message: string; nonce?: string }

// ---------- WebSocket pessoal (Home): DMs, amigos, status ----------

export interface Friend {
  user: User
  /** friends = amigos; incoming/outgoing = pedido recebido/enviado. */
  state: 'friends' | 'incoming' | 'outgoing'
  since: number
}

export interface DmChannel {
  id: string
  /** A outra pessoa. */
  user: User
  lastMessageId: string | null
  lastMessageAt: number | null
  unread: number
  lastReadId: string | null
}

export type HomeClientMessage =
  | {
      t: 'auth'
      token: string
      status?: Status
      text?: string | null
      /** Chave desta instância do app (igual à do servidor): o connId sai dela. */
      key?: string
      /** Conversa da chamada privada em que o app estava: o `ready` traz como ela está agora. */
      call?: string
    }
  | { t: 'presence'; status: Status; text: string | null; auto?: boolean }
  | { t: 'dm.open'; userId: string; reqId: string }
  | {
      t: 'dm.send'
      channelId: string
      content: string
      attachmentIds: string[]
      nonce: string
      replyTo?: string | null
    }
  | { t: 'dm.edit'; channelId: string; id: string; content: string }
  | { t: 'dm.delete'; channelId: string; id: string }
  | { t: 'dm.history'; reqId: string; channelId: string; before?: string }
  | { t: 'dm.react'; channelId: string; id: string; emoji: string; on: boolean }
  | { t: 'dm.ack'; channelId: string; messageId: string }
  | { t: 'dm.typing'; channelId: string }
  | { t: 'dm.close'; channelId: string }
  | { t: 'call.ring'; channelId: string; video: boolean }
  /** `state`: voltando depois de a conexão cair (mutado, tela e câmera como estavam). */
  | {
      t: 'call.answer'
      channelId: string
      accept: boolean
      state?: { muted: boolean; deafened: boolean; sharing: boolean; camera: boolean }
    }
  | { t: 'call.hangup'; channelId: string }
  | { t: 'call.update'; channelId: string; muted: boolean; deafened: boolean; sharing: boolean; camera: boolean }
  | { t: 'call.signal'; channelId: string; to: string; data: SignalData }

export type HomeServerMessage =
  | {
      t: 'ready'
      me: Me
      connId: string
      guilds: GuildInfo[]
      friends: Friend[]
      blocked: User[]
      dms: DmChannel[]
      presence: { status: Status; text: string | null }
      /** Presença dos amigos. */
      presences: Record<string, Presence>
      /** Voltou na chamada privada em que estava (a conexão anterior ainda estava nela). */
      resumed?: boolean
      /** Como está a chamada do `auth.call` (null: acabou). */
      call?: { channelId: string; members: VoiceMember[]; ringing: string[] } | null
    }
  | { t: 'me.updated'; me: Me }
  | { t: 'user.updated'; user: User }
  | { t: 'guild.joined'; guild: GuildInfo }
  | { t: 'guild.updated'; guild: GuildInfo }
  | { t: 'guild.left'; guildId: string; reason: 'left' | 'kicked' | 'banned' | 'deleted' }
  | { t: 'friends'; friends: Friend[] }
  | { t: 'blocked'; blocked: User[] }
  | { t: 'presence'; userId: string; presence: Presence }
  | { t: 'presence.self'; status: Status; text: string | null }
  | { t: 'dm.channel'; channel: DmChannel; reqId?: string }
  /** Conversa escondida da lista (em outro aparelho). */
  | { t: 'dm.closed'; channelId: string }
  | { t: 'dm.message'; channelId: string; message: Message; nonce?: string }
  | { t: 'dm.edited'; channelId: string; message: Message }
  | { t: 'dm.deleted'; channelId: string; id: string }
  | { t: 'dm.reactions'; channelId: string; id: string; reactions: Reaction[] }
  | { t: 'dm.history'; reqId: string; channelId: string; messages: Message[]; hasMore: boolean }
  | { t: 'dm.typing'; channelId: string; userId: string }
  | { t: 'dm.read'; channelId: string; lastReadId: string | null; unread: number }
  | { t: 'call.ringing'; channelId: string; from: string; video: boolean }
  | { t: 'call.state'; channelId: string; members: VoiceMember[]; ringing: string[] }
  | { t: 'call.ended'; channelId: string }
  | { t: 'call.signal'; channelId: string; from: string; data: SignalData }
  | { t: 'session.revoked' }
  | { t: 'error'; message: string; nonce?: string }

// ---------- Ids de conversa privada ----------

/** Conversa privada entre duas pessoas: id fixo com os dois ids em ordem. */
export function dmChannelId(a: string, b: string): string {
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`
}

export function dmMembers(channelId: string): [string, string] | null {
  const match = /^dm:([^:]+):([^:]+)$/.exec(channelId)
  return match && match[1] < match[2] ? [match[1], match[2]] : null
}
