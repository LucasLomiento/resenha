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
// - O app de computador do Spotify (o "keymaster", o mesmo login que o
//   librespot faz sozinho): só pro librespot entrar na conta. O Spotify recusa
//   pro librespot o token de outros apps. Se esse login faltar, o librespot faz
//   o dele no navegador na primeira vez que o bot liga.
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
/** As permissões que o app de computador pede (as mesmas do librespot: algumas só existem pra ele). */
const BUILTIN_SCOPES = [
  'app-remote-control', 'playlist-modify', 'playlist-modify-private', 'playlist-modify-public', 'playlist-read',
  'playlist-read-collaborative', 'playlist-read-private', 'streaming', 'ugc-image-upload', 'user-follow-modify',
  'user-follow-read', 'user-library-modify', 'user-library-read', 'user-modify', 'user-modify-playback-state',
  'user-modify-private', 'user-personalized', 'user-read-birthdate', 'user-read-currently-playing', 'user-read-email',
  'user-read-play-history', 'user-read-playback-position', 'user-read-playback-state', 'user-read-private',
  'user-read-recently-played', 'user-top-read',
].join(' ')
/** O que o bot usa da Web API, no app da pessoa. */
const OWN_SCOPES = [
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ')
/** O redirect que o app de computador aceita (o do librespot); se a porta estiver ocupada, outra qualquer. */
const BUILTIN_PORT = 5588
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
  /** Refresh token do login do app de computador do Spotify: só pro librespot entrar (null: ele faz o login dele). */
  player: string | null
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
    const parsed = JSON.parse(saved.encrypted ? safeStorage.decryptString(raw) : raw.toString('utf8')) as Account & { own?: boolean }
    // A 1.11.1 guardava o login do app de computador como se fosse da Web API: esse não serve mais.
    if (parsed.clientId !== BUILTIN_CLIENT_ID && 'player' in parsed) account = parsed
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

/** Token do app de computador, pro librespot entrar na conta (null: sem esse login, ele faz o dele). */
async function playerToken(): Promise<string | null> {
  const saved = loadAccount()
  if (!saved?.player) return null
  try {
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.player, client_id: BUILTIN_CLIENT_ID })
    if (data.refresh_token && data.refresh_token !== saved.player) saveAccount({ ...saved, player: data.refresh_token })
    return data.access_token
  } catch (err) {
    if (codeOf(err) === 'auth') saveAccount({ ...saved, player: null })
    return null
  }
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
    // App de computador: a porta do librespot (5588), ou outra se estiver ocupada. App da pessoa:
    // a porta que ela cadastrou (ocupada, não tem jeito: o Spotify só volta pra ela).
    server.once('error', () => {
      server.on('error', () => finish(new SpotifyError('port')))
      if (ownClientId) finish(new SpotifyError('port'))
      else server.listen(0, '127.0.0.1', opened)
    })
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
    // O login do player só falta na primeira vez (ou se a conta mudou).
    let player = sameAccount ? (before?.player ?? null) : null
    if (!player && !existsSync(join(cacheDir(), 'credentials.json'))) player = (await authorize(null)).refresh_token ?? null
    saveAccount({ id: me.id, name, clientId: own, refresh: tokens.refresh_token, player })
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
  return {
    uri,
    title: str(item.name),
    artists: names(item.artists) || str(show?.publisher),
    album: str(album?.name ?? show?.name),
    cover: cover(album?.images ?? item.images),
    durationMs: Math.max(0, Number(item.duration_ms) || 0),
  }
}

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
    case 'player':
      return toPlayer(await api('GET', '/me/player'))
    case 'queue':
      return list(obj(await api('GET', '/me/player/queue'))?.queue)
        .map(toTrack)
        .filter(Boolean)
        .slice(0, 20)
    case 'search': {
      const q = str(op.q, 200).trim()
      if (!q) return { tracks: [], lists: [] } satisfies MusicSearch
      // App em modo de desenvolvimento: no máximo 10 por tipo.
      const data = obj(await api('GET', '/search', { q, type: 'track,playlist,album', limit: 10, offset: clampOffset(op.offset) }))
      return {
        tracks: items(data?.tracks).map(toTrack).filter((t): t is MusicTrack => !!t),
        lists: [...items(data?.playlists), ...items(data?.albums)].map(toList).filter((l): l is MusicList => !!l),
      } satisfies MusicSearch
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
/** O librespot fazendo o login dele no navegador (só na primeira vez, se o Spotify recusar o token). */
let loginProc: ChildProcess | null = null
let deviceId: string | null = null
let target: WebContents | null = null
/** Bytes de som que o renderer pediu e ainda não foram. */
let wanted = 0
/** O FIFO por onde o som chega (lido sem bloquear, pelo laço de eventos). Um por vez que o bot liga. */
let pcm: { socket: Socket; path: string } | null = null
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
  const name = process.platform === 'win32' ? 'librespot.exe' : 'librespot'
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    if (folder && existsSync(join(folder, name))) return join(folder, name)
  }
  return null
}

const installable = () => process.platform === 'linux' && existsSync('/usr/bin/pacman')

/** Abre o FIFO do som desta vez que o bot liga. Leitura e escrita: sem isso, o librespot pausar (fecha o lado dele) seria "fim". */
function openPcm(): string {
  if (pcm && !pcm.socket.destroyed) return pcm.path
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
  pcm = { socket, path }
  return path
}

function closePcm(which: typeof pcm) {
  if (!which) return
  which.socket.destroy()
  rmSync(which.path, { force: true })
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
 * Sobe o librespot e espera ele entrar na conta. `true`: entrou (o som já
 * vem pelo FIFO); `false`: saiu sem entrar (credencial que não vale).
 * `token`: entra com ele (vai pelo ambiente, que só a própria pessoa lê; a linha de comando todo mundo vê).
 */
function launch(bin: string, token: string | null): Promise<boolean> {
  return new Promise((resolve, reject) => {
    mkdirSync(cacheDir(), { recursive: true })
    let fifo: string
    try {
      fifo = openPcm()
    } catch (err) {
      return reject(err)
    }
    const env = { ...process.env, ...(token ? { LIBRESPOT_ACCESS_TOKEN: token } : {}) }
    if (!token) delete env.LIBRESPOT_ACCESS_TOKEN
    const proc = spawn(bin, [...args([]), '--device', fifo], { stdio: ['ignore', 'ignore', 'pipe'], env })
    const born = generation
    child = proc
    let log = ''
    let settled = false
    let failure: MusicError | null = null
    const settle = (ok: boolean, err?: SpotifyError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(ok)
    }
    // Não entrou nem disse por quê: desiste deste jeito (o próximo é outro).
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
      } else if (/Authenticated as/i.test(text)) settle(true)
      // Credencial recusada: alguns librespot ficam tentando de novo em vez de sair.
      else if (!settled && /bad ?credentials|login failed|permission ?denied/i.test(text)) giveUp()
    })
    proc.on('error', () => settle(false, new SpotifyError('missing')))
    proc.on('exit', (code, signal) => {
      if (child === proc) child = null
      if (!settled) {
        console.warn(`spotify: librespot saiu antes de entrar (${code ?? signal})\n${log.slice(-1500)}`)
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

/** O login do próprio librespot no navegador (quando o Spotify recusa o token do app do Resenha). Só na primeira vez. */
function librespotLogin(bin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(cacheDir(), { recursive: true })
    const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null'
    const proc = spawn(bin, [...args(['--enable-oauth']), '--device', devNull], { stdio: ['ignore', 'pipe', 'pipe'] })
    loginProc = proc
    const notify = (url: string | null) => target && !target.isDestroyed() && target.send('spotify:browser', url)
    notify(null)
    const timer = setTimeout(() => proc.kill('SIGKILL'), 5 * 60_000)
    let done = false
    proc.stderr!.setEncoding('utf8')
    proc.stderr!.on('data', (text: string) => {
      if (done || !/Authenticated as/i.test(text)) return
      done = true
      // Um respiro pra ele gravar a credencial antes de fechar (grava logo depois de avisar).
      setTimeout(() => proc.kill('SIGTERM'), 1500)
    })
    // Ele abre o navegador sozinho e também escreve o endereço: vai pro painel, caso o navegador não abra.
    proc.stdout!.setEncoding('utf8')
    proc.stdout!.on('data', (text: string) => {
      const url = text.match(/https:\/\/accounts\.spotify\.com\/\S+/)?.[0]
      if (url) notify(url)
    })
    proc.on('error', () => reject(new SpotifyError('missing')))
    proc.on('exit', () => {
      clearTimeout(timer)
      if (loginProc === proc) loginProc = null
      if (done) resolve()
      else reject(new SpotifyError('login'))
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
      // Sem credencial guardada (ou ela não vale mais): entra com o login do app de computador do Spotify.
      rmSync(credentials, { force: true })
      const token = await playerToken()
      stale()
      if (token) ok = await launch(bin, token)
      stale()
    }
    if (!ok) {
      // Sem esse login (ou o Spotify recusou): login do próprio librespot no navegador, uma vez só.
      await librespotLogin(bin)
      stale()
      ok = await launch(bin, null)
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
  loginProc?.kill('SIGKILL')
  child = running = loginProc = null
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
  for (const proc of [child, running, loginProc]) proc?.kill('SIGTERM')
  child = running = loginProc = null
  deviceId = null
  closePcm(pcm)
}

/** Manda pro renderer o som que ele pediu, só o que já chegou (o resto espera no FIFO). */
function pump() {
  const out = pcm?.socket
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
  const out = pcm?.socket
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
