import { P, has, type Channel, type DmChannel, type Message, type User } from '../../../../../shared/protocol'
import { client } from '../../lib/client.svelte'
import type { GuildState } from '../../lib/guild.svelte'
import type { HomeState } from '../../lib/home.svelte'
import type { MentionNames } from './Markdown.svelte'

const hex = (color: number | null) => (color === null ? null : `#${color.toString(16).padStart(6, '0')}`)

/**
 * O que o chat precisa saber de onde está: um canal de servidor ou uma
 * conversa privada. Tudo aqui é lido na hora (reativo), então a tela acompanha
 * as mudanças sem cópia.
 */
export interface ChatTarget {
  kind: 'channel' | 'dm'
  /** Id do canal ou da conversa. */
  id: string
  guild: GuildState | null
  channel: Channel | null
  dm: DmChannel | null
  title: string
  placeholder: string
  messages: Message[]
  /** undefined = ainda não carregou. */
  hasMore: boolean | undefined
  hasNewer: boolean
  loading: boolean
  canSend: boolean
  canAttach: boolean
  canReact: boolean
  /** Fixar e apagar mensagem dos outros. */
  canManage: boolean
  canPin: boolean
  canSearch: boolean
  canMentionEveryone: boolean
  slowmode: number
  /** Até onde eu tinha lido quando abri (pra linha de "novas"). */
  lastReadId: string | null
  /** Onde enviar anexos. */
  uploadPath: string
  names: MentionNames
  displayName(userId: string): string
  color(userId: string): string | null
  avatar(userId: string): string | null
  /** Foto animada (só se for), pro hover. */
  animatedAvatar(userId: string): string | null
  /** Perfil (pra moldura e nome com estilo). */
  profile(userId: string): User | undefined
  mentionsMe(message: Message): boolean
  typing(now: number): string[]
  send(content: string, attachmentIds: string[], replyTo: string | null): Promise<void>
  edit(id: string, content: string): void
  remove(id: string): void
  react(id: string, emoji: string, on: boolean): void
  pin(id: string, on: boolean): void
  loadMore(): void
  loadNewer(): void
  jumpTo(id: string): Promise<void>
  jumpToPresent(): void
  typingStart(): void
  ack(): void
}

export function channelTarget(guild: GuildState, channel: Channel): ChatTarget {
  const id = channel.id
  const perms = () => guild.permissions[id] ?? 0
  const lastReadId = guild.readStates[id]?.lastReadId ?? null
  return {
    kind: 'channel',
    id,
    guild,
    get channel() {
      return guild.channel(id) ?? channel
    },
    dm: null,
    get title() {
      return guild.channel(id)?.name ?? channel.name
    },
    get placeholder() {
      if (!has(perms(), P.SEND_MESSAGES)) return 'Você não pode escrever neste canal'
      return `Mensagem em #${this.title}`
    },
    get messages() {
      return guild.messages[id] ?? []
    },
    get hasMore() {
      return guild.hasMore[id]
    },
    get hasNewer() {
      return !!guild.hasNewer[id]
    },
    get loading() {
      return !!guild.loadingHistory[id]
    },
    get canSend() {
      return has(perms(), P.SEND_MESSAGES)
    },
    get canAttach() {
      return has(perms(), P.ATTACH_FILES)
    },
    get canReact() {
      return has(perms(), P.ADD_REACTIONS)
    },
    get canManage() {
      return has(perms(), P.MANAGE_MESSAGES)
    },
    get canPin() {
      return has(perms(), P.MANAGE_MESSAGES)
    },
    canSearch: true,
    get canMentionEveryone() {
      return has(perms(), P.MENTION_EVERYONE)
    },
    get slowmode() {
      return has(perms(), P.MANAGE_MESSAGES) || has(perms(), P.MANAGE_CHANNELS) ? 0 : (guild.channel(id)?.slowmode ?? 0)
    },
    lastReadId,
    uploadPath: `/api/g/${encodeURIComponent(guild.id)}/files?channel=${encodeURIComponent(id)}`,
    names: {
      user: (userId) => guild.displayName(userId),
      role: (roleId) => {
        const role = guild.roles.find((r) => r.id === roleId)
        return role ? { name: role.id === guild.id ? 'everyone' : role.name, color: role.color } : null
      },
      channel: (channelId) => {
        const found = guild.channel(channelId)
        return found && guild.permissions[found.id] !== undefined ? { name: found.name, kind: found.kind } : null
      },
      openChannel: (channelId) => client.openChannel(guild.id, channelId),
    },
    displayName: (userId) => guild.displayName(userId),
    color: (userId) => hex(guild.colorOf(userId)),
    avatar: (userId) => client.avatarOf(userId, guild.id),
    animatedAvatar: (userId) => client.animatedAvatarOf(userId, guild.id),
    profile: (userId) => client.user(userId, guild.id),
    mentionsMe: (message) => guild.mentionsMe(message),
    typing: (now) => guild.typingIn(id, now),
    send: (content, attachmentIds, replyTo) => guild.sendMessage(id, content, attachmentIds, replyTo),
    edit: (messageId, content) => guild.editMessage(messageId, content),
    remove: (messageId) => guild.deleteMessage(messageId),
    react: (messageId, emoji, on) => guild.react(messageId, emoji, on),
    pin: (messageId, on) => guild.pin(messageId, on),
    loadMore: () => {
      const first = guild.messages[id]?.[0]
      if (first && guild.hasMore[id]) guild.loadHistory(id, first.id)
    },
    loadNewer: () => guild.loadNewer(id),
    jumpTo: (messageId) => guild.jumpTo(id, messageId),
    jumpToPresent: () => guild.jumpToPresent(id),
    typingStart: () => guild.typingStart(id),
    ack: () => guild.ack(id),
  }
}

export function dmTarget(home: HomeState, dm: DmChannel): ChatTarget {
  const id = dm.id
  const peer = () => home.dm(id)?.user ?? dm.user
  return {
    kind: 'dm',
    id,
    guild: null,
    channel: null,
    get dm() {
      return home.dm(id) ?? dm
    },
    get title() {
      return peer().name
    },
    get placeholder() {
      return `Mensagem pra ${peer().name}`
    },
    get messages() {
      return home.messages[id] ?? []
    },
    get hasMore() {
      return home.hasMore[id]
    },
    hasNewer: false,
    get loading() {
      return !!home.loadingHistory[id]
    },
    get canSend() {
      return !home.isBlocked(peer().id)
    },
    canAttach: true,
    canReact: true,
    canManage: false,
    canPin: false,
    canSearch: false,
    canMentionEveryone: false,
    slowmode: 0,
    lastReadId: dm.lastReadId,
    uploadPath: `/api/c/${encodeURIComponent(id)}/files`,
    names: {
      user: (userId) => client.displayName(userId),
      role: () => null,
      channel: () => null,
    },
    displayName: (userId) => client.displayName(userId),
    color: () => null,
    avatar: (userId) => client.avatarOf(userId),
    animatedAvatar: (userId) => client.animatedAvatarOf(userId),
    profile: (userId) => client.user(userId),
    mentionsMe: () => false,
    typing: (now) => home.typingIn(id, now),
    send: (content, attachmentIds, replyTo) => home.sendMessage(id, content, attachmentIds, replyTo),
    edit: (messageId, content) => home.editMessage(id, messageId, content),
    remove: (messageId) => home.deleteMessage(id, messageId),
    react: (messageId, emoji, on) => home.react(id, messageId, emoji, on),
    pin: () => {},
    loadMore: () => {
      const first = home.messages[id]?.[0]
      if (first && home.hasMore[id]) home.loadHistory(id, first.id)
    },
    loadNewer: () => {},
    jumpTo: async () => {},
    jumpToPresent: () => {},
    typingStart: () => home.typingStart(id),
    ack: () => home.ack(id),
  }
}
