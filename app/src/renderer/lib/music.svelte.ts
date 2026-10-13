// Bot do Spotify na call, do lado da página.
//
// Quem põe o bot: o processo principal roda o librespot (main/spotify.ts) e
// manda o som cru aos pedaços; aqui ele vira uma faixa (AudioWorklet num
// AudioContext de 44,1 kHz) que vai pra cada pessoa da call como uma faixa à
// parte ('music'), separada da voz, e cada um ouve no volume que quiser. Quem
// pôs o bot também ouve por aqui (o librespot não toca em caixa de som nenhuma).
//
// Quem está na call vê o que toca e manda comandos pro dono do bot pelo canal de
// dados `music` da conexão P2P. Nada disso passa pelo servidor, que só sabe o
// nome da música (pra lista do canal de voz).

import type { MusicStatus } from '../../../../shared/protocol'
import type { MusicError, MusicList, MusicOp, MusicPlayer, MusicReply, MusicSearch, MusicTrack } from '../../preload/api'
import workletUrl from './music-worklet.ts?worker&url'

export type { MusicError, MusicList, MusicOp, MusicPlayer, MusicReply, MusicSearch, MusicTrack }

/** O que o dono do bot conta pra call: o que toca e o que vem depois. */
export interface MusicShare {
  player: MusicPlayer | null
  queue: MusicTrack[]
}

/** Mensagens do canal de dados `music` (direto entre dois apps da call). */
export type MusicMessage =
  /** "Entendo o bot": só quem manda isso recebe a faixa do Spotify (app antigo tocaria como se fosse a voz). */
  | { t: 'hello' }
  /** O dono do bot conta o que toca (null: tirou o bot). */
  | { t: 'state'; share: MusicShare | null }
  /** Pedido pro dono do bot (tocar, pular, buscar...). */
  | { t: 'cmd'; id: string; op: MusicOp }
  | { t: 'reply'; id: string; reply: MusicReply }

const SAMPLE_RATE = 44_100
/** Quanto som fica guardado no worklet (o librespot anda só isso na frente do que toca). */
const BUFFER = 0.4
/** Pedir menos que isso de uma vez é IPC à toa. */
const MIN_REQUEST = 2048

// ---------- Conferência do que chega pelo canal de dados (o outro app nunca é confiável) ----------

const URI = /^spotify:(track|album|playlist|artist|episode|show):[A-Za-z0-9]{1,40}$/
/** Capas só dos servidores de imagem do Spotify (a CSP também só deixa esses). */
const COVER = /^https:\/\/([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com)\/[^\s"'<>]{1,400}$/
const MUSIC_ERRORS: MusicError[] = [
  'not-connected', 'premium', 'allowlist', 'muted', 'client-id', 'port', 'unavailable', 'no-device', 'rate', 'network', 'auth', 'missing', 'login', 'off', 'timeout', 'failed',
]

type Raw = Record<string, unknown>
const isObj = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.slice(0, max) : '')
const num = (value: unknown, max: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0)
const coverOf = (value: unknown) => (typeof value === 'string' && COVER.test(value) ? value : null)

export function cleanTrack(value: unknown): MusicTrack | null {
  if (!isObj(value) || typeof value.uri !== 'string' || !URI.test(value.uri)) return null
  return {
    uri: value.uri,
    title: text(value.title),
    artists: text(value.artists),
    album: text(value.album),
    cover: coverOf(value.cover),
    durationMs: num(value.durationMs, 24 * 3600_000),
    artistId: typeof value.artistId === 'string' && /^[A-Za-z0-9]{1,40}$/.test(value.artistId) ? value.artistId : null,
    genres: (Array.isArray(value.genres) ? value.genres : [])
      .filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
      .slice(0, 3)
      .map((g) => g.trim().slice(0, 40)),
  }
}

/** Busca de músicas por estilo (o filtro `genre:` do Spotify). */
export const genreQuery = (genre: string) => `genre:"${genre.replace(/"/g, '')}"`

/** Estilos pra escolher na busca vazia (os nomes do próprio Spotify: não se traduzem). */
export const GENRES = [
  'pop', 'rock', 'hip hop', 'trap', 'funk carioca', 'sertanejo', 'pagode', 'mpb', 'samba', 'forró',
  'edm', 'house', 'lo-fi', 'jazz', 'metal', 'indie', 'k-pop', 'anime', 'reggaeton', 'r&b',
]

export function cleanList(value: unknown): MusicList | null {
  if (!isObj(value) || typeof value.uri !== 'string' || !URI.test(value.uri)) return null
  if (value.kind !== 'playlist' && value.kind !== 'album') return null
  return { uri: value.uri, kind: value.kind, title: text(value.title), by: text(value.by), cover: coverOf(value.cover) }
}

const tracks = (value: unknown, max: number) =>
  (Array.isArray(value) ? value.slice(0, max) : []).map(cleanTrack).filter((t): t is MusicTrack => !!t)
export const cleanLists = (value: unknown) =>
  (Array.isArray(value) ? value.slice(0, 60) : []).map(cleanList).filter((l): l is MusicList => !!l)
export const cleanTracks = (value: unknown) => tracks(value, 60)

export function cleanSearch(value: unknown): MusicSearch {
  return isObj(value) ? { tracks: tracks(value.tracks, 30), lists: cleanLists(value.lists) } : { tracks: [], lists: [] }
}

function cleanPlayer(value: unknown): MusicPlayer | null {
  if (!isObj(value)) return null
  const repeat = value.repeat === 'context' || value.repeat === 'track' ? value.repeat : 'off'
  return {
    track: cleanTrack(value.track),
    playing: value.playing === true,
    progressMs: num(value.progressMs, 24 * 3600_000),
    // O relógio de quem mandou não vale aqui: conta a partir de agora.
    at: Date.now(),
    shuffle: value.shuffle === true,
    repeat,
    elsewhere: typeof value.elsewhere === 'string' ? value.elsewhere.slice(0, 100) : null,
  }
}

export function cleanShare(value: unknown): MusicShare | null {
  if (!isObj(value)) return null
  return { player: cleanPlayer(value.player), queue: tracks(value.queue, 20) }
}

/** Só o que dá pra pedir de outro app (e com os valores dentro do esperado). */
export function cleanOp(value: unknown): MusicOp | null {
  if (!isObj(value)) return null
  const uri = typeof value.uri === 'string' && URI.test(value.uri) ? value.uri : null
  switch (value.op) {
    case 'player':
    case 'queue':
    case 'resume':
    case 'pause':
    case 'next':
    case 'previous':
    case 'transfer':
      return { op: value.op }
    case 'search': {
      const q = text(value.q, 200).trim()
      return q ? { op: 'search', q, offset: num(value.offset, 990) } : null
    }
    case 'playlists':
      return { op: 'playlists', offset: num(value.offset, 990) }
    case 'play':
      return uri ? { op: 'play', uri } : null
    case 'enqueue':
      return uri && /^spotify:(track|episode):/.test(uri) ? { op: 'enqueue', uri } : null
    case 'seek':
      return { op: 'seek', ms: Math.round(num(value.ms, 24 * 3600_000)) }
    case 'shuffle':
      return { op: 'shuffle', on: value.on === true }
    case 'repeat':
      return { op: 'repeat', mode: value.mode === 'context' || value.mode === 'track' ? value.mode : 'off' }
    default:
      return null
  }
}

function cleanReply(value: unknown): MusicReply | null {
  if (!isObj(value)) return null
  if (value.ok === true) return { ok: true, data: value.data }
  return { ok: false, error: MUSIC_ERRORS.includes(value.error as MusicError) ? (value.error as MusicError) : 'failed' }
}

export function cleanMusicMessage(value: unknown): MusicMessage | null {
  if (!isObj(value)) return null
  const id = typeof value.id === 'string' && value.id.length <= 40 ? value.id : null
  switch (value.t) {
    case 'hello':
      return { t: 'hello' }
    case 'state':
      return { t: 'state', share: cleanShare(value.share) }
    case 'cmd': {
      const op = cleanOp(value.op)
      return id && op ? { t: 'cmd', id, op } : null
    }
    case 'reply': {
      const reply = cleanReply(value.reply)
      return id && reply ? { t: 'reply', id, reply } : null
    }
    default:
      return null
  }
}

/** Onde a música está agora (ms), contando o tempo desde a última leitura. */
export function progressOf(player: MusicPlayer, now = Date.now()): number {
  const ms = player.playing ? player.progressMs + (now - player.at) : player.progressMs
  return Math.max(0, Math.min(player.track?.durationMs || ms, ms))
}

// ---------- O bot de quem pôs (som + comandos) ----------

/** Comandos que mudam o que toca: depois deles o estado é lido de novo. */
const CHANGES = new Set<MusicOp['op']>(['play', 'resume', 'pause', 'next', 'previous', 'seek', 'shuffle', 'repeat', 'enqueue', 'transfer'])
/** Comandos depois dos quais o som guardado é velho (a música trocou ou parou). */
const FLUSHES = new Set<MusicOp['op']>(['play', 'pause', 'next', 'previous', 'seek', 'transfer'])

export class MusicBot {
  status = $state<'off' | 'starting' | 'on'>('off')
  share = $state.raw<MusicShare>({ player: null, queue: [] })
  /** Por que não ligou (ou por que caiu). */
  error = $state<MusicError | null>(null)
  /** O librespot pediu o login dele no navegador (só na primeira vez), com o endereço (caso o navegador não abra). */
  browser = $state<{ url: string | null } | null>(null)
  /** Container estável da faixa: o id dele diz pros outros que é o Spotify. */
  readonly stream = new MediaStream()
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private track: MediaStreamTrack | null = null
  /** Quem pôs o bot ouve por aqui, no volume dele. */
  private local = new Audio()
  /** Bytes pedidos ao processo principal que ainda não chegaram. */
  private inflight = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private queueAt = 0

  constructor(private events: { changed(): void; stopped(error: MusicError | null): void }) {
    this.local.autoplay = true
    // A página acabou de abrir (ou recarregou): um bot que tenha ficado ligado da página anterior não tem mais dono.
    void window.resenha.spotify.stop()
    window.resenha.spotify.onPcm((chunk) => this.onPcm(chunk))
    window.resenha.spotify.onBrowser((url) => (this.browser = { url: url ?? this.browser?.url ?? null }))
    window.resenha.spotify.onStopped((error) => {
      if (this.status === 'off') return
      void window.resenha.spotify.stop()
      this.close()
      this.error = error
      this.events.stopped(error)
    })
  }

  get on(): boolean {
    return this.status === 'on'
  }

  /** O que vai pro servidor (a lista do canal de voz mostra pra todo mundo). */
  get serverStatus(): MusicStatus | null {
    if (this.status !== 'on') return null
    const track = this.share.player?.track
    return { title: track?.title ?? '', artist: track?.artists ?? '', playing: !!this.share.player?.playing }
  }

  async start(): Promise<MusicError | null> {
    if (this.status !== 'off') return null
    this.status = 'starting'
    this.error = null
    this.browser = null
    const result = await window.resenha.spotify.start()
    this.browser = null
    // Desligaram enquanto ligava (saiu da call, por exemplo).
    if (this.status !== 'starting') {
      if (result.ok) void window.resenha.spotify.stop()
      return null
    }
    if (!result.ok) {
      this.status = 'off'
      this.error = result.error
      return result.error
    }
    try {
      await this.openAudio()
    } catch (err) {
      console.error('spotify: som não abriu', err)
      void window.resenha.spotify.stop()
      this.close()
      this.error = 'failed'
      return 'failed'
    }
    if (this.status !== 'starting') {
      // Parou (ou o librespot caiu) enquanto o som abria.
      void window.resenha.spotify.stop()
      this.close()
      return null
    }
    this.status = 'on'
    this.events.changed()
    void this.refresh(true)
    return null
  }

  stop() {
    if (this.status === 'off') return
    void window.resenha.spotify.stop()
    this.close()
    this.events.changed()
  }

  private close() {
    this.status = 'off'
    this.share = { player: null, queue: [] }
    if (this.timer) clearTimeout(this.timer)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.timer = this.flushTimer = null
    this.inflight = 0
    this.local.srcObject = null
    if (this.track) {
      this.stream.removeTrack(this.track)
      this.track.stop()
    }
    this.track = null
    this.node?.disconnect()
    this.node = null
    void this.ctx?.close()
    this.ctx = null
  }

  private async openAudio() {
    // 44,1 kHz: a taxa do librespot (o WebRTC converte pros 48 kHz do Opus).
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'playback' })
    this.ctx = ctx
    await ctx.audioWorklet.addModule(workletUrl)
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    const node = new AudioWorkletNode(ctx, 'resenha-music', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
    const destination = ctx.createMediaStreamDestination()
    destination.channelCount = 2
    node.connect(destination)
    node.port.onmessage = (event: MessageEvent<{ level: number }>) => this.onLevel(event.data.level)
    const track = destination.stream.getAudioTracks()[0]
    track.contentHint = 'music'
    this.node = node
    this.track = track
    this.stream.addTrack(track)
    this.local.srcObject = new MediaStream([track])
    this.local.play().catch(() => {})
  }

  /** Volume e saída de quem pôs o bot (os outros acertam o deles nas conexões P2P). */
  setOutput(volume: number, muted: boolean, deviceId: string) {
    this.local.volume = Math.max(0, Math.min(1, volume))
    this.local.muted = muted
    this.local.setSinkId(deviceId === 'default' ? '' : deviceId).catch(() => {})
  }

  private onPcm(chunk: Uint8Array) {
    this.inflight = Math.max(0, this.inflight - chunk.byteLength)
    if (!this.node) return
    const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
    this.node.port.postMessage({ pcm: buffer }, [buffer])
  }

  /** O worklet contou quanto tem guardado: pede o que falta (o librespot só anda isso na frente). */
  private onLevel(level: number) {
    if (this.status !== 'on') return
    const missing = Math.floor(SAMPLE_RATE * BUFFER - level - this.inflight / 4)
    if (missing < MIN_REQUEST) return
    this.inflight += missing * 4
    window.resenha.spotify.want(missing * 4)
  }

  /** Joga fora o som guardado (a música trocou: a nova começa na hora). */
  private flush(delay: number) {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      window.resenha.spotify.flush()
      this.node?.port.postMessage({ flush: true })
    }, delay)
  }

  /** Executa um pedido (meu ou de alguém da call). */
  async run(op: MusicOp): Promise<MusicReply> {
    if (this.status !== 'on') return { ok: false, error: 'off' }
    const reply = await window.resenha.spotify.request(op)
    if (reply.ok && FLUSHES.has(op.op)) this.flush(op.op === 'pause' ? 0 : 250)
    if (reply.ok && CHANGES.has(op.op)) {
      // O Spotify demora um pouco pra contar o que mudou.
      this.schedule(400, op.op === 'enqueue' || op.op === 'play' || op.op === 'next' || op.op === 'previous')
    }
    return reply
  }

  private schedule(ms: number, queue = false) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.refresh(queue), ms)
  }

  /** Lê o que está tocando (e a fila, quando a música troca) e conta pra call se mudou. */
  private async refresh(withQueue = false) {
    this.timer = null
    if (this.status !== 'on') return
    const reply = await window.resenha.spotify.request({ op: 'player' })
    if (this.status !== 'on') return
    if (!reply.ok) {
      if (reply.error === 'not-connected' || reply.error === 'auth') {
        this.stop()
        this.error = reply.error
        this.events.stopped(reply.error)
        return
      }
      // Muitos pedidos (429) ou rede: espera mais antes de tentar de novo.
      return this.schedule(reply.error === 'rate' ? 30_000 : 10_000)
    }
    const player = reply.data as MusicPlayer
    const before = this.share
    const trackChanged = player.track?.uri !== before.player?.track?.uri
    let queue = before.queue
    if (withQueue || trackChanged || Date.now() - this.queueAt > 30_000) {
      const answer = await window.resenha.spotify.request({ op: 'queue' })
      if (this.status !== 'on') return
      if (answer.ok) queue = answer.data as MusicTrack[]
      this.queueAt = Date.now()
    }
    this.share = { player, queue }
    if (differs(before, this.share)) this.events.changed()
    // Lê de novo logo depois que a música acabar (é quando ela troca), ou a cada 5 s.
    const left = player.playing && player.track ? player.track.durationMs - player.progressMs : Infinity
    this.schedule(Math.max(1000, Math.min(player.playing ? 5000 : 8000, left + 600)))
  }
}

/** Mudou algo que a call precisa saber? (A posição andando no ritmo esperado não conta: cada um calcula.) */
function differs(before: MusicShare, after: MusicShare): boolean {
  const key = (share: MusicShare) => {
    const p = share.player
    return JSON.stringify([p && { ...p, at: 0, progressMs: 0 }, share.queue.map((t) => t.uri)])
  }
  if (key(before) !== key(after)) return true
  if (!before.player || !after.player) return false
  return Math.abs(progressOf(before.player, after.player.at) - after.player.progressMs) > 2000
}
