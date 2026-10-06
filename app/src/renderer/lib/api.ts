import type {
  ApiError,
  Attachment,
  AuthResponse,
  Friend,
  GuildInfo,
  InvitePreview,
  Me,
  SessionInfo,
  StatusResponse,
  User,
} from '../../../../shared/protocol'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
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
  storageUsed: number
  storageLimit: number
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
      throw new HttpError(0, 'Não deu pra falar com o servidor. Confira a internet.')
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new HttpError(res.status, (body as ApiError).error ?? `Erro ${res.status}`)
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

  updateMe(patch: Partial<Pick<Me, 'name' | 'bio' | 'accent' | 'dmPolicy'>>) {
    return this.request<Me>('/api/me', { method: 'PATCH', json: patch })
  }

  setAvatar(image: Blob) {
    return this.request<Me>('/api/me/avatar', { method: 'PUT', body: image, headers: { 'Content-Type': image.type } })
  }

  clearAvatar() {
    return this.request<Me>('/api/me/avatar', { method: 'DELETE' })
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
    if (!res.ok) throw new HttpError(res.status, 'Não deu pra exportar agora.')
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

  // ---------- Call e anexos ----------

  async iceServers(): Promise<RTCIceServer[]> {
    return (await this.request<{ iceServers: RTCIceServer[] }>('/api/ice')).iceServers
  }

  /**
   * Envia um anexo pro lugar certo (`/api/g/<servidor>/files` ou
   * `/api/c/<conversa>/files`). XHR em vez de fetch só pra ter progresso.
   */
  upload(path: string, file: File, onProgress: (fraction: number) => void): Upload {
    const xhr = new XMLHttpRequest()
    const promise = new Promise<Attachment>((resolve, reject) => {
      xhr.open('POST', this.server + path)
      xhr.setRequestHeader('Authorization', `Bearer ${this.token}`)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'arquivo'))
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
      xhr.onload = () => {
        let body: unknown = {}
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          // resposta sem JSON
        }
        if (xhr.status === 200) resolve(body as Attachment)
        else reject(new HttpError(xhr.status, (body as ApiError).error ?? `Erro ${xhr.status}`))
      }
      xhr.onerror = () => reject(new HttpError(0, 'Falha de rede no envio.'))
      xhr.onabort = () => reject(new HttpError(0, 'Envio cancelado.'))
      xhr.send(file)
    })
    return { promise, abort: () => xhr.abort() }
  }
}
