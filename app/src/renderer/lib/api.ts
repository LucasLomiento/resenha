import type { ApiError, Attachment, AuthResponse, StatusResponse } from '../../../../shared/protocol'

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

export class Api {
  constructor(
    public server: string,
    public token: string | null = null,
  ) {}

  /** URL absoluta pra um caminho do servidor (ex.: o /api/files/... dos anexos). */
  url(path: string): string {
    return this.server + path
  }

  /** Endereço do WebSocket, sem o token: ele vai na primeira mensagem (URL acaba em log). */
  wsUrl(): string {
    return `${this.server.replace(/^http/, 'ws')}/ws`
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response
    try {
      res = await fetch(this.server + path, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...init.headers,
        },
      })
    } catch {
      throw new HttpError(0, 'Não deu pra falar com o servidor. Confira o endereço e a internet.')
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new HttpError(res.status, (body as ApiError).error ?? `Erro ${res.status}`)
    return body as T
  }

  status() {
    return this.request<StatusResponse>('/api/status')
  }

  register(name: string, password: string, invite: string) {
    return this.request<AuthResponse>('/api/register', {
      method: 'POST',
      body: JSON.stringify({ name, password, invite }),
    })
  }

  login(name: string, password: string) {
    return this.request<AuthResponse>('/api/login', { method: 'POST', body: JSON.stringify({ name, password }) })
  }

  logout() {
    return this.request('/api/logout', { method: 'POST', body: '{}' })
  }

  async iceServers(): Promise<RTCIceServer[]> {
    return (await this.request<{ iceServers: RTCIceServer[] }>('/api/ice')).iceServers
  }

  /** XHR em vez de fetch só pra ter progresso do envio. */
  upload(file: File, onProgress: (fraction: number) => void): { promise: Promise<Attachment>; abort: () => void } {
    const xhr = new XMLHttpRequest()
    const promise = new Promise<Attachment>((resolve, reject) => {
      xhr.open('POST', this.server + '/api/files')
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
