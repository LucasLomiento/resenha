// Bot do Spotify na call (lado do processo principal).
//
// Quem põe o bot conecta a conta do Spotify (precisa de Premium) e o app roda o
// librespot, um cliente aberto do Spotify (pacote `librespot` do Arch), como o
// aparelho "Resenha" do Spotify Connect. O som dele sai cru num FIFO (PCM
// s16le, 44,1 kHz, estéreo) e vai pro renderer, que transforma numa faixa de
// áudio e manda pra quem está na call. O renderer pede o som aos poucos
// (`want`): o que ninguém pediu fica no FIFO e o librespot espera, então ele
// anda no ritmo em que toca (a posição que o Spotify mostra bate com o som).
// FIFO e não o stdout: o stdout de um filho do Node é um socket com ~200 KB de
// folga (~1 s de som a mais na frente, que tocaria depois de pular a música);
// o FIFO tem 64 KB. Ele fica aberto pra leitura e escrita aqui, então o
// librespot fechar e reabrir o lado dele (faz isso ao pausar) não vira "fim".
//
// São dois logins PKCE no navegador, feitos em seguida pelo "Conectar" (só os
// refresh tokens ficam guardados, criptografados como a sessão):
// - O app da própria pessoa (criado em developer.spotify.com, client ID colado
//   no painel): a Web API (tocar, pausar, pular, buscar, fila, playlists) vai
//   por ele, com uma cota só dela. Com o app de computador do Spotify a Web API
//   vive em 429 desde dezembro de 2025: a cota dele é dividida por todo mundo
//   que usa librespot no mundo.
// - O app de computador do Spotify (o "keymaster"): só pro librespot entrar na
//   conta. Desde 10/08/2026 o Spotify só aceita pro Spotify Connect o token
//   desse app pedido do jeito do app de verdade: retorno em
//   http://127.0.0.1:8898/login e só a permissão `streaming` (o exemplo
//   get_creds.rs do librespot, PR #1744). Do jeito antigo (porta 5588 e todas
//   as permissões, que o librespot 0.8.0 do Arch ainda usa no `--enable-oauth`),
//   ele entra mas cai logo em seguida com "could not initialize spirc: Login
//   request was denied: INVALID_CREDENTIALS".
//
// No e2e: RESENHA_LIBRESPOT (librespot de mentira), RESENHA_SPOTIFY_ACCOUNTS e
// RESENHA_SPOTIFY_API (Spotify de mentira) e RESENHA_SPOTIFY_BROWSER=fetch (o
// login segue os redirecionamentos sozinho, sem abrir o navegador).

import { app, safeStorage, shell, type WebContents } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { constants, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { Socket, type AddressInfo } from 'node:net'
import type { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { MusicError, MusicList, MusicOp, MusicPlayer, MusicReply, MusicSearch, MusicTrack, SpotifyStatus } from '../preload/api'
import { tm } from './i18n'
import { findTerminal, outside, run } from './updater'

const ACCOUNTS = process.env.RESENHA_SPOTIFY_ACCOUNTS || 'https://accounts.spotify.com'
const API = process.env.RESENHA_SPOTIFY_API || 'https://api.spotify.com/v1'
const fakeBrowser = process.env.RESENHA_SPOTIFY_BROWSER === 'fetch'
/** Nome do aparelho do bot no Spotify Connect (aparece no celular de quem pôs o bot). */
const DEVICE_NAME = 'Resenha'
/** O app de computador do Spotify: o login que o librespot aceita (a Web API dele não serve: vive em 429). */
const BUILTIN_CLIENT_ID = '65b708073fc0480ea92a077233ca87bd'
/** Só tocar: com mais permissões, o Spotify não deixa o librespot abrir o Spotify Connect (desde 08/2026). */
const BUILTIN_SCOPES = 'streaming'
/** O que o bot usa da Web API, no app da pessoa. */
const OWN_SCOPES = [
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ')
/** O retorno do app de computador de verdade: com outro (o 5588 do librespot 0.8.0), o token não serve pro Spotify Connect. */
const BUILTIN_PORT = 8898
/**
 * O que a pessoa cadastra no app dela. Com porta fixa: a doc do Spotify diz que dá pra
 * cadastrar sem porta, mas o painel deles recusa ("not secure").
 */
const OWN_PORT = 5589
const OWN_REDIRECT = `http://127.0.0.1:${OWN_PORT}/spotify`
/** Client ID de app do Spotify: 32 letras e números. */
const CLIENT_ID = /^[0-9a-fA-F]{32}$/
/** Um quadro do PCM do librespot: 2 canais de 16 bits. */
const FRAME = 4
/** Mais que isso pedido de uma vez é engano: o librespot dispararia na frente do som (2 s). */
const MAX_WANT = 44_100 * FRAME * 2
const URI = /^spotify:(track|album|playlist|artist|episode|show):[A-Za-z0-9]{1,40}$/

class SpotifyError extends Error {
  constructor(readonly code: MusicError) {
    super(code)
  }
}

const codeOf = (err: unknown): MusicError => (err instanceof SpotifyError ? err.code : 'failed')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- Conta (refresh token guardado) ----------

interface Account {
  /** Id e nome da pessoa no Spotify. */
  id: string
  name: string
  /** O app da pessoa no Spotify: a Web API vai por ele. */
  clientId: string
  refresh: string
  /** Refresh token do login do app de computador do Spotify, só pro librespot entrar (null: falta fazer). */
  desktop: string | null
}

const dir = () => join(app.getPath('userData'), 'spotify')
const accountFile = () => join(dir(), 'account.json')
/** Credencial do librespot (o "system cache" dele). */
const cacheDir = () => join(dir(), 'librespot')

let account: Account | null | undefined
/** Token da Web API (app da pessoa). */
let access: { token: string; until: number } | null = null

function loadAccount(): Account | null {
  if (account !== undefined) return account
  account = null
  try {
    const saved = JSON.parse(readFileSync(accountFile(), 'utf8')) as { encrypted: boolean; data: string }
    const raw = Buffer.from(saved.data, 'base64')
    const parsed = JSON.parse(saved.encrypted ? safeStorage.decryptString(raw) : raw.toString('utf8')) as Record<string, unknown>
    // A 1.11.1 guardava o login do app de computador como se fosse da Web API: esse não serve mais.
    if (parsed.clientId !== BUILTIN_CLIENT_ID && ('desktop' in parsed || 'player' in parsed)) {
      // A 1.11.2 fazia o login do app de computador do jeito antigo: o token e a credencial
      // que o librespot guardou com ele não abrem o Spotify Connect. Refaz na próxima vez.
      if (!('desktop' in parsed)) rmSync(join(cacheDir(), 'credentials.json'), { force: true })
      const { player: _, ...rest } = parsed
      account = { ...(rest as unknown as Account), desktop: typeof parsed.desktop === 'string' ? parsed.desktop : null }
    }
  } catch {
    // sem conta (ou o chaveiro mudou): conecta de novo
  }
  return account
}

function saveAccount(value: Account | null) {
  account = value
  if (!value) return rmSync(accountFile(), { force: true })
  const encrypted = safeStorage.isEncryptionAvailable()
  const raw = encrypted ? safeStorage.encryptString(JSON.stringify(value)) : Buffer.from(JSON.stringify(value))
  mkdirSync(dir(), { recursive: true })
  writeFileSync(accountFile(), JSON.stringify({ encrypted, data: raw.toString('base64') }), { mode: 0o600 })
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
}

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  let res: Response
  try {
    res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new SpotifyError('network')
  }
  const data = (await res.json().catch(() => null)) as (TokenResponse & { error?: string }) | null
  if (!res.ok || !data?.access_token) throw new SpotifyError(res.status === 400 || res.status === 401 ? 'auth' : 'failed')
  return data
}

/** Uma renovação por vez: o refresh token pode trocar a cada uso, e duas juntas derrubariam a conta. */
let refreshing: Promise<string> | null = null

function accessToken(): Promise<string> {
  if (access && Date.now() < access.until) return Promise.resolve(access.token)
  refreshing ??= refresh().finally(() => (refreshing = null))
  return refreshing
}

async function refresh(): Promise<string> {
  const saved = loadAccount()
  if (!saved) throw new SpotifyError('not-connected')
  try {
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refresh, client_id: saved.clientId })
    access = { token: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 }
    // O Spotify às vezes troca o refresh token: o antigo para de valer.
    if (data.refresh_token && data.refresh_token !== saved.refresh) saveAccount({ ...saved, refresh: data.refresh_token })
    return access.token
  } catch (err) {
    // Acesso revogado (ou o app do Spotify mudou): precisa conectar de novo.
    if (codeOf(err) === 'auth') saveAccount(null)
    throw err
  }
}

/** Token do app de computador, pro librespot entrar na conta (null: falta o login dele, ou não vale mais). */
async function desktopToken(): Promise<string | null> {
  const saved = loadAccount()
  if (!saved?.desktop) return null
  try {
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.desktop, client_id: BUILTIN_CLIENT_ID })
    if (data.refresh_token && data.refresh_token !== saved.desktop) saveAccount({ ...saved, desktop: data.refresh_token })
    return data.access_token
  } catch (err) {
    if (codeOf(err) === 'auth') saveAccount({ ...saved, desktop: null })
    return null
  }
}

/** Login do app de computador no navegador, na hora de ligar o bot (faltava, ou o Spotify recusou o que tinha). */
async function desktopLogin(): Promise<string> {
  if (target && !target.isDestroyed()) target.send('spotify:browser', null)
  const tokens = await authorize(null)
  const saved = loadAccount()
  if (saved) saveAccount({ ...saved, desktop: tokens.refresh_token ?? null })
  return tokens.access_token
}

// ---------- Login (PKCE, com o navegador voltando pro 127.0.0.1) ----------

let pendingLogin: Server | null = null

function page(text: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Resenha</title><body style="font:16px system-ui;background:#0d0e12;color:#e8e8ee;display:grid;place-items:center;height:90vh"><p>${text}</p>`
}

/** e2e: segue os redirecionamentos do Spotify de mentira até o 127.0.0.1 (no lugar do navegador). */
async function followRedirects(url: string) {
  let next = url
  for (let i = 0; i < 5; i++) {
    const res = await fetch(next, { redirect: 'manual' }).catch(() => null)
    const location = res?.headers.get('location')
    if (!location) return
    next = new URL(location, next).toString()
  }
}

/** Login no navegador: com o app da pessoa (Web API) ou, com null, com o app de computador do Spotify (pro librespot). */
function authorize(ownClientId: string | null): Promise<TokenResponse> {
  pendingLogin?.close()
  const clientId = ownClientId ?? BUILTIN_CLIENT_ID
  const path = ownClientId ? '/spotify' : '/login'
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')
  return new Promise((resolve, reject) => {
    let redirect = ''
    let settled = false
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== path || url.searchParams.get('state') !== state) {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(page(code ? tm().spotify.connected : tm().spotify.failed))
      if (!code) return finish(new SpotifyError('auth'))
      finish(null)
      tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier }).then(
        resolve,
        reject,
      )
    })
    pendingLogin = server
    const timer = setTimeout(() => finish(new SpotifyError('timeout')), 5 * 60_000)
    const finish = (err: Error | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      if (pendingLogin === server) pendingLogin = null
      if (err) reject(err)
    }
    server.on('close', () => finish(new SpotifyError('timeout')))
    const opened = () => {
      redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`
      const url = `${ACCOUNTS}/authorize?${new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirect,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state,
        scope: ownClientId ? OWN_SCOPES : BUILTIN_SCOPES,
      })}`
      if (fakeBrowser) void followRedirects(url)
      else void shell.openExternal(url)
    }
    // As duas portas são fixas (a cadastrada no app da pessoa e a do app de computador):
    // ocupada, não tem jeito, o Spotify só volta pra ela.
    server.on('error', () => finish(new SpotifyError('port')))
    server.listen(ownClientId ? OWN_PORT : BUILTIN_PORT, '127.0.0.1', opened)
  })
}

/**
 * Conecta a conta: primeiro com o app da pessoa (Web API), depois com o app de
 * computador do Spotify (pro librespot). Duas confirmações no navegador, uma vez só.
 */
export async function spotifyConnect(clientId: unknown): Promise<{ ok: true; name: string } | { ok: false; error: MusicError }> {
  if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId.trim())) return { ok: false, error: 'client-id' }
  const own = clientId.trim().toLowerCase()
  try {
    const tokens = await authorize(own)
    if (!tokens.refresh_token) throw new SpotifyError('auth')
    access = { token: tokens.access_token, until: Date.now() + (tokens.expires_in - 60) * 1000 }
    const me = (await api('GET', '/me', undefined, undefined, false)) as { id?: string; display_name?: string } | null
    if (!me?.id) throw new SpotifyError('auth')
    const before = loadAccount()
    // Outra conta: a credencial que o librespot guardou é da anterior.
    const sameAccount = before?.id === me.id
    if (before && !sameAccount) await spotifyStop().then(() => rmSync(cacheDir(), { recursive: true, force: true }))
    const name = me.display_name || me.id
    // O login do app de computador (pro librespot) só falta na primeira vez (ou se a conta mudou).
    let desktop = sameAccount ? (before?.desktop ?? null) : null
    if (!desktop) desktop = (await authorize(null)).refresh_token ?? null
    saveAccount({ id: me.id, name, clientId: own, refresh: tokens.refresh_token, desktop })
    return { ok: true, name }
  } catch (err) {
    access = null
    return { ok: false, error: codeOf(err) }
  }
}

export async function spotifyDisconnect() {
  await spotifyStop()
  pendingLogin?.close()
  saveAccount(null)
  access = null
  rmSync(cacheDir(), { recursive: true, force: true })
}

// ---------- Web API ----------

type Query = Record<string, string | number | boolean | undefined>

/** O Spotify mandou esperar (429 com Retry-After): até lá, nenhum pedido sai (insistir só aumenta a espera). */
let blockedUntil = 0

async function api(method: string, path: string, query?: Query, body?: unknown, retry = true): Promise<unknown> {
  if (Date.now() < blockedUntil) throw new SpotifyError('rate')
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) params.set(key, String(value))
  const url = `${API}${path}${params.size ? `?${params}` : ''}`
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken()
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new SpotifyError('network')
    }
    if (res.status === 401 && attempt === 0 && retry) {
      access = null
      continue
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after'))
      blockedUntil = Date.now() + Math.min(Number.isFinite(wait) && wait > 0 ? wait : 5, 3600) * 1000
      throw new SpotifyError('rate')
    }
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      // resposta vazia ou só texto (os comandos do player às vezes devolvem um id)
    }
    if (res.ok) return data
    const error = (data as { error?: { message?: string; reason?: string } } | null)?.error
    const message = `${error?.reason ?? ''} ${error?.message ?? ''}`
    if (/PREMIUM_REQUIRED|premium/i.test(message)) throw new SpotifyError('premium')
    // App do Spotify em modo de desenvolvimento: só as contas liberadas pelo dono entram.
    if (/not registered|developer dashboard/i.test(message)) throw new SpotifyError('allowlist')
    if (/NO_ACTIVE_DEVICE/i.test(message) || res.status === 404) throw new SpotifyError('no-device')
    if (res.status === 401 || res.status === 403) throw new SpotifyError('auth')
    throw new SpotifyError('failed')
  }
}

type Json = Record<string, unknown>
const obj = (value: unknown): Json | null => (value && typeof value === 'object' ? (value as Json) : null)
const str = (value: unknown, max = 300): string => (typeof value === 'string' ? value.slice(0, max) : '')
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const names = (value: unknown): string =>
  list(value)
    .map((a) => str(obj(a)?.name, 100))
    .filter(Boolean)
    .join(', ')

/** A capa de ~300 px (o Spotify manda da maior pra menor; as de playlist às vezes sem tamanho). */
function cover(images: unknown): string | null {
  const all = list(images)
    .map(obj)
    .filter((i): i is Json => !!i && /^https:\/\//.test(str(i.url, 500)))
    .sort((a, b) => Number(a.width ?? 0) - Number(b.width ?? 0))
  return str((all.find((i) => Number(i.width ?? 0) >= 250) ?? all.at(-1))?.url, 500) || null
}

function toTrack(value: unknown): MusicTrack | null {
  const item = obj(value)
  const uri = str(item?.uri, 100)
  if (!item || !URI.test(uri)) return null
  const album = obj(item.album)
  const show = obj(item.show)
  const artistId = str(obj(list(item.artists)[0])?.id, 40)
  return {
    uri,
    title: str(item.name),
    artists: names(item.artists) || str(show?.publisher),
    album: str(album?.name ?? show?.name),
    cover: cover(album?.images ?? item.images),
    durationMs: Math.max(0, Number(item.duration_ms) || 0),
    artistId: ARTIST_ID.test(artistId) ? artistId : null,
    genres: [],
  }
}

// ---------- Estilos (o Spotify guarda o estilo no artista, não na música) ----------

const ARTIST_ID = /^[A-Za-z0-9]{1,40}$/
/** artista -> estilos. O campo está descontinuado no Spotify: muito artista (os novos, principalmente) vem sem. */
const genreCache = new Map<string, string[]>()

/**
 * Põe o estilo do artista principal em cada música. Busca no máximo `budget` artistas
 * que ainda não conhece (um pedido por artista: o de vários de uma vez saiu do modo de
 * desenvolvimento), três por vez; o resto fica com o que já sabe.
 */
async function withGenres(tracks: MusicTrack[], budget: number): Promise<MusicTrack[]> {
  const missing = [...new Set(tracks.map((t) => t.artistId).filter((id): id is string => !!id && !genreCache.has(id)))].slice(0, budget)
  if (genreCache.size > 2000) genreCache.clear()
  for (let i = 0; i < missing.length; i += 3) {
    const batch = missing.slice(i, i + 3)
    const results = await Promise.allSettled(batch.map((id) => api('GET', `/artists/${id}`)))
    let limited = false
    results.forEach((result, j) => {
      if (result.status === 'fulfilled') {
        genreCache.set(batch[j], list(obj(result.value)?.genres).map((g) => str(g, 40)).filter(Boolean).slice(0, 3))
      } else if (codeOf(result.reason) === 'rate') limited = true
      else genreCache.set(batch[j], [])
    })
    // Muitos pedidos: o estilo fica pra depois (a música aparece sem a tag).
    if (limited) break
  }
  return tracks.map((t) => (t.artistId && genreCache.get(t.artistId)?.length ? { ...t, genres: genreCache.get(t.artistId)! } : t))
}

/** "genre:rock" ou genre:"funk carioca": busca de músicas por estilo. */
const GENRE_QUERY = /^genre:\s*"?([^"]{1,60})"?\s*$/i

function toList(value: unknown): MusicList | null {
  const item = obj(value)
  const uri = str(item?.uri, 100)
  if (!item || !URI.test(uri)) return null
  const kind = item.type === 'album' ? 'album' : item.type === 'playlist' ? 'playlist' : null
  if (!kind) return null
  const by = kind === 'album' ? names(item.artists) : str(obj(item.owner)?.display_name)
  return { uri, kind, title: str(item.name), by, cover: cover(item.images) }
}

function toPlayer(value: unknown): MusicPlayer {
  const data = obj(value)
  const device = obj(data?.device)
  const repeat = data?.repeat_state
  return {
    track: toTrack(data?.item),
    playing: data?.is_playing === true,
    progressMs: Math.max(0, Number(data?.progress_ms) || 0),
    at: Date.now(),
    shuffle: data?.shuffle_state === true,
    repeat: repeat === 'context' || repeat === 'track' ? repeat : 'off',
    elsewhere: device && device.id !== deviceId ? str(device.name, 100) || '?' : null,
  }
}

const items = (page: unknown) => list(obj(page)?.items)

async function perform(op: MusicOp): Promise<unknown> {
  const device = deviceId ?? undefined
  switch (op.op) {
    case 'player': {
      const player = toPlayer(await api('GET', '/me/player'))
      if (player.track) [player.track] = await withGenres([player.track], 1)
      return player
    }
    case 'queue': {
      // Só o estilo que já conhece (a fila é lida toda hora; não vale um pedido por artista).
      const queue = list(obj(await api('GET', '/me/player/queue'))?.queue)
        .map(toTrack)
        .filter((t): t is MusicTrack => !!t)
        .slice(0, 20)
      return withGenres(queue, 0)
    }
    case 'search': {
      const q = str(op.q, 200).trim()
      if (!q) return { tracks: [], lists: [] } satisfies MusicSearch
      const offset = clampOffset(op.offset)
      const genre = q.match(GENRE_QUERY)?.[1]?.trim()
      let tracks: MusicTrack[]
      let lists: MusicList[]
      if (genre) {
        // Por estilo: o filtro do Spotify só vale pra músicas; playlists vão pelo nome do estilo.
        const [byGenre, named] = await Promise.all([
          api('GET', '/search', { q: `genre:"${genre}"`, type: 'track', limit: 10, offset }),
          api('GET', '/search', { q: genre, type: 'playlist', limit: 10, offset }),
        ])
        tracks = items(obj(byGenre)?.tracks).map(toTrack).filter((t): t is MusicTrack => !!t)
        lists = items(obj(named)?.playlists).map(toList).filter((l): l is MusicList => !!l)
      } else {
        // App em modo de desenvolvimento: no máximo 10 por tipo.
        const data = obj(await api('GET', '/search', { q, type: 'track,playlist,album', limit: 10, offset }))
        tracks = items(data?.tracks).map(toTrack).filter((t): t is MusicTrack => !!t)
        lists = [...items(data?.playlists), ...items(data?.albums)].map(toList).filter((l): l is MusicList => !!l)
      }
      return { tracks: await withGenres(tracks, 6), lists } satisfies MusicSearch
    }
    case 'playlists':
      return items(await api('GET', '/me/playlists', { limit: 30, offset: clampOffset(op.offset) }))
        .map(toList)
        .filter(Boolean)
    case 'play': {
      if (!URI.test(op.uri)) throw new SpotifyError('failed')
      // Música sozinha: toca ela (e o Spotify segue com parecidas); álbum/playlist/artista: a lista toda.
      const body = /^spotify:(track|episode):/.test(op.uri) ? { uris: [op.uri] } : { context_uri: op.uri }
      return api('PUT', '/me/player/play', { device_id: device }, body)
    }
    case 'resume':
      return api('PUT', '/me/player/play', { device_id: device })
    case 'pause':
      return api('PUT', '/me/player/pause', { device_id: device })
    case 'next':
      return api('POST', '/me/player/next', { device_id: device })
    case 'previous':
      return api('POST', '/me/player/previous', { device_id: device })
    case 'seek':
      return api('PUT', '/me/player/seek', { position_ms: Math.max(0, Math.round(Number(op.ms) || 0)), device_id: device })
    case 'shuffle':
      return api('PUT', '/me/player/shuffle', { state: op.on === true, device_id: device })
    case 'repeat':
      return api('PUT', '/me/player/repeat', { state: ['off', 'context', 'track'].includes(op.mode) ? op.mode : 'off', device_id: device })
    case 'enqueue':
      if (!/^spotify:(track|episode):/.test(op.uri) || !URI.test(op.uri)) throw new SpotifyError('failed')
      return api('POST', '/me/player/queue', { uri: op.uri, device_id: device })
    case 'transfer':
      if (!deviceId) throw new SpotifyError('off')
      return api('PUT', '/me/player', undefined, { device_ids: [deviceId], play: true })
    default:
      throw new SpotifyError('failed')
  }
}

const clampOffset = (offset: unknown) => Math.max(0, Math.min(990, Math.floor(Number(offset) || 0)))

export async function spotifyRequest(op: unknown): Promise<MusicReply> {
  if (!op || typeof op !== 'object' || typeof (op as MusicOp).op !== 'string') return { ok: false, error: 'failed' }
  try {
    return { ok: true, data: (await perform(op as MusicOp)) ?? null }
  } catch (err) {
    return { ok: false, error: codeOf(err) }
  }
}

// ---------- librespot (o aparelho "Resenha" e o som) ----------

/** O librespot subindo (ou o que está tocando). */
let child: ChildProcess | null = null
/** O librespot que entrou na conta e está tocando agora. */
let running: ChildProcess | null = null
let deviceId: string | null = null
let target: WebContents | null = null
/** Bytes de som que o renderer pediu e ainda não foram. */
let wanted = 0
/**
 * Por onde o som chega, lido sem bloquear (pelo laço de eventos). No Linux, um FIFO por vez
 * que o bot liga; no Windows, o stdout do librespot (`path` null).
 */
let pcm: { stream: Readable; path: string | null } | null = null
/**
 * Windows: o som vem pelo stdout do librespot. Lá o stdout de um filho é um pipe de 64 KB (no
 * Linux é um socket com ~200 KB de folga, por isso o FIFO), e não tem FIFO nem garantia de que o
 * librespot abre um named pipe (ele abre a saída com "criar e truncar"). RESENHA_SPOTIFY_STDOUT=1
 * força esse caminho no Linux, pro teste passar por ele.
 */
const viaStdout = process.platform === 'win32' || process.env.RESENHA_SPOTIFY_STDOUT === '1'
/**
 * Cada `spotifyStop` passa pra próxima: o que estava ligando confere depois de
 * cada espera e desiste se mudou (sair da call no meio não deixa librespot sobrando).
 */
let generation = 0
/** Ligar espera o anterior terminar (um de cada vez). */
let queue: Promise<unknown> = Promise.resolve()
/** Por que o último librespot saiu antes da hora (conta grátis, por exemplo). */
let lastFailure: MusicError | null = null
/** O bot terminou de ligar (daí em diante, o librespot cair é avisado pro app). */
let live = false

/** Pra onde vai o som (a janela do app). */
export function setSpotifyTarget(contents: WebContents) {
  target = contents
}

function librespotPath(): string | null {
  const custom = process.env.RESENHA_LIBRESPOT
  if (custom) return existsSync(custom) ? custom : null
  // No Windows ele vai dentro do pacote (compilado no build do GitHub: não tem versão pronta).
  const bundled = app.isPackaged && process.platform === 'win32' ? join(process.resourcesPath, 'librespot.exe') : null
  if (bundled && existsSync(bundled)) return bundled
  const name = process.platform === 'win32' ? 'librespot.exe' : 'librespot'
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    if (folder && existsSync(join(folder, name))) return join(folder, name)
  }
  return null
}

const installable = () => process.platform === 'linux' && existsSync('/usr/bin/pacman')

/** Dá pra pôr o Spotify na call neste sistema: no Linux (o librespot vem do pacote do sistema) ou com ele embutido (Windows). */
export function spotifySupported(): boolean {
  return process.platform === 'linux' || !!librespotPath()
}

/**
 * Abre o FIFO do som desta vez que o bot liga. Leitura e escrita: sem isso, o librespot pausar
 * (fecha o lado dele) seria "fim". No Windows não tem FIFO: null (o som vem pelo stdout).
 */
function openPcm(): string | null {
  if (viaStdout) return null
  if (pcm?.path && !pcm.stream.destroyed) return pcm.path
  const path = join(process.env.XDG_RUNTIME_DIR || tmpdir(), `resenha-spotify-${process.pid}-${generation}.pcm`)
  rmSync(path, { force: true })
  if (spawnSync('mkfifo', ['-m', '600', path]).status !== 0) throw new SpotifyError('failed')
  const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK)
  // Pouca folga aqui também: o que fica guardado é o quanto o librespot anda na frente do som
  // (o net.Socket repassa as opções pro Duplex, mas os tipos não conhecem esta).
  const options = { fd, readable: true, writable: false, readableHighWaterMark: 16 * 1024 }
  const socket = new Socket(options)
  socket.on('readable', pump)
  socket.on('error', (err) => console.warn('spotify: o som parou de chegar', err.message))
  pcm = { stream: socket, path }
  return path
}

function closePcm(which: typeof pcm) {
  if (!which) return
  which.stream.destroy()
  if (which.path) rmSync(which.path, { force: true })
  if (pcm === which) pcm = null
}

function args(extra: string[]): string[] {
  return [
    '--name', DEVICE_NAME,
    '--device-type', 'speaker',
    '--backend', 'pipe',
    '--format', 'S16',
    '--bitrate', '320',
    // Volume fixo no máximo: cada um da call acerta o dele no app.
    '--initial-volume', '100',
    '--volume-ctrl', 'fixed',
    '--enable-volume-normalisation',
    '--disable-discovery',
    '--system-cache', cacheDir(),
    ...extra,
  ]
}

/** Conta grátis: o librespot entra e sai logo depois ("does not support Free accounts"). */
const FREE_ACCOUNT = /does not support .*accounts|premium/i

/**
 * Depois de entrar, o librespot abre o Spotify Connect e avisa ("librespot_connect::spirc] active
 * device is ..."); se o Spotify recusar, é logo em seguida. Sem aviso nenhum, vale depois de 3 s.
 */
const CONNECT_GRACE = 3000

/**
 * Sobe o librespot e espera ele entrar na conta e abrir o Spotify Connect.
 * `true`: pronto (o som vem pelo FIFO); `false`: a credencial não vale (outra
 * pode valer). `token`: entra com ele (vai pelo ambiente, que só a própria
 * pessoa lê; a linha de comando todo mundo vê).
 */
function launch(bin: string, token: string | null): Promise<boolean> {
  return new Promise((resolve, reject) => {
    mkdirSync(cacheDir(), { recursive: true })
    let fifo: string | null
    try {
      fifo = openPcm()
    } catch (err) {
      return reject(err)
    }
    const env = { ...process.env, ...(token ? { LIBRESPOT_ACCESS_TOKEN: token } : {}) }
    if (!token) delete env.LIBRESPOT_ACCESS_TOKEN
    // Sem --device, o librespot escreve o som no stdout (Windows). windowsHide: sem a janela preta do console.
    const proc = spawn(bin, [...args([]), ...(fifo ? ['--device', fifo] : [])], {
      stdio: ['ignore', fifo ? 'ignore' : 'pipe', 'pipe'],
      env,
      windowsHide: true,
    })
    if (!fifo) {
      const out = proc.stdout!
      out.on('readable', pump)
      out.on('error', (err) => console.warn('spotify: o som parou de chegar', err.message))
      pcm = { stream: out, path: null }
    }
    const born = generation
    child = proc
    let log = ''
    let settled = false
    let failure: MusicError | null = null
    let ready: ReturnType<typeof setTimeout> | null = null
    const settle = (ok: boolean, err?: SpotifyError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (ready) clearTimeout(ready)
      if (err) reject(err)
      else resolve(ok)
    }
    // Não ficou pronto nem disse por quê: desiste deste jeito (o próximo é outro).
    const giveUp = () => {
      proc.kill('SIGKILL')
      settle(false)
    }
    const timer = setTimeout(giveUp, 20_000)
    proc.stderr!.setEncoding('utf8')
    proc.stderr!.on('data', (text: string) => {
      log = (log + text).slice(-8000)
      if (FREE_ACCOUNT.test(text) && /error|fail|support|required/i.test(text)) {
        failure = 'premium'
        proc.kill('SIGKILL')
        settle(false, new SpotifyError('premium'))
      } else if (/could not initialize spirc/i.test(text)) {
        // Entrou, mas o Spotify não deixou abrir o Spotify Connect: credencial do jeito antigo
        // (outra pode valer) ou o Spotify fora do ar pra clientes como o librespot (503).
        const outage = /503|service unavailable/i.test(text)
        failure = outage ? 'unavailable' : 'failed'
        proc.kill('SIGKILL')
        if (outage) settle(false, new SpotifyError('unavailable'))
        else settle(false)
      } else if (/librespot_connect::spirc/i.test(text)) {
        settle(true)
      } else if (/Authenticated as/i.test(text)) {
        ready ??= setTimeout(() => settle(true), CONNECT_GRACE)
      }
      // Credencial recusada: alguns librespot ficam tentando de novo em vez de sair.
      else if (!settled && /bad ?credentials|login failed|permission ?denied/i.test(text)) giveUp()
    })
    proc.on('error', () => settle(false, new SpotifyError('missing')))
    proc.on('exit', (code, signal) => {
      if (child === proc) child = null
      if (!settled) {
        console.warn(`spotify: librespot saiu antes de ficar pronto (${code ?? signal})\n${log.slice(-1500)}`)
        return settle(false)
      }
      // Desligado de propósito (o `spotifyStop` já limpou tudo).
      if (born !== generation) return
      const why = failure ?? (FREE_ACCOUNT.test(log) ? 'premium' : 'failed')
      console.warn(`spotify: librespot parou (${code ?? signal})\n${log.slice(-1500)}`)
      if (proc === running) {
        running = null
        deviceId = null
        wanted = 0
        closePcm(pcm)
      }
      // Ainda ligando: o `start` vê e conta o motivo. Já ligado: avisa o app (o bot some da call).
      if (!live) lastFailure = why
      else if (target && !target.isDestroyed()) {
        live = false
        target.send('spotify:stopped', why)
      }
    })
  })
}

async function findDevice(gen: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const devices = list(obj(await api('GET', '/me/player/devices'))?.devices).map(obj)
    check(gen)
    const device = devices.find((d) => d?.name === DEVICE_NAME && typeof d.id === 'string')
    if (device) return device.id as string
    await sleep(500)
    check(gen)
  }
  throw new SpotifyError('no-device')
}

/** Desligaram (ou o librespot caiu) no meio da subida: para aqui. */
function check(gen: number) {
  if (gen !== generation) throw new SpotifyError('off')
  if (!running) throw new SpotifyError(lastFailure ?? 'login')
}

async function start(gen: number): Promise<{ ok: true } | { ok: false; error: MusicError }> {
  if (gen !== generation) return { ok: false, error: 'off' }
  if (running && deviceId) return { ok: true }
  const bin = librespotPath()
  if (!bin) return { ok: false, error: 'missing' }
  if (!loadAccount()) return { ok: false, error: 'not-connected' }
  lastFailure = null
  const stale = () => {
    if (gen !== generation) throw new SpotifyError('off')
  }
  try {
    const credentials = join(cacheDir(), 'credentials.json')
    let ok = existsSync(credentials) && (await launch(bin, null))
    stale()
    if (!ok) {
      // Sem credencial guardada (ou o Spotify não aceita mais): entra com o login do app de computador.
      rmSync(credentials, { force: true })
      const token = await desktopToken()
      stale()
      if (token) ok = await launch(bin, token)
      stale()
    }
    if (!ok) {
      // Faltava esse login (ou o que tinha não serve mais): pede de novo no navegador, uma vez só.
      rmSync(credentials, { force: true })
      const token = await desktopLogin()
      stale()
      ok = await launch(bin, token)
      stale()
    }
    if (!ok || !child) throw new SpotifyError(lastFailure ?? 'login')
    running = child
    deviceId = await findDevice(gen)
    // Traz pro bot o que estiver tocando (sem dar play: quem decide é quem está na call).
    await api('PUT', '/me/player', undefined, { device_ids: [deviceId], play: false }).catch(() => {})
    check(gen)
    live = true
    return { ok: true }
  } catch (err) {
    // Desligaram no meio: quem desligou já limpou (e pode já estar ligando de novo).
    if (gen === generation) await spotifyStop()
    return { ok: false, error: codeOf(err) }
  }
}

export function spotifyStart(): Promise<{ ok: true } | { ok: false; error: MusicError }> {
  const next = queue.then(() => start(generation))
  queue = next.catch(() => {})
  return next
}

export async function spotifyStop() {
  generation++
  live = false
  const proc = child
  const device = deviceId
  const fifo = pcm
  pendingLogin?.close()
  child = running = null
  deviceId = null
  pcm = null
  wanted = 0
  if (!proc) return closePcm(fifo)
  // Pausa antes de fechar: senão o celular de quem pôs o bot ainda mostra "tocando no Resenha" por um tempo.
  if (device) await api('PUT', '/me/player/pause', { device_id: device }).catch(() => {})
  proc.kill('SIGTERM')
  setTimeout(() => proc.exitCode === null && proc.kill('SIGKILL'), 3000).unref()
  closePcm(fifo)
}

/** O app está fechando: mata o librespot na hora (sem esperar a pausa pela Web API). */
export function spotifyKill() {
  generation++
  live = false
  for (const proc of [child, running]) proc?.kill('SIGTERM')
  child = running = null
  deviceId = null
  closePcm(pcm)
}

/** Manda pro renderer o som que ele pediu, só o que já chegou (o resto espera no FIFO, ou no pipe do stdout). */
function pump() {
  const out = pcm?.stream
  if (!out || !running || !target || target.isDestroyed()) return
  while (wanted >= FRAME) {
    const available = out.readableLength - (out.readableLength % FRAME)
    if (available < FRAME) {
      out.read(0)
      return
    }
    const chunk = out.read(Math.min(available, wanted - (wanted % FRAME))) as Buffer | null
    if (!chunk) return
    wanted -= chunk.length
    target.send('spotify:pcm', chunk)
  }
}

export function spotifyWant(bytes: unknown) {
  const n = Math.floor(Number(bytes))
  if (!Number.isFinite(n) || n <= 0) return
  wanted = Math.min(MAX_WANT, wanted + n)
  pump()
}

/** Trocou de música: o que estava esperando no meio do caminho é da anterior (joga fora só quadros inteiros). */
export function spotifyFlush() {
  const out = pcm?.stream
  if (!out) return
  const whole = out.readableLength - (out.readableLength % FRAME)
  if (whole > 0) out.read(whole)
}

export function spotifyStatus(): SpotifyStatus {
  const saved = loadAccount()
  return {
    librespot: !!librespotPath(),
    installable: installable(),
    account: saved ? { name: saved.name, clientId: saved.clientId } : null,
    ownRedirect: OWN_REDIRECT,
    running: live,
  }
}

/** Instala o librespot pelo pacman (pkexec; sem agente do polkit, num terminal com sudo). */
export async function installLibrespot(): Promise<boolean> {
  if (librespotPath()) return true
  if (!installable()) return false
  const code = await run(...outside(['pkexec', 'pacman', '-S', '--needed', '--noconfirm', 'librespot'], { wait: true }))
  if (code === 0) return !!librespotPath()
  // 126 = a pessoa cancelou a senha.
  if (code === 126) return false
  const t = tm().spotify
  const terminal = findTerminal(t.installTitle)
  if (!terminal) return false
  const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`
  const script = [
    `echo ${quote(t.installPrompt)}`,
    `if sudo pacman -S --needed librespot; then echo; echo ${quote(t.installDone)}; sleep 2; else echo; echo ${quote(t.installFailed)}; read -r _; fi`,
  ].join('; ')
  await run(...outside([terminal.command, ...terminal.args, 'bash', '-c', script], { wait: true }))
  return !!librespotPath()
}
