// Permissões e hierarquia, do jeito que as telas do servidor mostram.
// O servidor confere tudo de novo; aqui é só pra esconder o que a pessoa não pode.

import { basePermissions, outranks, topPosition, type PermissionContext } from '../../../../../shared/permissions'
import { ALL_PERMISSIONS, P, has, type ChannelKind, type Overwrite } from '../../../../../shared/protocol'
import type { GuildState } from '../../lib/guild.svelte'

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

/** Permissões de cargo, por grupo (Cargos). */
export const ROLE_PERMISSIONS: PermissionGroup[] = [
  {
    title: 'Geral',
    items: [
      { bit: P.VIEW_CHANNEL, label: 'Ver canais' },
      { bit: P.MANAGE_CHANNELS, label: 'Gerenciar canais', hint: 'Criar, editar e apagar canais e categorias.' },
      { bit: P.MANAGE_ROLES, label: 'Gerenciar cargos', hint: 'Só os cargos abaixo do mais alto de quem tem.' },
      { bit: P.MANAGE_GUILD, label: 'Gerenciar o servidor', hint: 'Nome, ícone e convites.' },
      { bit: P.CREATE_INVITE, label: 'Criar convites' },
      { bit: P.CHANGE_NICKNAME, label: 'Mudar o próprio apelido' },
    ],
  },
  {
    title: 'Mensagens',
    items: [
      { bit: P.SEND_MESSAGES, label: 'Mandar mensagens' },
      { bit: P.ATTACH_FILES, label: 'Enviar arquivos' },
      { bit: P.ADD_REACTIONS, label: 'Reagir' },
      { bit: P.READ_HISTORY, label: 'Ler mensagens antigas', hint: 'Sem isso, só vê o que chegar com o canal aberto.' },
      { bit: P.MENTION_EVERYONE, label: 'Mencionar @everyone', hint: 'Avisa todo mundo do servidor.' },
      { bit: P.MANAGE_MESSAGES, label: 'Gerenciar mensagens', hint: 'Apagar e fixar mensagens dos outros.' },
    ],
  },
  {
    title: 'Voz',
    items: [
      { bit: P.CONNECT, label: 'Entrar nas calls' },
      { bit: P.SPEAK, label: 'Falar' },
      { bit: P.VIDEO, label: 'Câmera e tela' },
      { bit: P.MUTE_MEMBERS, label: 'Mutar os outros' },
      { bit: P.DEAFEN_MEMBERS, label: 'Ensurdecer os outros' },
      { bit: P.MOVE_MEMBERS, label: 'Mover e desconectar', hint: 'Tirar alguém da call ou levar pra outra.' },
    ],
  },
  {
    title: 'Moderação',
    items: [
      { bit: P.MANAGE_NICKNAMES, label: 'Mudar o apelido dos outros' },
      { bit: P.MODERATE_MEMBERS, label: 'Castigar', hint: 'Tirar alguém de falar e escrever por um tempo.' },
      { bit: P.KICK_MEMBERS, label: 'Expulsar' },
      { bit: P.BAN_MEMBERS, label: 'Banir' },
      { bit: P.VIEW_AUDIT_LOG, label: 'Ver o registro de auditoria' },
    ],
  },
  {
    title: 'Avançado',
    items: [{ bit: P.ADMINISTRATOR, label: 'Administrador', hint: 'Pode tudo, em todos os canais.' }],
  },
]

/** Permissões que valem por canal (exceções), de acordo com o tipo. */
export function channelPermissionGroups(kind: ChannelKind): PermissionGroup[] {
  const general: PermissionGroup = {
    title: 'Geral',
    items: [
      { bit: P.VIEW_CHANNEL, label: kind === 'category' ? 'Ver os canais' : 'Ver o canal' },
      {
        bit: P.MANAGE_CHANNELS,
        label: kind === 'category' ? 'Gerenciar os canais' : 'Gerenciar o canal',
        hint: 'Mudar nome e configurações, ou apagar.',
      },
      { bit: P.MANAGE_ROLES, label: 'Gerenciar permissões', hint: 'Mudar estas exceções.' },
    ],
  }
  const text: PermissionGroup = {
    title: 'Mensagens',
    items: [
      { bit: P.SEND_MESSAGES, label: 'Mandar mensagens' },
      { bit: P.ATTACH_FILES, label: 'Enviar arquivos' },
      { bit: P.ADD_REACTIONS, label: 'Reagir' },
      { bit: P.READ_HISTORY, label: 'Ler mensagens antigas' },
      { bit: P.MENTION_EVERYONE, label: 'Mencionar @everyone' },
      { bit: P.MANAGE_MESSAGES, label: 'Gerenciar mensagens', hint: 'Apagar e fixar mensagens dos outros.' },
    ],
  }
  const voice: PermissionGroup = {
    title: 'Voz',
    items: [
      { bit: P.CONNECT, label: 'Entrar na call' },
      { bit: P.SPEAK, label: 'Falar' },
      { bit: P.VIDEO, label: 'Câmera e tela' },
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
