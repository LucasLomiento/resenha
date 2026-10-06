// Dados de exemplo dos protótipos. Os nomes de campo seguem o protocolo novo
// (shared/protocol.ts da 0.6+: User, Presence, GuildInfo, Role, Member, Channel,
// Message com replyTo/reactions/mentions/pinned/embeds, Invite, Ban, AuditEntry,
// SessionInfo, Friend, DmChannel). Quem for implementar troca isto pelo store.

import type { Status } from '../kit'

export interface PUser {
  id: string
  username: string
  name: string
  /** Sem foto nos exemplos: o avatar usa o degradê do id. */
  avatar: string | null
  bio: string
  /** Cor do perfil (faixa do cartão). */
  accent: string | null
  createdAt: number
}

export interface PPresence {
  status: Status
  text: string | null
}

export interface PGuild {
  id: string
  name: string
  icon: string | null
  ownerId: string
  unread?: boolean
  mentions?: number
}

export interface PRole {
  id: string
  name: string
  color: string | null
  position: number
  hoist: boolean
  mentionable: boolean
}

export interface PMember {
  userId: string
  nick: string | null
  roles: string[]
  joinedAt: number
}

export interface PChannel {
  id: string
  name: string
  kind: 'text' | 'voice' | 'category'
  parentId: string | null
  topic?: string
  /** Só alguns cargos veem (overwrites). */
  private?: boolean
  /** Do ReadState: tem mensagem nova / menções não vistas. */
  unread?: boolean
  mentions?: number
  /** Notificações silenciadas (NotifySettings). */
  muted?: boolean
}

export interface PReaction {
  emoji: string
  count: number
  /** Eu reagi com esse. */
  me: boolean
}

export interface PEmbed {
  url: string
  siteName: string
  title: string
  description: string
  /** Imagem via proxy do servidor; aqui, um degradê. */
  image: boolean
}

export interface PMessage {
  id: string
  authorId: string
  content: string
  createdAt: number
  editedAt?: number | null
  replyTo?: { id: string; authorId: string; content: string } | null
  reactions?: PReaction[]
  pinned?: boolean
  /** Me menciona (direto, pelo cargo ou @everyone): a linha fica destacada. */
  mentionsMe?: boolean
  embeds?: PEmbed[]
  attachments?: { name: string; size: number; kind: 'image' | 'file' }[]
}

export interface PFriend {
  userId: string
  state: 'friends' | 'incoming' | 'outgoing'
}

export interface PDm {
  id: string
  userId: string
  unread: number
  last: string
}

export interface PSession {
  id: string
  device: string
  kind: 'desktop' | 'laptop' | 'phone'
  country: string
  lastSeenAt: number
  current: boolean
}

export interface PInvite {
  code: string
  inviterId: string
  uses: number
  maxUses: number | null
  expiresAt: number | null
}

export interface PBan {
  userId: string
  reason: string
  actorId: string
  createdAt: number
}

export interface PAudit {
  id: string
  actorId: string
  action:
    | 'channel.create'
    | 'channel.update'
    | 'role.update'
    | 'member.roles'
    | 'member.kick'
    | 'member.ban'
    | 'message.pin'
    | 'invite.create'
    | 'member.timeout'
  target: string
  detail: string
  createdAt: number
}

const NOW = new Date('2026-10-05T21:40:00').getTime()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const now = NOW

export const users: Record<string, PUser> = {
  me: { id: 'u-lucas', username: 'lucas', name: 'Lucas', avatar: null, bio: 'Fazendo o Resenha nas horas vagas.', accent: '#7c6cff', createdAt: NOW - 400 * DAY },
  bia: { id: 'u-bia', username: 'bia.santos', name: 'Bia', avatar: null, bio: 'Designer, gateira e viciada em café gelado.', accent: '#ff7a93', createdAt: NOW - 380 * DAY },
  rafa: { id: 'u-rafa', username: 'rafa_', name: 'Rafa', avatar: null, bio: 'Main suporte. Não me culpe.', accent: '#48b9ff', createdAt: NOW - 300 * DAY },
  duda: { id: 'u-duda', username: 'duda', name: 'Duda', avatar: null, bio: '', accent: null, createdAt: NOW - 250 * DAY },
  thiago: { id: 'u-thiago', username: 'thiagom', name: 'Thiago', avatar: null, bio: 'Back-end de dia, bardo de noite.', accent: '#36d6ad', createdAt: NOW - 200 * DAY },
  gabi: { id: 'u-gabi', username: 'gabs', name: 'Gabi', avatar: null, bio: '', accent: '#ffc35a', createdAt: NOW - 150 * DAY },
  pedro: { id: 'u-pedro', username: 'pedrao', name: 'Pedrão', avatar: null, bio: 'Só apareço na call das 23h.', accent: null, createdAt: NOW - 120 * DAY },
  nina: { id: 'u-nina', username: 'nina', name: 'Nina', avatar: null, bio: '', accent: '#ee78dc', createdAt: NOW - 90 * DAY },
  caio: { id: 'u-caio', username: 'caiozin', name: 'Caio', avatar: null, bio: '', accent: null, createdAt: NOW - 60 * DAY },
  mari: { id: 'u-mari', username: 'mari', name: 'Mari', avatar: null, bio: '', accent: '#9edc66', createdAt: NOW - 20 * DAY },
  jo: { id: 'u-jo', username: 'jo.dev', name: 'Jô', avatar: null, bio: '', accent: null, createdAt: NOW - 10 * DAY },
}

export const me = users.me

export function user(id: string): PUser {
  return Object.values(users).find((u) => u.id === id) ?? users.me
}

export const presences: Record<string, PPresence> = {
  'u-lucas': { status: 'online', text: null },
  'u-bia': { status: 'online', text: 'desenhando ícone novo' },
  'u-rafa': { status: 'dnd', text: 'ranqueada, não chama' },
  'u-duda': { status: 'idle', text: null },
  'u-thiago': { status: 'online', text: null },
  'u-gabi': { status: 'online', text: 'estudando pra prova' },
  'u-pedro': { status: 'offline', text: null },
  'u-nina': { status: 'offline', text: null },
  'u-caio': { status: 'idle', text: null },
  'u-mari': { status: 'offline', text: null },
  'u-jo': { status: 'online', text: null },
}

export const guilds: PGuild[] = [
  { id: 'g-resenha', name: 'Resenha', icon: null, ownerId: 'u-lucas' },
  { id: 'g-rpg', name: 'Mesa de RPG', icon: null, ownerId: 'u-thiago', unread: true, mentions: 2 },
  { id: 'g-facul', name: 'Facul 2026', icon: null, ownerId: 'u-gabi', unread: true },
  { id: 'g-lol', name: 'Lolzinho', icon: null, ownerId: 'u-rafa' },
]

export const roles: PRole[] = [
  { id: 'r-mod', name: 'Moderação', color: '#a99bff', position: 3, hoist: true, mentionable: true },
  { id: 'r-vet', name: 'Veteranos', color: '#4fd8b0', position: 2, hoist: true, mentionable: false },
  { id: 'r-art', name: 'Artistas', color: '#ff8fa6', position: 1, hoist: false, mentionable: true },
  { id: 'g-resenha', name: '@everyone', color: null, position: 0, hoist: false, mentionable: false },
]

export const members: PMember[] = [
  { userId: 'u-lucas', nick: null, roles: ['r-mod'], joinedAt: NOW - 400 * DAY },
  { userId: 'u-bia', nick: null, roles: ['r-mod', 'r-art'], joinedAt: NOW - 380 * DAY },
  { userId: 'u-rafa', nick: 'Rafa (suporte)', roles: ['r-vet'], joinedAt: NOW - 300 * DAY },
  { userId: 'u-thiago', nick: null, roles: ['r-vet'], joinedAt: NOW - 200 * DAY },
  { userId: 'u-duda', nick: null, roles: ['r-vet', 'r-art'], joinedAt: NOW - 250 * DAY },
  { userId: 'u-gabi', nick: null, roles: [], joinedAt: NOW - 150 * DAY },
  { userId: 'u-pedro', nick: null, roles: [], joinedAt: NOW - 120 * DAY },
  { userId: 'u-nina', nick: null, roles: ['r-art'], joinedAt: NOW - 90 * DAY },
  { userId: 'u-caio', nick: null, roles: [], joinedAt: NOW - 60 * DAY },
  { userId: 'u-mari', nick: null, roles: [], joinedAt: NOW - 20 * DAY },
  { userId: 'u-jo', nick: null, roles: [], joinedAt: NOW - 10 * DAY },
]

export function member(userId: string): PMember | undefined {
  return members.find((m) => m.userId === userId)
}

/** Nome no servidor: apelido, senão o nome de exibição. */
export function displayName(userId: string): string {
  return member(userId)?.nick ?? user(userId).name
}

/** Cor do nome: a do cargo mais alto que tem cor. */
export function roleColor(userId: string): string | null {
  const own = member(userId)?.roles ?? []
  return roles.filter((r) => own.includes(r.id) && r.color).sort((a, b) => b.position - a.position)[0]?.color ?? null
}

export const channels: PChannel[] = [
  { id: 'cat-papo', name: 'Papo', kind: 'category', parentId: null },
  { id: 'c-geral', name: 'geral', kind: 'text', parentId: 'cat-papo', topic: 'Bem-vindo! Aqui é o papo de sempre.' },
  { id: 'c-memes', name: 'memes', kind: 'text', parentId: 'cat-papo', unread: true },
  { id: 'c-links', name: 'links-e-achados', kind: 'text', parentId: 'cat-papo', muted: true },
  { id: 'cat-jogos', name: 'Jogos', kind: 'category', parentId: null },
  { id: 'c-lol', name: 'lolzinho', kind: 'text', parentId: 'cat-jogos', unread: true, mentions: 2 },
  { id: 'c-mine', name: 'minecraft', kind: 'text', parentId: 'cat-jogos' },
  { id: 'cat-calls', name: 'Calls', kind: 'category', parentId: null },
  { id: 'v-resenha', name: 'Rolê', kind: 'voice', parentId: 'cat-calls' },
  { id: 'v-jogatina', name: 'Jogatina', kind: 'voice', parentId: 'cat-calls' },
  { id: 'v-estudos', name: 'Estudos', kind: 'voice', parentId: 'cat-calls' },
  { id: 'cat-mod', name: 'Moderação', kind: 'category', parentId: null },
  { id: 'c-staff', name: 'staff', kind: 'text', parentId: 'cat-mod', private: true },
]

export const voice: { channelId: string; userId: string; muted?: boolean; deafened?: boolean; sharing?: boolean; camera?: boolean; speaking?: boolean }[] = [
  { channelId: 'v-resenha', userId: 'u-bia', speaking: true, sharing: true },
  { channelId: 'v-resenha', userId: 'u-thiago', muted: true },
  { channelId: 'v-resenha', userId: 'u-gabi', camera: true },
  { channelId: 'v-jogatina', userId: 'u-rafa', deafened: true },
]

const T = NOW - 3 * HOUR

export const messages: PMessage[] = [
  {
    id: 'm1',
    authorId: 'u-thiago',
    content: 'Gente, sábado tem sessão de RPG? Preciso saber se levo os dados.',
    createdAt: NOW - DAY - 2 * HOUR,
  },
  {
    id: 'm2',
    authorId: 'u-bia',
    content: 'Tem sim! Começa às 20h na <#v-resenha>.',
    createdAt: NOW - DAY - 2 * HOUR + 3 * MIN,
    reactions: [
      { emoji: '🎲', count: 3, me: true },
      { emoji: '🔥', count: 1, me: false },
    ],
  },
  {
    id: 'm3',
    authorId: 'u-gabi',
    content: 'Achei esse vídeo sobre design de mapas, vale muito:\nhttps://youtu.be/mapas-incriveis',
    createdAt: T,
    embeds: [
      {
        url: 'https://youtu.be/mapas-incriveis',
        siteName: 'YouTube',
        title: 'Como desenhar mapas de fantasia em 10 minutos',
        description: 'Do rascunho ao mapa final, com textura de papel e tudo.',
        image: true,
      },
    ],
  },
  {
    id: 'm4',
    authorId: 'u-rafa',
    content: '<@u-lucas> o Resenha travou aqui quando eu colei um print gigante, sabe o que pode ser?',
    createdAt: T + 22 * MIN,
    mentionsMe: true,
  },
  {
    id: 'm5',
    authorId: 'u-lucas',
    content: 'Já arrumei! Agora a imagem é diminuída antes de enviar. Atualiza aí.',
    createdAt: T + 25 * MIN,
    replyTo: { id: 'm4', authorId: 'u-rafa', content: 'o Resenha travou aqui quando eu colei um print gigante…' },
    reactions: [
      { emoji: '🙏', count: 2, me: false },
      { emoji: '🚀', count: 4, me: true },
    ],
  },
  {
    id: 'm6',
    authorId: 'u-lucas',
    content: 'Se mais alguém ver, me manda no privado com o `resenha --version`.',
    createdAt: T + 26 * MIN,
  },
  {
    id: 'm7',
    authorId: 'u-bia',
    content: 'Ficou assim o ícone novo, o que acharam?',
    createdAt: T + 70 * MIN,
    attachments: [{ name: 'icone-v3.png', size: 248_000, kind: 'image' }],
    pinned: true,
    reactions: [
      { emoji: '😍', count: 5, me: true },
      { emoji: '👏', count: 2, me: false },
    ],
  },
  {
    id: 'm8',
    authorId: 'u-duda',
    content: '**Muito** bom. Só deixaria o coral um pouco mais quente.',
    createdAt: T + 74 * MIN,
    replyTo: { id: 'm7', authorId: 'u-bia', content: 'Ficou assim o ícone novo, o que acharam?' },
  },
  {
    id: 'm9',
    authorId: 'u-thiago',
    content: '@everyone call hoje às 23h pra testar a transmissão em 1440p 🎮',
    createdAt: T + 110 * MIN,
    mentionsMe: true,
    pinned: true,
  },
]

export const pinned = messages.filter((m) => m.pinned)

export const friends: PFriend[] = [
  { userId: 'u-bia', state: 'friends' },
  { userId: 'u-rafa', state: 'friends' },
  { userId: 'u-thiago', state: 'friends' },
  { userId: 'u-gabi', state: 'friends' },
  { userId: 'u-duda', state: 'friends' },
  { userId: 'u-pedro', state: 'friends' },
  { userId: 'u-nina', state: 'friends' },
  { userId: 'u-mari', state: 'incoming' },
  { userId: 'u-jo', state: 'incoming' },
  { userId: 'u-caio', state: 'outgoing' },
]

export const dms: PDm[] = [
  { id: 'dm-bia', userId: 'u-bia', unread: 2, last: 'manda o arquivo do ícone?' },
  { id: 'dm-rafa', userId: 'u-rafa', unread: 0, last: 'valeu, funcionou!' },
  { id: 'dm-thiago', userId: 'u-thiago', unread: 0, last: 'Você: fechado, sábado então' },
  { id: 'dm-gabi', userId: 'u-gabi', unread: 0, last: 'kkkkkkk' },
  { id: 'dm-pedro', userId: 'u-pedro', unread: 0, last: 'Você: bora call?' },
]

export const dmMessages: PMessage[] = [
  { id: 'd1', authorId: 'u-bia', content: 'Oi! Viu o ícone novo que eu mandei no geral?', createdAt: NOW - 50 * MIN },
  { id: 'd2', authorId: 'u-lucas', content: 'Vi! Ficou demais. Vou usar no app.', createdAt: NOW - 46 * MIN },
  { id: 'd3', authorId: 'u-lucas', content: 'Só preciso do SVG em 512 px.', createdAt: NOW - 46 * MIN + 20_000 },
  { id: 'd4', authorId: 'u-bia', content: 'Tranquilo, te mando hoje à noite.', createdAt: NOW - 12 * MIN, reactions: [{ emoji: '❤️', count: 1, me: true }] },
  { id: 'd5', authorId: 'u-bia', content: 'manda o arquivo do ícone? o antigo, pra eu comparar', createdAt: NOW - 3 * MIN },
]

export const sessions: PSession[] = [
  { id: 's1', device: 'Resenha no Linux', kind: 'desktop', country: 'Brasil', lastSeenAt: NOW, current: true },
  { id: 's2', device: 'Resenha no Windows', kind: 'laptop', country: 'Brasil', lastSeenAt: NOW - 2 * DAY, current: false },
  { id: 's3', device: 'Resenha no Windows', kind: 'desktop', country: 'Portugal', lastSeenAt: NOW - 19 * DAY, current: false },
]

export const invites: PInvite[] = [
  { code: 'RSNH-7Q2K', inviterId: 'u-lucas', uses: 3, maxUses: 10, expiresAt: NOW + 6 * DAY },
  { code: 'BIA-RPG42', inviterId: 'u-bia', uses: 1, maxUses: 1, expiresAt: NOW + 20 * HOUR },
  { code: 'FACUL-2026', inviterId: 'u-lucas', uses: 14, maxUses: null, expiresAt: null },
]

export const bans: PBan[] = [
  { userId: 'u-x1', reason: 'Spam de link em todos os canais', actorId: 'u-bia', createdAt: NOW - 5 * DAY },
  { userId: 'u-x2', reason: 'Conta falsa', actorId: 'u-lucas', createdAt: NOW - 40 * DAY },
]

export const bannedUsers: Record<string, PUser> = {
  'u-x1': { id: 'u-x1', username: 'promo.gratis', name: 'Promo Grátis', avatar: null, bio: '', accent: null, createdAt: NOW - 6 * DAY },
  'u-x2': { id: 'u-x2', username: 'lucass_', name: 'Lucas', avatar: null, bio: '', accent: null, createdAt: NOW - 41 * DAY },
}

export const audit: PAudit[] = [
  { id: 'a1', actorId: 'u-bia', action: 'message.pin', target: '#geral', detail: 'Fixou a mensagem de Thiago', createdAt: NOW - 20 * MIN },
  { id: 'a2', actorId: 'u-lucas', action: 'role.update', target: 'Veteranos', detail: 'Mudou a cor e deixou separado na lista', createdAt: NOW - 3 * HOUR },
  { id: 'a3', actorId: 'u-lucas', action: 'channel.create', target: '#links-e-achados', detail: 'Criou o canal em Papo', createdAt: NOW - 26 * HOUR },
  { id: 'a4', actorId: 'u-bia', action: 'member.ban', target: 'Promo Grátis', detail: 'Motivo: spam de link em todos os canais', createdAt: NOW - 5 * DAY },
  { id: 'a5', actorId: 'u-lucas', action: 'member.roles', target: 'Duda', detail: 'Deu o cargo Artistas', createdAt: NOW - 6 * DAY },
  { id: 'a6', actorId: 'u-thiago', action: 'invite.create', target: 'RSNH-7Q2K', detail: 'Vale 7 dias, até 10 usos', createdAt: NOW - 8 * DAY },
  { id: 'a7', actorId: 'u-bia', action: 'member.timeout', target: 'Caio', detail: 'Castigo de 10 minutos', createdAt: NOW - 12 * DAY },
]

/** Permissões por grupo, como aparecem em Cargos (nomes dos bits do protocolo novo). */
export const permissionGroups: { title: string; items: { key: string; label: string; hint?: string; on: boolean }[] }[] = [
  {
    title: 'Geral',
    items: [
      { key: 'VIEW_CHANNEL', label: 'Ver canais', on: true },
      { key: 'MANAGE_CHANNELS', label: 'Gerenciar canais', hint: 'Criar, editar e apagar canais e categorias.', on: true },
      { key: 'MANAGE_ROLES', label: 'Gerenciar cargos', hint: 'Só cargos abaixo do mais alto que a pessoa tem.', on: false },
      { key: 'MANAGE_GUILD', label: 'Gerenciar o servidor', hint: 'Nome, ícone e configurações.', on: false },
      { key: 'VIEW_AUDIT_LOG', label: 'Ver o registro de auditoria', on: true },
      { key: 'CREATE_INVITE', label: 'Criar convites', on: true },
    ],
  },
  {
    title: 'Mensagens',
    items: [
      { key: 'SEND_MESSAGES', label: 'Mandar mensagens', on: true },
      { key: 'ATTACH_FILES', label: 'Enviar arquivos', on: true },
      { key: 'ADD_REACTIONS', label: 'Reagir', on: true },
      { key: 'MENTION_EVERYONE', label: 'Mencionar @everyone', hint: 'Notifica todo mundo do servidor.', on: true },
      { key: 'MANAGE_MESSAGES', label: 'Gerenciar mensagens', hint: 'Apagar e fixar mensagens dos outros.', on: true },
    ],
  },
  {
    title: 'Voz',
    items: [
      { key: 'CONNECT', label: 'Entrar nas calls', on: true },
      { key: 'SPEAK', label: 'Falar', on: true },
      { key: 'VIDEO', label: 'Câmera e tela', on: true },
      { key: 'MUTE_MEMBERS', label: 'Mutar pessoas', on: true },
      { key: 'MOVE_MEMBERS', label: 'Mover e desconectar', on: false },
    ],
  },
  {
    title: 'Moderação',
    items: [
      { key: 'MODERATE_MEMBERS', label: 'Castigar', hint: 'Tirar alguém de falar e escrever por um tempo.', on: true },
      { key: 'KICK_MEMBERS', label: 'Expulsar', on: true },
      { key: 'BAN_MEMBERS', label: 'Banir', on: false },
      { key: 'ADMINISTRATOR', label: 'Administrador', hint: 'Pode tudo. Dê só pra quem confia muito.', on: false },
    ],
  },
]

const clockFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })

function dayDiff(ms: number) {
  const a = new Date(ms)
  const b = new Date(NOW)
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / DAY)
}

/** Igual ao formatStamp do app, mas com o "agora" fixo dos exemplos. */
export function stamp(ms: number): string {
  const days = dayDiff(ms)
  if (days === 0) return clockFmt.format(ms)
  if (days === 1) return `Ontem ${clockFmt.format(ms)}`
  return `${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(ms)} ${clockFmt.format(ms)}`
}

export function clock(ms: number): string {
  return clockFmt.format(ms)
}

export function dayLabel(ms: number): string {
  const days = dayDiff(ms)
  if (days === 0) return 'Hoje'
  if (days === 1) return 'Ontem'
  return dayFmt.format(ms).replace('-feira', '')
}

export function date(ms: number): string {
  return dateFmt.format(ms).replaceAll(' de ', ' ').replace('.', '')
}

export function sameDay(a: number, b: number): boolean {
  return dayDiff(a) === dayDiff(b)
}

const relFmt = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

/** "há 3 horas", "ontem", "em 6 dias". */
export function relative(ms: number): string {
  const diff = ms - NOW
  const abs = Math.abs(diff)
  if (abs < HOUR) return relFmt.format(Math.round(diff / MIN), 'minute')
  if (abs < DAY) return relFmt.format(Math.round(diff / HOUR), 'hour')
  return relFmt.format(Math.round(diff / DAY), 'day')
}
