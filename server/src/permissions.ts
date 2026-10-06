import { ALL_PERMISSIONS, P, type Channel, type Overwrite, type Role } from '../../shared/protocol'

// Cálculo de permissões no mesmo modelo do Discord:
//   1. base = @everyone + todos os cargos da pessoa (dono e ADMINISTRATOR = tudo);
//   2. no canal, aplica as exceções: @everyone, depois os cargos (junta todos
//      os "nega" e "permite"), depois a da própria pessoa;
//   3. sem VIEW_CHANNEL no canal, não pode nada nele;
//   4. de castigo, só vê e lê.
// Canal sem exceções próprias herda as da categoria.

export interface PermissionContext {
  guildId: string
  ownerId: string
  roles: Map<string, Role>
}

export interface MemberLike {
  userId: string
  roles: string[]
  timeoutUntil: number | null
}

export function basePermissions(ctx: PermissionContext, member: MemberLike): number {
  if (member.userId === ctx.ownerId) return ALL_PERMISSIONS
  let perms = ctx.roles.get(ctx.guildId)?.permissions ?? 0
  for (const roleId of member.roles) perms |= ctx.roles.get(roleId)?.permissions ?? 0
  return perms & P.ADMINISTRATOR ? ALL_PERMISSIONS : perms
}

export function effectiveOverwrites(channel: Channel, channels: Map<string, Channel>): Overwrite[] {
  if (channel.overwrites.length > 0 || !channel.parentId) return channel.overwrites
  return channels.get(channel.parentId)?.overwrites ?? []
}

export function channelPermissions(
  ctx: PermissionContext,
  member: MemberLike,
  channel: Channel,
  channels: Map<string, Channel>,
  now = Date.now(),
): number {
  const base = basePermissions(ctx, member)
  if (base === ALL_PERMISSIONS) return ALL_PERMISSIONS
  let perms = base
  const overwrites = effectiveOverwrites(channel, channels)

  const everyone = overwrites.find((o) => o.type === 'role' && o.id === ctx.guildId)
  if (everyone) perms = (perms & ~everyone.deny) | everyone.allow

  let allow = 0
  let deny = 0
  for (const o of overwrites) {
    if (o.type === 'role' && o.id !== ctx.guildId && member.roles.includes(o.id)) {
      allow |= o.allow
      deny |= o.deny
    }
  }
  perms = (perms & ~deny) | allow

  const own = overwrites.find((o) => o.type === 'member' && o.id === member.userId)
  if (own) perms = (perms & ~own.deny) | own.allow

  if (!(perms & P.VIEW_CHANNEL)) return 0
  if (member.timeoutUntil && member.timeoutUntil > now) perms &= P.VIEW_CHANNEL | P.READ_HISTORY
  return perms
}

/** Posição do cargo mais alto (0 = só @everyone). Dono fica acima de tudo. */
export function topPosition(ctx: PermissionContext, member: MemberLike): number {
  if (member.userId === ctx.ownerId) return Number.MAX_SAFE_INTEGER
  let top = 0
  for (const roleId of member.roles) top = Math.max(top, ctx.roles.get(roleId)?.position ?? 0)
  return top
}

/** Quem age só mexe em quem está abaixo dele na hierarquia (e nunca no dono). */
export function outranks(ctx: PermissionContext, actor: MemberLike, target: MemberLike): boolean {
  if (target.userId === ctx.ownerId) return false
  if (actor.userId === ctx.ownerId) return true
  return topPosition(ctx, actor) > topPosition(ctx, target)
}

/** Limpa uma lista de exceções vinda do app: só ids conhecidos e bits válidos. */
export function sanitizeOverwrites(
  value: unknown,
  isRole: (id: string) => boolean,
  isMember: (id: string) => boolean,
): Overwrite[] | null {
  if (!Array.isArray(value) || value.length > 100) return null
  const out: Overwrite[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const { id, type, allow, deny } = raw as Record<string, unknown>
    if (typeof id !== 'string' || (type !== 'role' && type !== 'member')) return null
    if (type === 'role' ? !isRole(id) : !isMember(id)) continue
    if (typeof allow !== 'number' || typeof deny !== 'number') return null
    out.push({ id, type, allow: allow & ALL_PERMISSIONS & ~P.ADMINISTRATOR, deny: deny & ALL_PERMISSIONS & ~P.ADMINISTRATOR })
  }
  return out
}
