import { outranks } from '../../../../../shared/permissions'
import { P, has } from '../../../../../shared/protocol'
import { client } from '../../lib/client.svelte'
import type { GuildState } from '../../lib/guild.svelte'
import { confirmAction, openProfile, ui, type Anchor } from '../../lib/ui.svelte'
import type { MenuItem } from '../kit'

/** Dá pra moderar essa pessoa (ela está abaixo de mim na hierarquia)? */
export function canModerate(guild: GuildState, userId: string): boolean {
  const me = guild.members[guild.meId]
  const target = guild.members[userId]
  if (!me || !target || userId === guild.meId) return false
  const roles = new Map(guild.roles.map((r) => [r.id, r]))
  return outranks({ guildId: guild.id, ownerId: guild.info.ownerId, roles }, me, target)
}

/**
 * Menu de contexto de uma pessoa num servidor (lista de membros, call, chat).
 * Só aparece o que eu posso fazer.
 */
export function memberMenu(guild: GuildState, userId: string, anchor: Anchor): MenuItem[] {
  const self = userId === guild.meId
  const perms = guild.guildPermissions
  const can = (bit: number) => has(perms, bit)
  const name = guild.displayName(userId)
  const member = guild.members[userId]
  const voice = guild.voice.find((v) => v.userId === userId)
  const moderate = canModerate(guild, userId)
  const items: MenuItem[] = [{ label: 'Perfil', icon: 'user', onselect: () => openProfile(userId, guild.id, anchor) }]
  if (!self) items.push({ label: 'Mensagem', icon: 'message', onselect: () => client.openDm(userId) })
  if (self && can(P.CHANGE_NICKNAME)) {
    items.push({ label: 'Mudar meu apelido', icon: 'pencil', onselect: () => openProfile(userId, guild.id, anchor) })
  }

  if (voice && (moderate || self)) {
    const voiceItems: MenuItem[] = []
    if (can(P.MUTE_MEMBERS)) {
      voiceItems.push({
        label: member?.serverMuted ? 'Desmutar pra todos' : 'Mutar pra todos',
        icon: member?.serverMuted ? 'mic' : 'mic-off',
        onselect: () => guild.moderateVoice(userId, { serverMuted: !member?.serverMuted }),
      })
    }
    if (can(P.DEAFEN_MEMBERS)) {
      voiceItems.push({
        label: member?.serverDeafened ? 'Voltar a ouvir (pra todos)' : 'Ensurdecer pra todos',
        icon: member?.serverDeafened ? 'headphones' : 'headphones-off',
        onselect: () => guild.moderateVoice(userId, { serverDeafened: !member?.serverDeafened }),
      })
    }
    if (can(P.MOVE_MEMBERS)) {
      const others = guild.orderedChannels.filter((c) => c.kind === 'voice' && c.id !== voice.channelId && guild.can(c.id, P.CONNECT))
      for (const channel of others.slice(0, 6)) {
        voiceItems.push({ label: `Mover pra ${channel.name}`, icon: 'move', onselect: () => guild.moderateVoice(userId, { moveTo: channel.id }) })
      }
      voiceItems.push({ label: 'Desconectar da call', icon: 'phone-off', onselect: () => guild.moderateVoice(userId, { disconnect: true }) })
    }
    if (voiceItems.length) items.push({ kind: 'separator' }, ...voiceItems)
  }

  if (moderate) {
    const modItems: MenuItem[] = []
    if (can(P.MANAGE_ROLES)) {
      modItems.push({ label: 'Cargos…', icon: 'shield', onselect: () => (ui.guildSettings = { guildId: guild.id, page: 'members' }) })
    }
    if (can(P.MODERATE_MEMBERS)) {
      const timedOut = !!member?.timeoutUntil && member.timeoutUntil > Date.now()
      if (timedOut) {
        modItems.push({ label: 'Tirar o castigo', icon: 'clock', onselect: () => guild.timeout(userId, 0) })
      } else {
        for (const [minutes, label] of [
          [10, '10 minutos'],
          [60, '1 hora'],
          [1440, '1 dia'],
        ] as const) {
          modItems.push({ label: `Castigar por ${label}`, icon: 'clock', onselect: () => guild.timeout(userId, minutes) })
        }
      }
    }
    if (can(P.KICK_MEMBERS)) {
      modItems.push({
        label: 'Expulsar',
        icon: 'user-x',
        danger: true,
        onselect: () =>
          confirmAction({
            title: `Expulsar ${name}?`,
            description: 'A pessoa sai do servidor, mas pode voltar com um convite.',
            confirm: 'Expulsar',
            onconfirm: () => guild.kick(userId),
          }),
      })
    }
    if (can(P.BAN_MEMBERS)) {
      modItems.push({
        label: 'Banir',
        icon: 'ban',
        danger: true,
        onselect: () =>
          confirmAction({
            title: `Banir ${name}?`,
            description: 'A pessoa sai e não volta, nem com convite, até alguém desbanir.',
            confirm: 'Banir',
            onconfirm: () => guild.ban(userId),
          }),
      })
    }
    if (modItems.length) items.push({ kind: 'separator' }, ...modItems)
  }
  return items
}
