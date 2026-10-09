// Permissões e hierarquia, do jeito que as telas do servidor mostram.
// O servidor confere tudo de novo; aqui é só pra esconder o que a pessoa não pode.

import { basePermissions, outranks, topPosition, type PermissionContext } from '../../../../../shared/permissions'
import { ALL_PERMISSIONS, P, has, type ChannelKind, type Overwrite } from '../../../../../shared/protocol'
import type { GuildState } from '../../lib/guild.svelte'
import { m } from '../../lib/i18n.svelte'

export interface PermissionInfo {
  bit: number
  label: string
  /** Uma linha, só quando o nome não basta. */
  hint?: string
}

export interface PermissionGroup {
  title: string
  items: PermissionInfo[]
}

/** Permissões de cargo, por grupo (Cargos). Função: os nomes saem no idioma em uso. */
export function rolePermissions(): PermissionGroup[] {
  const { groups, role } = m.server.permissions
  return [
    {
      title: groups.general,
      items: [
        { bit: P.VIEW_CHANNEL, ...role.viewChannel },
        { bit: P.MANAGE_CHANNELS, ...role.manageChannels },
        { bit: P.MANAGE_ROLES, ...role.manageRoles },
        { bit: P.MANAGE_GUILD, ...role.manageGuild },
        { bit: P.CREATE_INVITE, ...role.createInvite },
        { bit: P.CHANGE_NICKNAME, ...role.changeNickname },
      ],
    },
    {
      title: groups.messages,
      items: [
        { bit: P.SEND_MESSAGES, ...role.sendMessages },
        { bit: P.ATTACH_FILES, ...role.attachFiles },
        { bit: P.ADD_REACTIONS, ...role.addReactions },
        { bit: P.READ_HISTORY, ...role.readHistory },
        { bit: P.MENTION_EVERYONE, ...role.mentionEveryone },
        { bit: P.MANAGE_MESSAGES, ...role.manageMessages },
      ],
    },
    {
      title: groups.voice,
      items: [
        { bit: P.CONNECT, ...role.connect },
        { bit: P.SPEAK, ...role.speak },
        { bit: P.VIDEO, ...role.video },
        { bit: P.MUTE_MEMBERS, ...role.muteMembers },
        { bit: P.DEAFEN_MEMBERS, ...role.deafenMembers },
        { bit: P.MOVE_MEMBERS, ...role.moveMembers },
      ],
    },
    {
      title: groups.moderation,
      items: [
        { bit: P.MANAGE_NICKNAMES, ...role.manageNicknames },
        { bit: P.MODERATE_MEMBERS, ...role.moderateMembers },
        { bit: P.KICK_MEMBERS, ...role.kickMembers },
        { bit: P.BAN_MEMBERS, ...role.banMembers },
        { bit: P.VIEW_AUDIT_LOG, ...role.viewAuditLog },
      ],
    },
    {
      title: groups.advanced,
      items: [{ bit: P.ADMINISTRATOR, ...role.administrator }],
    },
  ]
}

/** Permissões que valem por canal (exceções), de acordo com o tipo. */
export function channelPermissionGroups(kind: ChannelKind): PermissionGroup[] {
  const { groups, role, channel } = m.server.permissions
  const category = kind === 'category'
  const general: PermissionGroup = {
    title: groups.general,
    items: [
      { bit: P.VIEW_CHANNEL, label: category ? channel.viewChannels : channel.viewChannel },
      {
        bit: P.MANAGE_CHANNELS,
        label: category ? channel.manageChannels : channel.manageChannel,
        hint: channel.manageChannelHint,
      },
      { bit: P.MANAGE_ROLES, ...channel.managePermissions },
    ],
  }
  const text: PermissionGroup = {
    title: groups.messages,
    items: [
      { bit: P.SEND_MESSAGES, label: role.sendMessages.label },
      { bit: P.ATTACH_FILES, label: role.attachFiles.label },
      { bit: P.ADD_REACTIONS, label: role.addReactions.label },
      { bit: P.READ_HISTORY, label: role.readHistory.label },
      { bit: P.MENTION_EVERYONE, label: role.mentionEveryone.label },
      { bit: P.MANAGE_MESSAGES, ...role.manageMessages },
    ],
  }
  const voice: PermissionGroup = {
    title: groups.voice,
    items: [
      { bit: P.CONNECT, label: channel.connect },
      { bit: P.SPEAK, label: role.speak.label },
      { bit: P.VIDEO, label: role.video.label },
    ],
  }
  if (kind === 'text') return [general, text]
  if (kind === 'voice') return [general, voice]
  return [general, text, voice]
}

// ---------- Hierarquia ----------

export function permContext(guild: GuildState): PermissionContext {
  return { guildId: guild.id, ownerId: guild.info.ownerId, roles: new Map(guild.roles.map((r) => [r.id, r])) }
}

/** Posição do meu cargo mais alto (dono fica acima de tudo). */
export function myTop(guild: GuildState): number {
  const me = guild.me
  return me ? topPosition(permContext(guild), me) : 0
}

/** Eu estou acima dessa pessoa (posso moderar)? Nunca vale pro dono nem pra mim. */
export function outranksMember(guild: GuildState, userId: string): boolean {
  const me = guild.me
  const target = guild.members[userId]
  return !!me && !!target && userId !== guild.meId && outranks(permContext(guild), me, target)
}

/** Administrador (ou dono): pode tudo e não leva castigo. */
export function isAdmin(guild: GuildState, userId: string): boolean {
  const member = guild.members[userId]
  return !!member && (basePermissions(permContext(guild), member) & P.ADMINISTRATOR) !== 0
}

/** Bits que eu posso dar (cargos e exceções): administrador dá tudo, o resto só o que tem. */
export function grantable(guild: GuildState): number {
  const mine = guild.guildPermissions
  return has(mine, P.ADMINISTRATOR) ? ALL_PERMISSIONS : mine
}

// ---------- Cores de cargo ----------

/** 0xRRGGBB -> "#rrggbb". */
export function hex(color: number | null | undefined): string | null {
  return color === null || color === undefined ? null : `#${color.toString(16).padStart(6, '0')}`
}

/** "#rrggbb" -> 0xRRGGBB. */
export function colorValue(hexColor: string | null): number | null {
  return hexColor ? parseInt(hexColor.slice(1), 16) : null
}

/** Amostras de cor de cargo (mesma família do degradê dos avatares). */
export const ROLE_SWATCHES = ['#a99bff', '#4fd8b0', '#ff8fa6', '#ffc35a', '#6ab8ff', '#ee78dc', '#9edc66', '#ff9466']

// ---------- Exceções de canal ----------

export type TriValue = 'deny' | 'neutral' | 'allow'

export function triOf(overwrite: Overwrite | undefined, bit: number): TriValue {
  if (!overwrite) return 'neutral'
  if (overwrite.deny & bit) return 'deny'
  if (overwrite.allow & bit) return 'allow'
  return 'neutral'
}

/** Troca um bit de uma exceção (devolve uma cópia). */
export function withTri(overwrite: Overwrite, bit: number, value: TriValue): Overwrite {
  return {
    ...overwrite,
    allow: value === 'allow' ? overwrite.allow | bit : overwrite.allow & ~bit,
    deny: value === 'deny' ? overwrite.deny | bit : overwrite.deny & ~bit,
  }
}

/** Mesmas exceções, sem ligar pra ordem (e ignorando as vazias). */
export function sameRules(a: Overwrite[], b: Overwrite[]): boolean {
  const key = (o: Overwrite) => `${o.type}:${o.id}:${o.allow}:${o.deny}`
  const left = a.filter((o) => o.allow || o.deny).map(key)
  const right = new Set(b.filter((o) => o.allow || o.deny).map(key))
  return left.length === right.size && left.every((k) => right.has(k))
}
