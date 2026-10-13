// Spotify de mentira pro e2e: o login (accounts.spotify.com), a Web API que o
// bot usa (api.spotify.com/v1) e o que o librespot de mentira
// (fixtures/fake-librespot.mjs) pergunta e conta (/__fake/*). Guarda o que foi
// pedido, pro teste conferir.

import { createServer } from 'node:http'

const track = (id, name, artist, album, ms) => ({
  type: 'track',
  uri: `spotify:track:${id}`,
  name,
  artists: [{ name: artist }],
  album: { name: album, images: [] },
  duration_ms: ms,
})

export const TRACKS = [
  track('evidencias0000000000001', 'Evidências', 'Chitãozinho & Xororó', 'Cowboy do Asfalto', 270_000),
  track('lenda000000000000000002', 'Lenda', 'Sandy & Junior', 'Era Uma Vez', 240_000),
  track('tempoperdido00000000003', 'Tempo Perdido', 'Legião Urbana', 'Dois', 300_000),
]

const PLAYLIST = { type: 'playlist', uri: 'spotify:playlist:sertanejoraiz0000000001', name: 'Sertanejo Raiz', owner: { display_name: 'Spotify' }, images: [] }
const MINE = { type: 'playlist', uri: 'spotify:playlist:resenhadasexta000000001', name: 'Resenha de sexta', owner: { display_name: 'Lucas no Spotify' }, images: [] }
const ALBUM = { type: 'album', uri: 'spotify:album:cowboydoasfalto00000001', name: 'Cowboy do Asfalto', artists: [{ name: 'Chitãozinho & Xororó' }], images: [] }

/** O app de computador do Spotify (o login que o librespot aceita). */
const DESKTOP_APP = '65b708073fc0480ea92a077233ca87bd'

const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export async function startFakeSpotify() {
  const state = {
    current: null,
    playing: false,
    progress: 0,
    at: Date.now(),
    queue: [],
    shuffle: false,
    repeat: 'off',
    /** Comandos do player que chegaram (método + caminho + corpo). */
    log: [],
    /** Logins pedidos: com que app e pra onde o navegador volta. */
    logins: [],
    /** O librespot de mentira: com que argumentos subiu, e quanto som escreveu x quanto tempo tocou. */
    started: null,
    written: null,
    tokens: 0,
  }
  const progress = () => (state.playing ? state.progress + (Date.now() - state.at) : state.progress)
  const setPlaying = (playing) => {
    state.progress = progress()
    state.at = Date.now()
    state.playing = playing
  }
  const load = (item) => {
    state.current = item
    state.progress = 0
    state.at = Date.now()
    state.playing = true
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    let body = ''
    for await (const chunk of req) body += chunk
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(data === undefined ? '' : JSON.stringify(data))
    }
    const path = url.pathname
    const route = `${req.method} ${path}`
    if (path.startsWith('/v1/me/player') && req.method !== 'GET') state.log.push({ route, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : null })
    // Como no Spotify de verdade: com o token do app de computador, a Web API só dá 429 (a cota dele vive estourada).
    if (path.startsWith('/v1/') && req.headers.authorization === 'Bearer token-do-player') {
      res.writeHead(429, { 'Retry-After': '30' })
      return res.end()
    }
    if (path.startsWith('/v1/') && req.headers.authorization !== 'Bearer token-de-teste') return json(401, { error: { status: 401, message: 'Invalid access token' } })

    switch (route) {
      // ---------- Login ----------
      case 'GET /authorize': {
        state.logins.push({ clientId: url.searchParams.get('client_id'), redirect: url.searchParams.get('redirect_uri'), scope: url.searchParams.get('scope') })
        const redirect = new URL(url.searchParams.get('redirect_uri'))
        redirect.searchParams.set('code', 'codigo-de-teste')
        redirect.searchParams.set('state', url.searchParams.get('state'))
        res.writeHead(302, { Location: redirect.toString() })
        return res.end()
      }
      case 'POST /api/token': {
        // Um token pra cada app: o da pessoa (Web API) e o do app de computador (só pro librespot).
        const form = new URLSearchParams(body)
        const desktop = form.get('client_id') === DESKTOP_APP
        const refresh = desktop ? 'refresh-do-player' : 'refresh-de-teste'
        const ok = form.get('grant_type') === 'refresh_token' ? form.get('refresh_token') === refresh : !!form.get('code_verifier')
        if (!ok) return json(400, { error: 'invalid_grant' })
        state.tokens++
        return json(200, { access_token: desktop ? 'token-do-player' : 'token-de-teste', token_type: 'Bearer', expires_in: 3600, refresh_token: refresh })
      }
      // ---------- Web API ----------
      case 'GET /v1/me':
        return json(200, { id: 'lucas-spotify', display_name: 'Lucas no Spotify' })
      case 'GET /v1/me/player/devices':
        return json(200, { devices: state.started ? [{ id: 'aparelho-resenha', name: 'Resenha', type: 'Speaker', is_active: true }] : [] })
      case 'PUT /v1/me/player':
        return json(204)
      case 'GET /v1/me/player':
        if (!state.current) return json(204)
        return json(200, {
          device: { id: 'aparelho-resenha', name: 'Resenha' },
          is_playing: state.playing,
          progress_ms: Math.min(progress(), state.current.duration_ms),
          item: state.current,
          shuffle_state: state.shuffle,
          repeat_state: state.repeat,
        })
      case 'GET /v1/me/player/queue':
        return json(200, { currently_playing: state.current, queue: state.queue })
      case 'PUT /v1/me/player/play': {
        const data = body ? JSON.parse(body) : {}
        if (data.uris) load(TRACKS.find((t) => t.uri === data.uris[0]) ?? TRACKS[0])
        else if (data.context_uri) load(TRACKS[0])
        else setPlaying(true)
        return json(204)
      }
      case 'PUT /v1/me/player/pause':
        setPlaying(false)
        return json(204)
      case 'POST /v1/me/player/next': {
        const next = state.queue.shift() ?? TRACKS[(TRACKS.indexOf(state.current) + 1) % TRACKS.length]
        load(next)
        return json(204)
      }
      case 'POST /v1/me/player/previous':
        load(TRACKS[Math.max(0, TRACKS.indexOf(state.current) - 1)])
        return json(204)
      case 'PUT /v1/me/player/seek':
        state.progress = Number(url.searchParams.get('position_ms'))
        state.at = Date.now()
        return json(204)
      case 'PUT /v1/me/player/shuffle':
        state.shuffle = url.searchParams.get('state') === 'true'
        return json(204)
      case 'PUT /v1/me/player/repeat':
        state.repeat = url.searchParams.get('state')
        return json(204)
      case 'POST /v1/me/player/queue': {
        const item = TRACKS.find((t) => t.uri === url.searchParams.get('uri'))
        if (!item) return json(404, { error: { status: 404, message: 'Not found' } })
        state.queue.push(item)
        return json(200)
      }
      case 'GET /v1/search': {
        const q = fold(url.searchParams.get('q') ?? '')
        const match = (x) => fold(`${x.name} ${(x.artists ?? []).map((a) => a.name).join(' ')}`).includes(q)
        return json(200, {
          tracks: { items: TRACKS.filter(match) },
          // O Spotify às vezes manda playlist nula no meio da busca.
          playlists: { items: [null, ...[PLAYLIST].filter((p) => fold(p.name).includes(q) || q.length < 3)] },
          albums: { items: [ALBUM].filter(match) },
        })
      }
      case 'GET /v1/me/playlists':
        return json(200, { items: [MINE] })
      // ---------- O librespot de mentira ----------
      case 'POST /__fake/started':
        state.started = JSON.parse(body)
        return json(200, {})
      case 'POST /__fake/written':
        state.written = JSON.parse(body)
        return json(200, {})
      case 'GET /__fake/tone':
        // A esquerda muda com a música (440, 660, 880 Hz); a direita fica em 1500 Hz.
        return json(200, { playing: state.playing, left: 440 + 220 * Math.max(0, TRACKS.indexOf(state.current)), right: 1500 })
      default:
        return json(404, { error: { status: 404, message: `rota de mentira não existe: ${route}` } })
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    state,
    env: {
      RESENHA_SPOTIFY_ACCOUNTS: origin,
      RESENHA_SPOTIFY_API: `${origin}/v1`,
      RESENHA_SPOTIFY_BROWSER: 'fetch',
      RESENHA_LIBRESPOT: new URL('./fixtures/fake-librespot.mjs', import.meta.url).pathname,
    },
    close: () => server.close(),
  }
}
