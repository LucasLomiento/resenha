// Tipos trocados entre o app e o servidor (HTTP e WebSocket).
// Importado pelos dois lados por caminho relativo, então só pode ter tipos e
// constantes puras, sem dependência de Node, DOM ou Workers.

export const MAX_MESSAGE_LENGTH = 4000
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const HISTORY_PAGE = 50

export type ChannelKind = 'text' | 'voice'

// Conversa privada entre duas pessoas: o "canal" é só um id com os dois
// usuários em ordem, sem registro na tabela de canais.
export function dmChannelId(a: string, b: string): string {
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`
}

export function dmMembers(channelId: string): [string, string] | null {
  const match = /^dm:([^:]+):([^:]+)$/.exec(channelId)
  return match && match[1] < match[2] ? [match[1], match[2]] : null
}

export interface User {
  id: string
  name: string
  admin: boolean
}

export interface Channel {
  id: string
  name: string
  kind: ChannelKind
  position: number
}

export interface Attachment {
  id: string
  name: string
  size: number
  type: string
  /** Caminho assinado relativo ao servidor: /api/files/... */
  url: string
}

export interface Message {
  id: string
  channelId: string
  authorId: string
  content: string
  createdAt: number
  editedAt: number | null
  attachments: Attachment[]
}

/** Uma conexão (aba/instância do app) dentro de um canal de voz. */
export interface VoiceMember {
  connId: string
  userId: string
  channelId: string
  muted: boolean
  deafened: boolean
  sharing: boolean
}

// ---------- HTTP ----------

export interface AuthResponse {
  token: string
  user: User
}

export interface StatusResponse {
  /** true quando já existe conta: daí pra frente só entra com convite. */
  needsInvite: boolean
}

export interface ApiError {
  error: string
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

export type SignalData =
  | {
      kind: 'description'
      description: SessionDescription
      /** streamId -> o que é, pra quem recebe saber qual faixa é mic e qual é tela. */
      streams: Record<string, 'mic' | 'screen'>
    }
  | { kind: 'candidate'; candidate: IceCandidate | null }
  | { kind: 'watch' }
  | { kind: 'unwatch' }

// ---------- WebSocket: app -> servidor ----------

export type ClientMessage =
  | { t: 'chat.send'; channelId: string; content: string; attachmentIds: string[]; nonce: string }
  | { t: 'chat.edit'; id: string; content: string }
  | { t: 'chat.delete'; id: string }
  | { t: 'chat.history'; reqId: string; channelId: string; before?: string }
  | { t: 'typing'; channelId: string }
  | { t: 'channel.create'; name: string; kind: ChannelKind }
  | { t: 'channel.rename'; id: string; name: string }
  | { t: 'channel.delete'; id: string }
  | { t: 'invite.create' }
  | { t: 'voice.join'; channelId: string; muted: boolean; deafened: boolean }
  | { t: 'voice.leave' }
  | { t: 'voice.update'; muted: boolean; deafened: boolean; sharing: boolean }
  | { t: 'rtc.signal'; to: string; data: SignalData }

// ---------- WebSocket: servidor -> app ----------

export type ServerMessage =
  | {
      t: 'ready'
      me: User
      connId: string
      users: User[]
      channels: Channel[]
      voice: VoiceMember[]
      online: string[]
    }
  | { t: 'chat.message'; message: Message; nonce?: string }
  | { t: 'chat.edited'; message: Message }
  | { t: 'chat.deleted'; id: string; channelId: string }
  | { t: 'chat.history'; reqId: string; channelId: string; messages: Message[]; hasMore: boolean }
  | { t: 'typing'; channelId: string; userId: string }
  | { t: 'channel.upsert'; channel: Channel }
  | { t: 'channel.removed'; id: string }
  | { t: 'user.upsert'; user: User }
  | { t: 'presence'; userId: string; online: boolean }
  | { t: 'voice.state'; members: VoiceMember[] }
  | { t: 'rtc.signal'; from: string; data: SignalData }
  | { t: 'invite.created'; code: string }
  | { t: 'error'; message: string }
