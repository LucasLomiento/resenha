import type {
  ApiError,
  Attachment,
  AuthResponse,
  Friend,
  GuildInfo,
  ImportedStructure,
  InvitePreview,
  Me,
  ProfileStylePatch,
  SessionInfo,
  StatusResponse,
  User,
} from '../../../../shared/protocol'
import { m, serverText } from './i18n.svelte'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** O erro que o servidor mandou (em português), no idioma do app; sem texto, só o código. */
function errorText(body: unknown, status: number): string {
  const error = (body as ApiError | null)?.error
  return typeof error === 'string' && error ? serverText(error) : m.lib.api.status(status)
}

export function normalizeServer(input: string): string {
  let url = input.trim().replace(/\/+$/, '')
  if (url && !/^https?:\/\//.test(url)) url = (/^(localhost|127\.|192\.168\.|10\.)/.test(url) ? 'http://' : 'https://') + url
  return url
}

export interface AdminUser extends User {
  banned: boolean
  createdAt: number
}

export interface AdminPanel {
  signup: 'invite' | 'open'
  users: number
  guilds: number
  /** Convites que ainda dá pra usar (sem vencer e sem esgotar). */
  invites: number
  storageUsed: number
  storageLimit: number
  /** Mídia pelo Cloudflare (SFU + TURN) no mês, contada pelos apps. */
  mediaUsed: number
  mediaLimit: number
}

export interface Upload {
  promise: Promise<Attachment>
  abort: () => void
}

/** Conversa com o servidor por HTTP (o resto vai pelos WebSockets). */
export class Api {
  /** Nome do aparelho na lista de sessões ("App no Linux"). */
  static device = 'App Resenha'

  constructor(
    public server: string,
    public token: string | null = null,
  ) {}

  /** URL absoluta pra um caminho do servidor (anexos, fotos). */
  url(path: string): string {
    return this.server + path
  }

  /** Foto de perfil ou ícone de servidor. */
  media(id: string | null): string | null {
    return id ? `${this.server}/media/${id}` : null
  }

  /** Foto de alguém pras listas: a animada vem parada (o primeiro quadro). */
  avatar(user: Pick<User, 'avatar' | 'style'> | null | undefined): string | null {
    return this.media(user?.style?.avatarStill ?? user?.avatar ?? null)
  }

  /** Endereço do WebSocket, sem o token: ele vai na primeira mensagem (URL acaba em log). */
  wsUrl(path: string): string {
    return `${this.server.replace(/^http/, 'ws')}${path}`
  }

  private async request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const { json, ...rest } = init
    let res: Response
    try {
      res = await fetch(this.server + path, {
        ...rest,
        body: json !== undefined ? JSON.stringify(json) : rest.body,
        headers: {
          ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          'X-Resenha-Device': Api.device,
          ...rest.headers,
        },
      })
    } catch {
      throw new HttpError(0, m.lib.api.offline)
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new HttpError(res.status, errorText(body, res.status))
    return body as T
  }

  // ---------- Entrar ----------

  status() {
    return this.request<StatusResponse>('/api/status')
  }

  register(input: { username: string; name: string; password: string; invite?: string; turnstileToken?: string }) {
    return this.request<AuthResponse>('/api/register', { method: 'POST', json: input })
  }

  login(username: string, password: string) {
    return this.request<AuthResponse>('/api/login', { method: 'POST', json: { username, password } })
  }

  logout() {
    return this.request('/api/logout', { method: 'POST', json: {} })
  }

  // ---------- Conta ----------

  me() {
    return this.request<Me>('/api/me')
  }

  updateMe(patch: Partial<Pick<Me, 'name' | 'bio' | 'accent' | 'dmPolicy'>> & { style?: ProfileStylePatch }) {
    return this.request<Me>('/api/me', { method: 'PATCH', json: patch })
  }

  /** Foto animada vai num formulário, junto com o quadro parado (o que aparece nas listas). */
  setAvatar(image: Blob, still: Blob | null = null) {
    if (!still) return this.request<Me>('/api/me/avatar', { method: 'PUT', body: image, headers: { 'Content-Type': image.type } })
    const form = new FormData()
    form.append('image', image)
    form.append('still', still)
    return this.request<Me>('/api/me/avatar', { method: 'PUT', body: form })
  }

  clearAvatar() {
    return this.request<Me>('/api/me/avatar', { method: 'DELETE' })
  }

  setBanner(image: Blob) {
    return this.request<Me>('/api/me/banner', { method: 'PUT', body: image, headers: { 'Content-Type': image.type } })
  }

  clearBanner() {
    return this.request<Me>('/api/me/banner', { method: 'DELETE' })
  }

  changePassword(current: string, next: string) {
    return this.request('/api/me/password', { method: 'POST', json: { current, next } })
  }

  deleteAccount(password: string) {
    return this.request('/api/me/delete', { method: 'POST', json: { password } })
  }

  sessions() {
    return this.request<SessionInfo[]>('/api/me/sessions')
  }

  revokeSession(id: string) {
    return this.request(`/api/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  revokeOtherSessions() {
    return this.request<{ revoked: number }>('/api/me/sessions/others', { method: 'DELETE' })
  }

  async exportData(): Promise<Blob> {
    const res = await fetch(`${this.server}/api/me/export`, { headers: { Authorization: `Bearer ${this.token}` } })
    if (!res.ok) throw new HttpError(res.status, m.lib.api.exportFailed)
    return res.blob()
  }

  // ---------- Pessoas ----------

  user(id: string) {
    return this.request<User>(`/api/users/${encodeURIComponent(id)}`)
  }

  friendRequest(username: string) {
    return this.request<Friend['state']>('/api/friends', { method: 'POST', json: { username } })
  }

  friendAccept(userId: string) {
    return this.request(`/api/friends/${encodeURIComponent(userId)}/accept`, { method: 'POST', json: {} })
  }

  friendRemove(userId: string) {
    return this.request(`/api/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' })
  }

  block(userId: string) {
    return this.request(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'PUT' })
  }

  unblock(userId: string) {
    return this.request(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' })
  }

  // ---------- Servidores ----------

  createGuild(name: string) {
    return this.request<GuildInfo>('/api/guilds', { method: 'POST', json: { name } })
  }

  // ---------- Mídia pelo Cloudflare (SFU) ----------

  /** O que o servidor oferece agora (o SFU e o TURN somem quando a cota do mês acaba). */
  mediaStatus() {
    return this.request<{ sfu: boolean; turn: boolean; used: number; limit: number }>('/api/media')
  }

  /** Conta o que passou pelo Cloudflare (SFU recebido e TURN), pra cota do mês. */
  mediaUsage(bytes: number) {
    return this.request<{ allowed: boolean }>('/api/media/usage', { method: 'POST', json: { bytes } })
  }

  sfuSession() {
    return this.request<{ sessionId: string; token: string }>('/api/media/sessions', { method: 'POST', json: {} })
  }

  sfuPush(session: { sessionId: string; token: string }, sdp: string, tracks: { mid: string; trackName: string }[]) {
    return this.request<{ sdp: string }>(`/api/media/sessions/${session.sessionId}/push`, { method: 'POST', json: { token: session.token, sdp, tracks } })
  }

  sfuPull(session: { sessionId: string; token: string }, tracks: { sessionId: string; trackName: string }[]) {
    return this.request<{ sdp: string | null; tracks: { mid: string; trackName: string }[] }>(`/api/media/sessions/${session.sessionId}/pull`, {
      method: 'POST',
      json: { token: session.token, tracks },
    })
  }

  sfuRenegotiate(session: { sessionId: string; token: string }, sdp: string) {
    return this.request(`/api/media/sessions/${session.sessionId}/renegotiate`, { method: 'POST', json: { token: session.token, sdp } })
  }

  sfuClose(session: { sessionId: string; token: string }, mids: string[]) {
    return this.request(`/api/media/sessions/${session.sessionId}/close`, { method: 'POST', json: { token: session.token, mids } })
  }

  /** Lê a lista de canais de um print do Discord (o servidor manda pro modelo de visão). */
  importDiscord(image: Blob) {
    return this.request<ImportedStructure>('/api/import/discord', { method: 'POST', body: image, headers: { 'Content-Type': image.type } })
  }

  uploadGuildIcon(image: Blob) {
    return this.request<{ id: string }>('/api/guilds/icon', { method: 'POST', body: image, headers: { 'Content-Type': image.type } })
  }

  leaveGuild(id: string) {
    return this.request(`/api/guilds/${encodeURIComponent(id)}/leave`, { method: 'POST', json: {} })
  }

  deleteGuild(id: string, name: string) {
    return this.request(`/api/guilds/${encodeURIComponent(id)}/delete`, { method: 'POST', json: { name } })
  }

  invitePreview(code: string) {
    return this.request<InvitePreview>(`/api/invites/${encodeURIComponent(code)}`)
  }

  joinInvite(code: string) {
    return this.request<GuildInfo>(`/api/invites/${encodeURIComponent(code)}`, { method: 'POST', json: {} })
  }

  // ---------- Dono da plataforma ----------

  admin() {
    return this.request<AdminPanel>('/api/admin')
  }

  adminSignup(mode: 'invite' | 'open') {
    return this.request('/api/admin/signup', { method: 'PUT', json: { mode } })
  }

  adminUsers(query: string) {
    return this.request<AdminUser[]>(`/api/admin/users?q=${encodeURIComponent(query)}`)
  }

  adminBan(userId: string, banned: boolean) {
    return this.request(`/api/admin/users/${encodeURIComponent(userId)}/ban`, { method: 'POST', json: { banned } })
  }

  /** Dá o selo de Pioneiro (e os exclusivos dele) pra outra conta. */
  adminSetPioneer(userId: string) {
    return this.request(`/api/admin/users/${encodeURIComponent(userId)}/pioneer`, { method: 'POST', json: {} })
  }

  // ---------- Call e anexos ----------

  async iceServers(): Promise<RTCIceServer[]> {
    return (await this.request<{ iceServers: RTCIceServer[] }>('/api/ice')).iceServers
  }

  /**
   * Envia um anexo pro lugar certo (`/api/g/<servidor>/files` ou
   * `/api/c/<conversa>/files`). XHR em vez de fetch só pra ter progresso.
   */
  upload(path: string, file: File, onProgress: (fraction: number) => void, size?: { width: number; height: number } | null): Upload {
    const xhr = new XMLHttpRequest()
    const promise = new Promise<Attachment>((resolve, reject) => {
      xhr.open('POST', this.server + path)
      xhr.setRequestHeader('Authorization', `Bearer ${this.token}`)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'arquivo'))
      if (size) xhr.setRequestHeader('X-Media-Size', `${Math.round(size.width)}x${Math.round(size.height)}`)
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
      xhr.onload = () => {
        let body: unknown = {}
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          // resposta sem JSON
        }
        if (xhr.status === 200) resolve(body as Attachment)
        else reject(new HttpError(xhr.status, errorText(body, xhr.status)))
      }
      xhr.onerror = () => reject(new HttpError(0, m.lib.api.uploadNetwork))
      xhr.onabort = () => reject(new HttpError(0, m.lib.api.uploadCanceled))
      xhr.send(file)
    })
    return { promise, abort: () => xhr.abort() }
  }
}
