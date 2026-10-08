import type { Badge, SignalData, VoiceMember } from '../../../../shared/protocol'
import type { PlatformInfo } from '../../preload/api'
import type { Api } from './api'
import { userColor } from './format'
import { InkShare, cleanInk, type InkMessage, type InkPolicy } from './ink.svelte'
import { captureScreen, getCameraStream, getMicTrack, stopCapture } from './media'
import { MicPipeline } from './mic'
import { Peer, type LinkStats, type SfuScreen, type VideoStats } from './peer'
import { PRESETS, settings } from './settings.svelte'
import { SfuPublisher, SfuViewer } from './sfu'
import { playSound, type SoundName } from './sounds'

/** Quem tem selo entra na call com som próprio (o Fundador ganha do Pioneiro se os dois chegarem juntos). */
function joinSound(badge: Badge | null): SoundName | null {
  return badge === 'founder' ? 'founder-join' : badge === 'pioneer' ? 'pioneer-join' : null
}

interface CallDeps {
  api(): Api | null
  platform(): PlatformInfo | null
  toast(text: string, kind?: 'error' | 'info'): void
  /** Nome de exibição de alguém (pros rabiscos na minha tela). */
  name(userId: string): string
  /** Selo de alguém (Fundador, Pioneiro: entram com som próprio). Sem `userId`, o meu. */
  badge(userId?: string): Badge | null
}

/**
 * Por onde a call conversa com o servidor: o canal de voz de um servidor
 * (WebSocket do Guild) ou uma chamada privada (WebSocket pessoal).
 */
export interface CallTransport {
  kind: 'guild' | 'dm'
  /** Servidor ou conversa privada. */
  scopeId: string
  /** Canal de voz (ou a própria conversa, numa chamada privada). */
  channelId: string
  connId(): string | null
  /** Quem está nesta call (todas as conexões, inclusive a minha). */
  members(): VoiceMember[]
  /** `back`: voltando depois de o servidor perder a call (tela e câmera como estavam). */
  join(muted: boolean, deafened: boolean, back?: { sharing: boolean; camera: boolean }): boolean
  leave(): void
  update(state: { muted: boolean; deafened: boolean; sharing: boolean; camera: boolean }): void
  signal(to: string, data: SignalData): boolean
}

const SPEAKING_REMOTE = 0.03
const ICE_TTL = 6 * 60 * 60 * 1000
/** De quanto em quanto tempo pergunta de novo se o SFU está disponível (a cota pode acabar). */
const MEDIA_TTL = 5 * 60 * 1000
/** Quem assiste não respondeu ao "a tela está no SFU" (app antigo?): manda a cópia direta. */
const SFU_REPLY_WAIT = 6000
/** De quanto em quanto tempo o app conta pro servidor o que passou pelo Cloudflare. */
const USAGE_EVERY = 60_000
/**
 * Quem some da call ainda tem um tempo pra voltar antes de a conexão P2P com
 * ele fechar (o servidor reiniciando derruba todo mundo por um instante).
 */
const PEER_GRACE = 15_000
/** Sinalização guardada enquanto o WebSocket está caído (vai quando voltar). */
const OUTBOX_MAX = 500

/** A call em que esta instância está: microfone, conexões P2P e telas. */
export class Call {
  channelId = $state<string | null>(null)
  /** Servidor da call (null numa chamada privada). */
  guildId = $state<string | null>(null)
  /** Conversa privada da call (null num canal de voz). */
  dmId = $state<string | null>(null)
  /** Um moderador me mutou ou ensurdeceu: vale por cima dos meus botões. */
  serverMuted = $state(false)
  serverDeafened = $state(false)
  private transport: CallTransport | null = null
  /** Conexões mutadas por moderador: o áudio delas não toca aqui. */
  private silenced = new Set<string>()
  muted = $state(false)
  deafened = $state(false)
  sharing = $state(false)
  /** connId de quem estou assistindo (pode ser eu mesmo = prévia local). */
  watching = $state<string | null>(null)
  /** connId -> falando agora */
  speaking = $state<Record<string, boolean>>({})
  links = $state<Record<string, LinkStats>>({})
  screens = $state.raw<Record<string, MediaStream>>({})
  localScreen = $state.raw<MediaStream | null>(null)
  /** Minha câmera (null = desligada) e as câmeras que chegam (connId -> stream). */
  camera = $state.raw<MediaStream | null>(null)
  cameras = $state.raw<Record<string, MediaStream>>({})
  joining = $state(false)
  /** Estou falando (com uma folga pra não piscar), pro ícone da bandeja. */
  selfSpeaking = $state(false)
  private lastSpoke = 0

  private peers = new Map<string, Peer>()
  /** connId -> sumiu da call: a conexão P2P fecha se não voltar a tempo. */
  private leaving = new Map<string, ReturnType<typeof setTimeout>>()
  /** Sinalização que não saiu (WebSocket caído), na ordem. */
  private outbox: { to: string; data: SignalData }[] = []
  /** Container estável do microfone: o id dele é o que os outros usam pra reconhecer a faixa. */
  private micStream = new MediaStream()
  private micTrack: MediaStreamTrack | null = null
  /** Microfone já processado (RNNoise + limiar); `micTrack` é a saída dele. */
  mic: MicPipeline | null = null
  private ice: { servers: RTCIceServer[]; at: number } | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private statsTicker: ReturnType<typeof setInterval> | null = null
  private mutedBeforeDeafen = false
  /** Quem estava na call no último voice.state (connId -> transmitindo), pros sons. */
  private known: Map<string, boolean> | null = null
  // ---------- Tela pelo SFU do Cloudflare (lib/sfu.ts) ----------
  // Com 2 ou mais pessoas assistindo, a minha tela vai uma vez pro SFU e ele
  // distribui (uma codificação e um upload só). Com uma pessoa, continua direta.

  /** O servidor oferece o SFU agora (tem a chave e a cota do mês não acabou). */
  private media: { sfu: boolean; at: number } | null = null
  /** Minha tela publicada no SFU. */
  private sfuShare: SfuPublisher | null = null
  private sfuStarting = false
  /** O SFU falhou nesta transmissão: não tenta de novo até a próxima. */
  private sfuGaveUp = false
  /** connId -> quem assiste puxa do SFU (a cópia direta pra essa pessoa parou). */
  private sfuViewers: Record<string, boolean> = {}
  /** connId -> esperando quem assiste responder se conseguiu puxar do SFU. */
  private sfuWaiting = new Map<string, ReturnType<typeof setTimeout>>()
  /** A tela que eu assisto pelo SFU. */
  private sfuWatch: { connId: string; viewer: SfuViewer } | null = null
  /** Bytes que passaram pelo Cloudflare (TURN e SFU) e ainda não foram contados no servidor. */
  private mediaBytes = 0
  private mediaReportAt = 0
  private relaySeen = new Map<string, number>()

  /** Rabiscos de quem assiste na minha tela (só compartilhando o monitor inteiro). */
  readonly ink = new InkShare((msg) => this.broadcastInk(msg))
  /** connId de quem compartilha -> se deixa rabiscar na tela dele agora (e o tamanho do monitor). */
  inkPolicy = $state<Record<string, InkPolicy>>({})
  /** connId de quem compartilha -> quantas vezes os rabiscos de lá foram apagados (quem desenha apaga o eco junto). */
  inkCleared = $state<Record<string, number>>({})

  constructor(private deps: CallDeps) {}

  get peerList(): Peer[] {
    return [...this.peers.values()]
  }

  private connId(): string | null {
    return this.transport?.connId() ?? null
  }

  private members(): VoiceMember[] {
    return this.transport?.members() ?? []
  }

  /** Está nessa call (servidor + canal, ou conversa)? */
  isIn(transport: Pick<CallTransport, 'scopeId' | 'channelId'>): boolean {
    return !!this.transport && this.transport.scopeId === transport.scopeId && this.transport.channelId === transport.channelId
  }

  /** O transporte de agora (pra quem precisa mandar algo da call). */
  get current(): CallTransport | null {
    return this.transport
  }

  // ---------- Entrar e sair ----------

  async join(transport: CallTransport) {
    if (this.isIn(transport) || this.joining) return
    if (this.transport) this.leave()
    this.joining = true
    try {
      const api = this.deps.api()
      if (!api) return
      if (!this.ice || Date.now() - this.ice.at > ICE_TTL) {
        this.ice = { servers: await api.iceServers(), at: Date.now() }
      }
      if (!this.micTrack) await this.openMic()
      this.transport = transport
      this.channelId = transport.channelId
      this.guildId = transport.kind === 'guild' ? transport.scopeId : null
      this.dmId = transport.kind === 'dm' ? transport.scopeId : null
      if (!transport.join(this.muted, this.deafened)) {
        this.leave(false)
        return
      }
      this.startTickers()
      playSound(joinSound(this.deps.badge()) ?? 'self-join')
    } catch (err) {
      console.error(err)
      this.deps.toast(
        (err as Error).name === 'NotAllowedError' || (err as Error).name === 'NotFoundError'
          ? 'Sem acesso ao microfone.'
          : `Não deu pra entrar na call: ${(err as Error).message}`,
      )
    } finally {
      this.joining = false
    }
  }

  /**
   * O WebSocket voltou, com o mesmo connId. `resumed`: o servidor manteve a
   * conexão na call e pros outros nada mudou. Senão (o servidor reiniciou, ou
   * demorou demais), entra de novo. Em nenhum caso as conexões P2P são
   * desfeitas: voz e tela não passam pelo servidor. Se o outro lado tiver
   * recomeçado a dele, os ids na sinalização avisam e a gente recomeça junto.
   */
  reconnected(resumed: boolean) {
    if (!this.transport) return
    if (resumed) this.sendState()
    else this.transport.join(this.muted, this.deafened, { sharing: this.sharing, camera: !!this.camera })
    this.flushOutbox()
    for (const peer of this.peers.values()) peer.resendOffer(true)
    // Quem compartilha pode ter parado de mandar pra mim enquanto eu estava fora.
    if (!resumed && this.watching && this.watching !== this.connId()) this.peers.get(this.watching)?.requestScreen(true)
    this.sync()
  }

  private sendSignal(to: string, data: SignalData) {
    if (this.outbox.length === 0 && this.transport?.signal(to, data)) return
    this.outbox.push({ to, data })
    if (this.outbox.length > OUTBOX_MAX) this.outbox.shift()
  }

  private flushOutbox() {
    while (this.outbox.length > 0 && this.transport) {
      const next = this.outbox[0]
      if (this.peers.has(next.to) && !this.transport.signal(next.to, next.data)) return
      this.outbox.shift()
    }
  }

  /** Sai da call. `notify = false`: o servidor já tirou (moderador, canal apagado). */
  leave(notify = true) {
    if (!this.transport) return
    playSound('self-leave')
    if (notify) this.transport.leave()
    this.transport = null
    void this.reportMedia(true)
    for (const connId of [...this.peers.keys()]) this.removePeer(connId)
    this.outbox = []
    this.stopShare(false)
    this.stopSfuWatch()
    this.relaySeen.clear()
    this.stopCamera(false)
    this.cameras = {}
    this.watching = null
    this.channelId = null
    this.guildId = null
    this.dmId = null
    this.serverMuted = false
    this.serverDeafened = false
    this.silenced.clear()
    this.selfSpeaking = false
    if (this.micTrack) this.micStream.removeTrack(this.micTrack)
    this.mic?.close()
    this.mic = null
    this.micTrack = null
    this.speaking = {}
    this.links = {}
    this.known = null
    if (this.ticker) clearInterval(this.ticker)
    if (this.statsTicker) clearInterval(this.statsTicker)
    this.ticker = this.statsTicker = null
  }

  private async openMic() {
    const mic = await MicPipeline.create(await getMicTrack())
    const track = mic.track
    track.enabled = !this.muted && !this.serverMuted
    if (this.micTrack) this.micStream.removeTrack(this.micTrack)
    const previous = this.mic
    this.micStream.addTrack(track)
    this.micTrack = track
    this.mic = mic
    await Promise.all(this.peerList.map((p) => p.replaceMic(track)))
    previous?.close()
  }

  /** Redução de ruído ou limiar mudou: aplica na hora, sem reabrir o microfone. */
  updateMicProcessing() {
    this.mic?.update()
  }

  /** Reabre o microfone com o dispositivo/processamento atual das configurações. */
  async reloadMic() {
    if (!this.channelId) return
    try {
      await this.openMic()
    } catch (err) {
      this.deps.toast(`Não deu pra trocar o microfone: ${(err as Error).message}`)
    }
  }

  applyOutput() {
    for (const peer of this.peers.values()) peer.setOutput(settings.outputDevice)
  }

  applyVolumes() {
    for (const peer of this.peers.values()) peer.setVolume(this.volumeOf(peer.connId, peer.userId))
  }

  private volumeOf(connId: string, userId: string): number {
    return this.silenced.has(connId) ? 0 : (settings.userVolumes[userId] ?? 1)
  }

  // ---------- Mutar / ensurdecer ----------

  toggleMute() {
    if (this.deafened) {
      // Igual no Discord: desmutar também tira o ensurdecer.
      this.deafened = false
      this.muted = false
      playSound('undeafen')
    } else {
      this.muted = !this.muted
      playSound(this.muted ? 'mute' : 'unmute')
    }
    this.applyMuteState()
  }

  toggleDeafen() {
    if (this.deafened) {
      this.deafened = false
      this.muted = this.mutedBeforeDeafen
      playSound('undeafen')
    } else {
      this.mutedBeforeDeafen = this.muted
      this.deafened = true
      this.muted = true
      playSound('deafen')
    }
    this.applyMuteState()
  }

  private applyMuteState(notify = true) {
    if (this.micTrack) this.micTrack.enabled = !this.muted && !this.serverMuted
    for (const peer of this.peers.values()) peer.setDeafened(this.deafened || this.serverDeafened)
    if (notify) this.sendState()
  }

  private sendState() {
    this.transport?.update({ muted: this.muted, deafened: this.deafened, sharing: this.sharing, camera: !!this.camera })
  }

  // ---------- Membros e sinalização ----------

  /** Chamado a cada voice.state: abre conexão com quem entrou, fecha com quem saiu. */
  sync(members: VoiceMember[] = this.members()) {
    const me = this.connId()
    if (!this.channelId || !me) return
    const mine = members.find((m) => m.connId === me && m.channelId === this.channelId)
    if (mine && (!!mine.serverMuted !== this.serverMuted || !!mine.serverDeafened !== this.serverDeafened)) {
      this.serverMuted = !!mine.serverMuted
      this.serverDeafened = !!mine.serverDeafened
      playSound(this.serverMuted || this.serverDeafened ? 'mute' : 'unmute')
      this.applyMuteState(false)
    }
    const others = members.filter((m) => m.channelId === this.channelId && m.connId !== me)
    // Mutado por moderador: quem recebe não toca o áudio dele.
    const silenced = new Set(others.filter((m) => m.serverMuted).map((m) => m.connId))
    const changed = silenced.size !== this.silenced.size || [...silenced].some((id) => !this.silenced.has(id))
    this.silenced = silenced
    // Sons: alguém entrou, saiu ou começou a transmitir (o primeiro estado só registra).
    if (this.known) {
      const before = this.known
      const arrived = others.filter((m) => !before.has(m.connId))
      if (arrived.length) playSound(arrived.map((m) => joinSound(this.deps.badge(m.userId))).find(Boolean) ?? 'join')
      else if ([...before.keys()].some((id) => !others.some((m) => m.connId === id))) playSound('leave')
      if (others.some((m) => m.sharing && before.get(m.connId) === false)) playSound('live')
    }
    this.known = new Map(others.map((m) => [m.connId, m.sharing]))

    for (const member of others) {
      if (!this.peers.has(member.connId)) this.createPeer(member)
      else if (this.leaving.has(member.connId)) this.returned(member.connId)
    }
    for (const connId of [...this.peers.keys()]) {
      if (!others.some((m) => m.connId === connId)) this.goneFromCall(connId)
    }
    if (changed) this.applyVolumes()
    // Câmera desligada do outro lado: o bloco volta pro avatar.
    for (const member of others) if (!member.camera) this.dropCamera(member.connId)

    // Quem eu assistia parou de compartilhar (ele mesmo já parou de mandar). Se só sumiu, espera ele voltar.
    const watched = this.watching
    if (watched && watched !== me && others.some((m) => m.connId === watched && !m.sharing)) {
      this.watching = null
      this.dropScreen(watched)
      playSound('stream-end')
    }
  }

  /**
   * Sumiu da call: espera um pouco antes de fechar a conexão P2P (o servidor
   * reiniciando derruba todo mundo por um instante, e voz e tela seguem direto).
   */
  private goneFromCall(connId: string) {
    if (this.leaving.has(connId)) return
    this.away[connId] = true
    this.leaving.set(
      connId,
      setTimeout(() => {
        this.leaving.delete(connId)
        this.removePeer(connId)
        if (this.watching === connId) this.watching = null
      }, PEER_GRACE),
    )
  }

  /** Voltou a tempo: a conexão P2P continua; se eu assistia a tela dele, peço de novo (por garantia). */
  private returned(connId: string) {
    clearTimeout(this.leaving.get(connId))
    this.leaving.delete(connId)
    delete this.away[connId]
    if (this.watching === connId) this.peers.get(connId)?.requestScreen(true)
  }

  signal(from: string, data: SignalData) {
    let peer = this.peers.get(from)
    if (peer && data.pc) {
      // Pra uma conexão minha que já não existe (o outro lado ainda não sabe da nova): ignora.
      if (data.ack && data.ack !== peer.id) return
      // O outro lado recomeçou a conexão dele e ainda não conhece a minha: recomeço a minha também.
      if (peer.remoteId && peer.remoteId !== data.pc) {
        if (data.ack) return
        this.removePeer(from)
        peer = undefined
      }
    }
    if (!peer) {
      const member = this.members().find((m) => m.connId === from && m.channelId === this.channelId)
      if (!member) return
      peer = this.createPeer(member)
    }
    peer?.handle(data)
  }

  private createPeer(member: VoiceMember): Peer | undefined {
    const me = this.connId()
    if (!me || !this.ice || !this.micTrack) return
    const peer = new Peer(member.connId, member.userId, me > member.connId, this.ice.servers, this.micStream, settings.codec, {
      signal: (data) => this.sendSignal(member.connId, data),
      screen: (stream) => {
        // Puxando a tela dele pelo SFU: a cópia direta (que para logo) não substitui.
        if (this.sfuWatch?.connId === member.connId) return
        this.screens = { ...this.screens, [member.connId]: stream! }
      },
      camera: (stream) => {
        this.cameras = { ...this.cameras, [member.connId]: stream }
      },
      ink: (data) => this.onInk(member.connId, member.userId, data),
      inkOpen: () => {
        if (this.localScreen) peer.sendInk(this.ink.policy())
      },
      watchRequest: (watching) => {
        if (peer.closed) return
        if (watching && this.localScreen) peer.sendInk(this.ink.policy())
        const before = !!this.watchers[member.connId]
        this.watchers[member.connId] = watching
        // Alguém começou ou parou de assistir a minha tela (pedido repetido depois de reconectar não toca).
        if (this.localScreen && watching !== before) playSound(watching ? 'viewer-join' : 'viewer-leave')
        if (!watching || !this.localScreen) {
          this.forgetSfuViewer(member.connId)
          this.sfuIdle()
          void peer.sendScreen(null, null)
          return
        }
        // Já no SFU: quem chega puxa de lá (sem a cópia direta, que pesaria na CPU).
        if (this.sfuShare) return this.offerSfu(peer)
        void peer.sendScreen(this.localScreen, this.videoOptions())
        void this.maybeSfu()
      },
      screenSfu: (info) => void this.onScreenSfu(member.connId, peer, info),
      screenSfuReply: (ok) => this.onSfuReply(member.connId, peer, ok),
    })
    peer.setVolume(this.volumeOf(member.connId, member.userId))
    peer.setDeafened(this.deafened || this.serverDeafened)
    peer.setOutput(settings.outputDevice)
    this.peers.set(member.connId, peer)
    if (this.camera) peer.sendCamera(this.camera)
    // Eu assistia a tela dele (a conexão foi refeita): pede de novo, sem precisar clicar.
    if (this.watching === member.connId) peer.requestScreen(true)
    return peer
  }

  private removePeer(connId: string) {
    delete this.inkPolicy[connId]
    delete this.inkCleared[connId]
    clearTimeout(this.leaving.get(connId))
    this.leaving.delete(connId)
    delete this.away[connId]
    this.peers.get(connId)?.close()
    this.peers.delete(connId)
    delete this.watchers[connId]
    this.forgetSfuViewer(connId)
    this.sfuIdle()
    if (this.sfuWatch?.connId === connId) this.stopSfuWatch()
    this.relaySeen.delete(connId)
    this.dropScreen(connId)
    this.dropCamera(connId)
    if (connId in this.links) delete this.links[connId]
    if (connId in this.speaking) delete this.speaking[connId]
  }

  // ---------- Compartilhar a tela ----------

  /** connId -> está assistindo a minha tela */
  watchers = $state<Record<string, boolean>>({})
  /** Quem sumiu da call e ainda pode voltar (não conta como assistindo). */
  private away = $state<Record<string, true>>({})

  get viewerCount(): number {
    return this.viewerIds.length
  }

  /** Quem está assistindo a minha tela agora (ids das pessoas, sem repetir). */
  get viewerIds(): string[] {
    const ids = Object.entries(this.watchers)
      .filter(([connId, on]) => on && !this.away[connId])
      .map(([connId]) => this.peers.get(connId)?.userId)
      .filter((id): id is string => !!id)
    return [...new Set(ids)]
  }

  private videoOptions() {
    return { bitrate: PRESETS[settings.screenPreset].bitrate, codec: settings.codec, mode: settings.screenMode }
  }

  async startShare(sourceId: string | null) {
    const platform = this.deps.platform()
    if (!this.channelId || !platform) return
    if (this.sharing) this.stopShare(false)
    this.sfuGaveUp = false
    let capture
    try {
      capture = await captureScreen({
        platform,
        sourceId,
        preset: settings.screenPreset,
        mode: settings.screenMode,
        audio: settings.screenAudio,
      })
    } catch (err) {
      if ((err as Error).name !== 'NotAllowedError') this.deps.toast(`Não deu pra compartilhar: ${(err as Error).message}`)
      return
    }
    if (capture.warning) this.deps.toast(capture.warning, 'info')

    const { stream } = capture
    // Parar pelo portal/sistema ou fechar a janela compartilhada encerra aqui também.
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (this.localScreen === stream) this.stopShare()
    })
    this.localScreen = stream
    this.sharing = true
    this.sendState()
    void this.ink.begin(stream.getVideoTracks()[0])
    const options = this.videoOptions()
    await Promise.all(
      this.peerList.filter((p) => this.watchers[p.connId]).map((p) => p.sendScreen(stream, options)),
    )
  }

  /** Qualidade, prioridade ou codec mudaram no meio da transmissão: aplica sem reiniciar. */
  async updateShare() {
    const stream = this.localScreen
    if (!stream) return
    const [video] = stream.getVideoTracks()
    const { width, height } = PRESETS[settings.screenPreset]
    video.contentHint = settings.screenMode === 'motion' ? 'motion' : 'detail'
    try {
      await video.applyConstraints({ width: { max: width }, height: { max: height }, frameRate: { ideal: 60, max: 60 } })
    } catch {
      // a fonte não aceita: fica no tamanho atual
    }
    const options = this.videoOptions()
    await Promise.all(this.peerList.filter((p) => this.watchers[p.connId]).map((p) => p.updateVideo(options)))
    // No SFU vale a qualidade e a prioridade; o codec fica o do começo da transmissão.
    await this.sfuShare?.updateVideo(options)
  }

  stopShare(notify = true) {
    if (!this.localScreen) return
    const stream = this.localScreen
    this.localScreen = null
    this.sharing = false
    this.ink.end()
    stopCapture(stream)
    this.stopSfuShare()
    // Quem assistia precisa clicar de novo numa próxima transmissão.
    this.watchers = {}
    for (const peer of this.peers.values()) peer.sendScreen(null, null)
    if (this.watching === this.connId()) this.watching = null
    if (notify) this.sendState()
  }

  // ---------- Rabiscos na tela ----------

  /** Avisa quem assiste (se dá pra rabiscar na minha tela agora, que apaguei tudo). */
  private broadcastInk(msg: InkMessage) {
    for (const peer of this.peers.values()) peer.sendInk(msg)
  }

  private onInk(connId: string, userId: string, raw: unknown) {
    const msg = cleanInk(raw)
    if (!msg) return
    if (msg.t === 'ink.policy') {
      const { t: _, ...policy } = msg
      this.inkPolicy[connId] = policy
      // Desligou ou parou: a camada de lá fechou, então o meu eco some também.
      if (!msg.allowed) this.inkCleared[connId] = (this.inkCleared[connId] ?? 0) + 1
      return
    }
    if (msg.t === 'ink.clear') {
      this.inkCleared[connId] = (this.inkCleared[connId] ?? 0) + 1
      return
    }
    // Rabisco pra mim: só vale se eu estiver compartilhando e deixando (o InkShare confere).
    this.ink.receive(connId, this.deps.name(userId), userColor(userId), msg)
  }

  /** Rabisco meu na tela de quem eu assisto. */
  sendInk(target: string, msg: InkMessage) {
    this.peers.get(target)?.sendInk(msg)
  }

  // ---------- Câmera ----------

  async toggleCamera() {
    if (this.camera) return this.stopCamera()
    if (!this.channelId) return
    let stream: MediaStream
    try {
      stream = await getCameraStream()
    } catch (err) {
      const name = (err as Error).name
      return this.deps.toast(
        name === 'NotFoundError' ? 'Nenhuma câmera encontrada.' : name === 'NotAllowedError' ? 'Sem acesso à câmera.' : `Não deu pra ligar a câmera: ${(err as Error).message}`,
      )
    }
    // Câmera desconectada (USB) no meio da call: desliga sozinho.
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (this.camera === stream) this.stopCamera()
    })
    this.camera = stream
    this.sendState()
    playSound('unmute')
    await Promise.all(this.peerList.map((p) => p.sendCamera(stream)))
  }

  stopCamera(notify = true) {
    const stream = this.camera
    if (!stream) return
    this.camera = null
    for (const track of stream.getTracks()) track.stop()
    for (const peer of this.peers.values()) peer.sendCamera(null)
    if (notify) {
      this.sendState()
      playSound('mute')
    }
  }

  /** Trocou a câmera nas configurações: troca a imagem sem desligar. */
  async reloadCamera() {
    if (!this.camera) return
    try {
      const stream = await getCameraStream()
      const old = this.camera
      this.camera = stream
      await Promise.all(this.peerList.map((p) => p.sendCamera(stream)))
      for (const track of old.getTracks()) track.stop()
    } catch (err) {
      this.deps.toast(`Não deu pra trocar a câmera: ${(err as Error).message}`)
    }
  }

  private dropCamera(connId: string) {
    if (!(connId in this.cameras)) return
    const { [connId]: _, ...rest } = this.cameras
    this.cameras = rest
  }

  // ---------- Assistir ----------

  watch(connId: string) {
    if (this.watching === connId) return
    this.unwatch()
    this.watching = connId
    if (connId !== this.connId()) this.peers.get(connId)?.requestScreen(true)
  }

  unwatch() {
    const current = this.watching
    if (!current) return
    this.watching = null
    if (current !== this.connId()) {
      if (this.sfuWatch?.connId === current) this.stopSfuWatch()
      this.peers.get(current)?.requestScreen(false)
      this.dropScreen(current)
    }
  }

  private dropScreen(connId: string) {
    if (!(connId in this.screens)) return
    const { [connId]: _, ...rest } = this.screens
    this.screens = rest
  }

  /** Stream que está sendo assistido agora (remoto ou a prévia da minha tela). */
  get watchedStream(): MediaStream | null {
    if (!this.watching) return null
    if (this.watching === this.connId()) return this.localScreen
    return this.screens[this.watching] ?? null
  }

  /** Estatísticas do vídeo assistido (recepção) ou de quem assiste a minha tela (envio). */
  async videoStats(): Promise<{ inbound: VideoStats | null; outbound: { userId: string; stats: VideoStats }[] }> {
    const me = this.connId()
    let inbound: VideoStats | null = null
    if (this.watching && this.watching !== me) {
      inbound = this.viaSfu
        ? ((await this.sfuWatch?.viewer.videoStats()) ?? null)
        : ((await this.peers.get(this.watching)?.videoStats('inbound')) ?? null)
    }
    const outbound: { userId: string; label?: string; stats: VideoStats }[] = []
    if (this.sharing) {
      const sfu = await this.sfuShare?.videoStats()
      const onSfu = Object.keys(this.sfuViewers).length
      if (sfu) outbound.push({ userId: '', label: `Cloudflare (${onSfu} ${onSfu === 1 ? 'pessoa' : 'pessoas'})`, stats: sfu })
      for (const peer of this.peers.values()) {
        if (!this.watchers[peer.connId] || this.sfuViewers[peer.connId]) continue
        const stats = await peer.videoStats('outbound')
        if (stats) outbound.push({ userId: peer.userId, stats })
      }
    }
    return { inbound, outbound }
  }

  /** A tela que eu assisto chega pelo SFU do Cloudflare (não direto). */
  get viaSfu(): boolean {
    return !!this.sfuWatch && this.sfuWatch.connId === this.watching
  }

  // ---------- Tela pelo SFU ----------

  private sfuMinViewers(): number {
    return Math.max(1, settings.sfuMinViewers ?? 2)
  }

  /** Conexões assistindo a minha tela agora. */
  private watcherIds(): string[] {
    return Object.entries(this.watchers)
      .filter(([connId, on]) => on && !this.away[connId])
      .map(([connId]) => connId)
  }

  /** O servidor oferece o SFU? (pergunta de novo de tempos em tempos: a cota pode acabar) */
  private async sfuAvailable(api: Api): Promise<boolean> {
    if (!this.media || Date.now() - this.media.at > MEDIA_TTL) {
      const status = await api.mediaStatus().catch(() => null)
      this.media = { sfu: !!status?.sfu, at: Date.now() }
    }
    return this.media.sfu
  }

  /** 2 ou mais assistindo: publica a tela no SFU e avisa quem assiste. */
  private async maybeSfu() {
    const stream = this.localScreen
    const api = this.deps.api()
    if (!stream || !api || !this.ice || this.sfuShare || this.sfuStarting || this.sfuGaveUp) return
    if (this.watcherIds().length < this.sfuMinViewers()) return
    this.sfuStarting = true
    try {
      if (!(await this.sfuAvailable(api)) || this.localScreen !== stream) return
      const publisher = await SfuPublisher.start(api, stream, this.videoOptions(), this.ice.servers)
      if (this.localScreen !== stream || !this.anyWatcher()) return publisher.close()
      this.sfuShare = publisher
      // Quem já assiste continua com a cópia direta até confirmar que puxou do SFU.
      for (const connId of this.watcherIds()) this.peers.get(connId)?.sendSfuScreen(publisher.info)
    } catch (err) {
      console.warn('[sfu] não deu pra publicar a tela; segue direta', err)
      this.sfuGaveUp = true
    } finally {
      this.sfuStarting = false
    }
  }

  /** Quem chegou depois puxa do SFU; sem resposta (app antigo), vai a cópia direta. */
  private offerSfu(peer: Peer) {
    if (!this.sfuShare) return
    peer.sendSfuScreen(this.sfuShare.info)
    clearTimeout(this.sfuWaiting.get(peer.connId))
    this.sfuWaiting.set(
      peer.connId,
      setTimeout(() => {
        this.sfuWaiting.delete(peer.connId)
        if (this.watchers[peer.connId] && !this.sfuViewers[peer.connId] && this.localScreen) void peer.sendScreen(this.localScreen, this.videoOptions())
      }, SFU_REPLY_WAIT),
    )
  }

  private onSfuReply(connId: string, peer: Peer, ok: boolean) {
    clearTimeout(this.sfuWaiting.get(connId))
    this.sfuWaiting.delete(connId)
    if (!this.localScreen || !this.watchers[connId]) return
    if (ok && this.sfuShare) {
      this.sfuViewers[connId] = true
      void peer.sendScreen(null, null)
    } else {
      delete this.sfuViewers[connId]
      void peer.sendScreen(this.localScreen, this.videoOptions())
    }
  }

  /** Alguém assiste a minha tela (quem caiu por um instante conta: a tela segue pelo SFU). */
  private anyWatcher(): boolean {
    return Object.values(this.watchers).some(Boolean)
  }

  /** Ninguém mais assiste: fecha a publicação no SFU, que codificaria a tela pra ninguém. Com 2 de novo, abre outra. */
  private sfuIdle() {
    if (this.sfuShare && !this.anyWatcher()) this.stopSfuShare()
  }

  private forgetSfuViewer(connId: string) {
    clearTimeout(this.sfuWaiting.get(connId))
    this.sfuWaiting.delete(connId)
    delete this.sfuViewers[connId]
  }

  /** O SFU caiu ou a cota acabou no meio: todo mundo volta pra cópia direta. */
  private leaveSfu(reason: string) {
    if (!this.sfuShare) return
    console.warn('[sfu] voltando pra conexão direta:', reason)
    const stream = this.localScreen
    for (const connId of this.watcherIds()) {
      const peer = this.peers.get(connId)
      peer?.sendSfuScreen(null)
      if (stream && this.sfuViewers[connId]) void peer?.sendScreen(stream, this.videoOptions())
    }
    this.sfuGaveUp = true
    this.stopSfuShare()
  }

  private stopSfuShare() {
    for (const timer of this.sfuWaiting.values()) clearTimeout(timer)
    this.sfuWaiting.clear()
    this.sfuViewers = {}
    this.sfuShare?.close()
    this.sfuShare = null
  }

  /** Quem eu assisto passou a tela pro SFU (ou voltou pra direta, com null). */
  private async onScreenSfu(connId: string, peer: Peer, info: SfuScreen | null) {
    if (!info) {
      if (this.sfuWatch?.connId === connId) this.stopSfuWatch()
      return
    }
    const api = this.deps.api()
    if (this.watching !== connId || !api || !this.ice) return peer.replySfu(false)
    if (this.sfuWatch?.connId === connId) return peer.replySfu(true)
    try {
      const viewer = await SfuViewer.start(api, info, this.ice.servers)
      if (this.watching !== connId) return viewer.close()
      this.stopSfuWatch()
      this.sfuWatch = { connId, viewer }
      this.screens = { ...this.screens, [connId]: viewer.stream }
      peer.replySfu(true)
    } catch (err) {
      console.warn('[sfu] não deu pra puxar a tela; segue direta', err)
      peer.replySfu(false)
    }
  }

  private stopSfuWatch() {
    const current = this.sfuWatch
    if (!current) return
    this.sfuWatch = null
    current.viewer.close()
    if (this.screens[current.connId] === current.viewer.stream) this.dropScreen(current.connId)
  }

  /** Conta pro servidor o que passou pelo Cloudflare (a cada minuto, e ao sair). */
  private async reportMedia(now = false) {
    const api = this.deps.api()
    if (!api || this.mediaBytes <= 0 || (!now && Date.now() - this.mediaReportAt < USAGE_EVERY)) return
    const bytes = this.mediaBytes
    this.mediaBytes = 0
    this.mediaReportAt = Date.now()
    try {
      const { allowed } = await api.mediaUsage(bytes)
      if (!allowed) {
        this.media = { sfu: false, at: Date.now() }
        this.leaveSfu('a cota de mídia do mês acabou')
      }
    } catch {
      this.mediaBytes += bytes
    }
  }

  // ---------- Indicadores ----------

  private startTickers() {
    if (this.ticker) return
    this.ticker = setInterval(() => {
      const me = this.connId()
      const next: Record<string, boolean> = {}
      const talking = !this.muted && !this.serverMuted && !!this.mic?.speaking
      if (me) next[me] = talking
      if (talking) this.lastSpoke = Date.now()
      const selfSpeaking = talking || Date.now() - this.lastSpoke < 400
      if (selfSpeaking !== this.selfSpeaking) this.selfSpeaking = selfSpeaking
      for (const peer of this.peers.values()) next[peer.connId] = !this.deafened && peer.audioLevel() > SPEAKING_REMOTE
      for (const [key, value] of Object.entries(next)) {
        if (this.speaking[key] !== value) this.speaking[key] = value
      }
    }, 100)
    this.statsTicker = setInterval(async () => {
      for (const peer of this.peers.values()) {
        // Oferta que ficou sem resposta (sinalização perdida no caminho): manda de novo.
        peer.resendOffer()
        const stats = await peer.linkStats()
        const prev = this.links[peer.connId]
        if (!prev || prev.rtt !== stats.rtt || prev.route !== stats.route) this.links[peer.connId] = stats
        const relay = stats.relayBytes ?? 0
        this.mediaBytes += Math.max(0, relay - (this.relaySeen.get(peer.connId) ?? 0))
        this.relaySeen.set(peer.connId, relay)
      }
      if (this.sfuWatch) {
        this.mediaBytes += await this.sfuWatch.viewer.newBytes()
        // O SFU caiu: volta pra cópia direta.
        if (this.sfuWatch?.viewer.failed) {
          const { connId } = this.sfuWatch
          this.stopSfuWatch()
          this.peers.get(connId)?.replySfu(false)
        }
      }
      if (this.sfuShare?.failed) this.leaveSfu('a conexão com o SFU caiu')
      void this.reportMedia()
    }, 2000)
  }
}
