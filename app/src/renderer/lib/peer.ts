import type { SignalData, StreamKind } from '../../../../shared/protocol'
import { boostContext, setBoostOutput } from './boost'
import type { PathSample } from './route'
import { audioMidsOf, candidateFamily, ipFamily, keepFamily, tuneScreenOpus, type IpFamily } from './sdp'
import type { ScreenMode, VideoCodec } from './settings.svelte'

/** Sinalização sem os ids das conexões (o Peer põe na hora de mandar). */
type Signal = SignalData extends infer T ? (T extends unknown ? Omit<T, 'pc' | 'ack'> : never) : never

export interface PeerEvents {
  signal(data: SignalData): void
  /** Tela remota chegando (quando estou assistindo essa pessoa). */
  screen(stream: MediaStream | null): void
  /** Câmera da pessoa chegando. */
  camera(stream: MediaStream): void
  /** A outra pessoa pediu (true) ou largou (false) a minha tela. */
  watchRequest(watching: boolean): void
  /** Chegou algo pelo canal dos rabiscos (sem conferir: quem recebe confere). */
  ink(data: unknown): void
  /** O canal dos rabiscos abriu (dá pra mandar a permissão). */
  inkOpen(): void
  /** Quem compartilha passou a tela pro SFU (null: voltou pra conexão direta). */
  screenSfu(info: SfuScreen | null): void
  /** Quem assiste conseguiu puxar do SFU (a cópia direta pode parar) ou não. */
  screenSfuReply(ok: boolean): void
  /** Chegou algo pelo canal do bot do Spotify (sem conferir: quem recebe confere). */
  music(data: unknown): void
  /** O outro app entende o bot do Spotify (mandou "hello"): já dá pra mandar a faixa dele. */
  musicReady(): void
  /** O ICE não achou caminho (a conexão tenta de novo sozinha). */
  failed(): void
}

/** Onde puxar a tela no SFU do Cloudflare: sessão de quem publicou e os nomes das faixas. */
export interface SfuScreen {
  session: string
  video: string
  audio: string | null
}

export interface VideoSendOptions {
  bitrate: number
  codec: VideoCodec
  mode: ScreenMode
}

export interface LinkStats {
  rtt: number | null
  route: 'direto' | 'relay' | null
  /** Bytes que passaram pelo TURN do Cloudflare (enviados + recebidos), pra cota do mês. */
  relayBytes?: number
  /** Família de IP do caminho direto em uso. */
  family?: IpFamily | null
  /** Último ping medido de cada família com caminho direto (o ICE testa as duas), pra escolher a rota. */
  paths?: Partial<Record<IpFamily, PathSample>>
}

export interface VideoStats {
  width: number
  height: number
  fps: number
  bitrate: number
  codec: string
  implementation: string
  /** Só na recepção: atraso médio no jitter buffer (ms). */
  jitterBuffer?: number
  /** Só no envio: por que a qualidade está limitada (cpu, bandwidth, none). */
  limitation?: string
  dropped?: number
}

export function codecOrder(preferred: VideoCodec): RTCRtpCodec[] {
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? []
  const wanted = `video/${preferred}`.toLowerCase()
  return [...codecs.filter((c) => c.mimeType.toLowerCase() === wanted), ...codecs.filter((c) => c.mimeType.toLowerCase() !== wanted)]
}

/**
 * Bitrate, 60 fps e o que sacrificar quando a rede apertar: em "movimento"
 * cai a resolução e mantém os 60 fps; em "nitidez" é o contrário. Vale pra
 * conexão direta e pro SFU.
 */
export async function applyVideoParameters(sender: RTCRtpSender, options: VideoSendOptions) {
  const build = (withCodec: boolean) => {
    const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string }
    if (!params.encodings?.length) return null
    params.degradationPreference = options.mode === 'motion' ? 'maintain-framerate' : 'maintain-resolution'
    const encoding = params.encodings[0] as RTCRtpEncodingParameters & { codec?: RTCRtpCodec }
    encoding.maxBitrate = options.bitrate
    encoding.maxFramerate = 60
    encoding.scaleResolutionDownBy = 1
    encoding.priority = 'high'
    encoding.networkPriority = 'high'
    if (withCodec) {
      const preferred = params.codecs?.find((c) => c.mimeType.toLowerCase() === `video/${options.codec}`.toLowerCase())
      if (preferred) encoding.codec = preferred
    }
    return params
  }
  for (const withCodec of [true, false]) {
    const params = build(withCodec)
    if (!params) return
    try {
      await sender.setParameters(params)
      return
    } catch (err) {
      if (!withCodec) console.warn('[rtc] setParameters falhou', err)
    }
  }
}

/** Leitura anterior, pra bitrate e jitter buffer serem do último intervalo (não da sessão toda). */
export interface StatsMark {
  bytes: number
  at: number
  jbDelay: number
  jbCount: number
}

export function videoStatsFrom(report: RTCStatsReport, direction: 'inbound' | 'outbound', last: StatsMark): VideoStats | null {
  let rtp: any
  report.forEach((s) => {
    if (s.type === `${direction}-rtp` && s.kind === 'video') rtp = s
  })
  if (!rtp) return null
  const bytes = direction === 'inbound' ? rtp.bytesReceived : rtp.bytesSent
  const elapsed = rtp.timestamp - last.at
  const bitrate = last.at && elapsed > 0 ? ((bytes - last.bytes) * 8 * 1000) / elapsed : 0
  const jbCount = (rtp.jitterBufferEmittedCount ?? 0) - last.jbCount
  const jbDelay = (rtp.jitterBufferDelay ?? 0) - last.jbDelay
  Object.assign(last, { bytes, at: rtp.timestamp, jbDelay: rtp.jitterBufferDelay ?? 0, jbCount: rtp.jitterBufferEmittedCount ?? 0 })
  const codec = report.get(rtp.codecId)
  return {
    width: rtp.frameWidth ?? 0,
    height: rtp.frameHeight ?? 0,
    fps: Math.round(rtp.framesPerSecond ?? 0),
    bitrate,
    codec: codec?.mimeType?.replace('video/', '') ?? '?',
    implementation: (direction === 'inbound' ? rtp.decoderImplementation : rtp.encoderImplementation) ?? '?',
    jitterBuffer: direction === 'inbound' && jbCount > 0 ? Math.round((jbDelay / jbCount) * 1000) : undefined,
    limitation: direction === 'outbound' ? rtp.qualityLimitationReason : undefined,
    dropped: direction === 'inbound' ? rtp.framesDropped : undefined,
  }
}

/**
 * Conexão WebRTC direta com uma pessoa da call.
 *
 * Usa o padrão "perfect negotiation": os dois lados podem renegociar a
 * qualquer momento e, se as ofertas cruzarem, o lado "educado" (polite) cede.
 * O microfone vai desde o começo; a tela só entra quando a pessoa pede pra
 * assistir, pra não gastar upload nem CPU à toa.
 */
export class Peer {
  readonly pc: RTCPeerConnection
  readonly audio = new Audio()
  /** O Spotify que essa pessoa pôs na call: toca à parte, no volume que eu escolher pro bot. */
  readonly musicAudio = new Audio()
  /** O outro app entende o bot do Spotify (só ele recebe a faixa: app antigo tocaria no lugar da voz). */
  musicCapable = false
  /** Id desta RTCPeerConnection: vai em toda sinalização, pra cada lado saber se o outro recomeçou. */
  readonly id = crypto.randomUUID().slice(0, 13)
  /** Id da conexão do outro lado (null até a primeira mensagem dele). */
  remoteId: string | null = null
  remoteScreen: MediaStream | null = null
  closed = false
  /** Quando mandei a última oferta (pra reenviar se a resposta se perder). */
  private offerSentAt = 0
  /** Canal dos rabiscos na tela (direto entre os dois, sem passar pelo servidor). */
  private inkChannel: RTCDataChannel
  /** Canal do bot do Spotify: o que toca, pedidos e respostas (direto entre os dois). */
  private musicChannel: RTCDataChannel

  private makingOffer = false
  private ignoreOffer = false
  private settingAnswer = false
  private queue: Promise<void> = Promise.resolve()
  /** Candidatos que chegaram antes da descrição remota (comum quando as ofertas cruzam). */
  private pendingCandidates: RTCIceCandidateInit[] = []
  private localStreams: Record<string, StreamKind> = {}
  private remoteStreams: Record<string, StreamKind> = {}
  private micSender: RTCRtpSender
  private micReceiver: RTCRtpReceiver | null = null
  private musicReceiver: RTCRtpReceiver | null = null
  private musicTx: RTCRtpTransceiver | null = null
  /** Volume da voz dessa pessoa pra mim (0..2) e se estou surdo. */
  private volume = 1
  private deafened = false
  /** Acima de 100%: a voz toca por aqui (ganho do WebAudio) e o elemento fica mudo. */
  private boost: { stream: MediaStream; source: MediaStreamAudioSourceNode; gain: GainNode } | null = null
  private screenVideo: RTCRtpTransceiver | null = null
  private screenAudio: RTCRtpTransceiver | null = null
  private cameraVideo: RTCRtpTransceiver | null = null
  private videoOptions: VideoSendOptions | null = null
  private lastIn = { bytes: 0, at: 0, jbDelay: 0, jbCount: 0 }
  private lastOut = { bytes: 0, at: 0, jbDelay: 0, jbCount: 0 }
  /**
   * Rota: só essa família de IP vale nos candidatos (null: as duas, como o Chromium preferir).
   * Fica fixa na conexão: o ICE não larga um caminho que ainda funciona (nem refazendo o ICE),
   * então trocar de rota é refazer a conexão.
   */
  private family: IpFamily | null
  /** Respostas e ping somado de cada par direto na leitura anterior (a diferença é o ping recente). */
  private pairMarks = new Map<string, { responses: number; total: number }>()
  private paths: Partial<Record<IpFamily, PathSample>> = {}

  constructor(
    readonly connId: string,
    readonly userId: string,
    /** Cede quando as ofertas cruzam. O outro lado (o que não cede) é quem escolhe a rota. */
    readonly polite: boolean,
    ice: { servers: RTCIceServer[]; relay: boolean; family?: IpFamily | null },
    micStream: MediaStream,
    private codec: VideoCodec,
    private events: PeerEvents,
  ) {
    this.family = ice.relay ? null : (ice.family ?? null)
    // Sala pelo Cloudflare: só caminhos pelo TURN dele (nada direto entre os PCs).
    this.pc = new RTCPeerConnection({
      iceServers: ice.servers,
      iceTransportPolicy: ice.relay ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    })
    this.audio.autoplay = true
    this.musicAudio.autoplay = true

    this.localStreams[micStream.id] = 'mic'
    this.micSender = this.pc.addTrack(micStream.getAudioTracks()[0], micStream)

    // Combinado dos dois lados (mesmo id): não depende de quem fez a oferta.
    this.inkChannel = this.pc.createDataChannel('ink', { negotiated: true, id: 2, ordered: true })
    this.inkChannel.onopen = () => this.events.inkOpen()
    this.inkChannel.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 64_000) return
      try {
        this.events.ink(JSON.parse(event.data))
      } catch {
        // mensagem quebrada
      }
    }

    this.musicChannel = this.pc.createDataChannel('music', { negotiated: true, id: 3, ordered: true })
    this.musicChannel.onopen = () => this.musicChannel.send(JSON.stringify({ t: 'hello' }))
    this.musicChannel.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 256_000) return
      let data: unknown
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }
      if ((data as { t?: unknown })?.t !== 'hello') return this.events.music(data)
      if (this.musicCapable) return
      this.musicCapable = true
      this.events.musicReady()
    }

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true
        await this.setLocal('offer')
        this.sendDescription()
      } catch (err) {
        console.error('[rtc] oferta falhou', this.connId, err)
      } finally {
        this.makingOffer = false
      }
    }

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.allows(candidate.candidate)) this.emit({ kind: 'candidate', candidate: candidate.toJSON() })
    }

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState !== 'failed') return
      this.pc.restartIce()
      this.events.failed()
    }

    this.pc.ontrack = ({ track, streams, receiver, transceiver }) => {
      // Sem buffer extra além do mínimo que o próprio jitter buffer calcular.
      if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0

      const stream = streams[0]
      const kind = stream ? this.remoteStreams[stream.id] : undefined
      if (track.kind === 'audio' && kind === 'music') {
        this.musicReceiver = receiver
        this.musicAudio.srcObject = new MediaStream([track])
        this.musicAudio.play().catch(() => {})
        return
      }
      if (track.kind === 'audio' && kind !== 'screen') {
        this.micReceiver = receiver
        this.audio.srcObject = new MediaStream([track])
        this.audio.play().catch(() => {})
        this.applyVoice()
        return
      }
      if (track.kind === 'video') {
        try {
          transceiver.setCodecPreferences(codecOrder(this.codec))
        } catch {
          // sem suporte: fica a ordem padrão
        }
      }
      if (kind === 'camera') {
        this.events.camera(stream ?? new MediaStream([track]))
        return
      }
      this.remoteScreen = stream ?? new MediaStream([track])
      this.events.screen(this.remoteScreen)
    }
  }

  private emit(data: Signal) {
    this.events.signal({ ...data, pc: this.id, ack: this.remoteId } as SignalData)
  }

  private sendDescription() {
    const description = this.pc.localDescription
    if (!description) return
    if (description.type === 'offer') this.offerSentAt = Date.now()
    const json = description.toJSON()
    if (this.family && json.sdp) json.sdp = keepFamily(json.sdp, this.family)
    this.emit({ kind: 'description', description: json, streams: { ...this.localStreams } })
  }

  /**
   * Candidato que pode entrar (pra lá e pra cá): com a rota presa numa família, os da outra
   * ficam de fora dos dois lados, e o ICE só acha caminho por ela.
   */
  private allows(candidate: string): boolean {
    if (!this.family) return true
    const family = candidateFamily(candidate)
    return family === null || family === this.family
  }

  /**
   * Oferta sem resposta há um tempo (a sinalização caiu no caminho): manda de
   * novo. Quem recebe a mesma oferta duas vezes só responde de novo.
   */
  resendOffer(force = false) {
    if (this.closed || this.pc.signalingState !== 'have-local-offer') return
    if (!force && Date.now() - this.offerSentAt < 5000) return
    this.sendDescription()
  }

  /** Manda pelo canal dos rabiscos (se ainda não abriu, perde: o traço seguinte vai). */
  sendInk(data: unknown): boolean {
    if (this.closed || this.inkChannel.readyState !== 'open') return false
    this.inkChannel.send(JSON.stringify(data))
    return true
  }

  /** Conta pra quem assiste de onde puxar a minha tela no SFU (null: voltou pra conexão direta). */
  sendSfuScreen(info: SfuScreen | null) {
    if (!this.closed) this.emit({ kind: 'screen-sfu', session: info?.session ?? null, video: info?.video, audio: info?.audio ?? null })
  }

  /** Respondo se consegui puxar a tela do SFU. */
  replySfu(ok: boolean) {
    if (!this.closed) this.emit({ kind: 'screen-sfu-reply', ok })
  }

  /** Pede (ou larga) a tela dessa pessoa. */
  requestScreen(watching: boolean) {
    if (!this.closed) this.emit({ kind: watching ? 'watch' : 'unwatch' })
  }

  /** Sinalização chega em ordem e é processada uma de cada vez. */
  handle(data: SignalData) {
    if (data.pc && !this.remoteId) this.remoteId = data.pc
    this.queue = this.queue
      .then(() => this.process(data))
      .catch((err) => console.error('[rtc] sinalização falhou', this.connId, data.kind, err))
  }

  private async process(data: SignalData) {
    if (this.closed) return
    switch (data.kind) {
      case 'description': {
        Object.assign(this.remoteStreams, data.streams)
        const mids = new Set([this.screenAudio?.mid, this.musicTx?.mid].filter((m): m is string => !!m))
        const sdp = data.description.sdp ?? ''
        const description: RTCSessionDescriptionInit = {
          type: data.description.type,
          sdp: tuneScreenOpus(this.family ? keepFamily(sdp, this.family) : sdp, mids),
        }
        const readyForOffer = !this.makingOffer && (this.pc.signalingState === 'stable' || this.settingAnswer)
        const collision = description.type === 'offer' && !readyForOffer
        this.ignoreOffer = !this.polite && collision
        if (this.ignoreOffer) return

        this.settingAnswer = description.type === 'answer'
        await this.pc.setRemoteDescription(description)
        this.settingAnswer = false
        await this.flushCandidates()
        if (description.type === 'offer') {
          await this.setLocal('answer')
          this.sendDescription()
        }
        await this.applyVideoParameters()
        return
      }
      case 'candidate':
        if (!data.candidate || !this.allows(data.candidate.candidate ?? '')) return
        // Sem descrição remota ainda o Chromium recusa e o candidato se perderia;
        // guarda e aplica logo depois. Perder candidatos aqui pode custar a conexão direta.
        if (!this.pc.remoteDescription) {
          this.pendingCandidates.push(data.candidate)
          return
        }
        try {
          await this.pc.addIceCandidate(data.candidate)
        } catch (err) {
          if (!this.ignoreOffer) console.warn('[rtc] candidato ICE recusado', err)
        }
        return
      case 'watch':
        return this.events.watchRequest(true)
      case 'unwatch':
        return this.events.watchRequest(false)
      case 'screen-sfu':
        return this.events.screenSfu(
          data.session && typeof data.video === 'string' ? { session: data.session, video: data.video, audio: data.audio ?? null } : null,
        )
      case 'screen-sfu-reply':
        return this.events.screenSfuReply(data.ok === true)
    }
  }

  /**
   * Cria e aplica a descrição local pedindo estéreo no áudio de tela (e no do
   * Spotify) que eu recebo: sem isso o Chromium decodifica em mono, mesmo chegando estéreo.
   */
  private async setLocal(type: 'offer' | 'answer') {
    const created = type === 'offer' ? await this.pc.createOffer() : await this.pc.createAnswer()
    const remote = this.pc.remoteDescription?.sdp ?? ''
    const mids = audioMidsOf(remote, (streamId) => this.remoteStreams[streamId] === 'screen' || this.remoteStreams[streamId] === 'music')
    await this.pc.setLocalDescription(mids.size ? { type, sdp: tuneScreenOpus(created.sdp ?? '', mids) } : created)
  }

  private async flushCandidates() {
    const pending = this.pendingCandidates
    this.pendingCandidates = []
    for (const candidate of pending) {
      try {
        await this.pc.addIceCandidate(candidate)
      } catch (err) {
        console.warn('[rtc] candidato guardado recusado', err)
      }
    }
  }

  // ---------- Microfone ----------

  replaceMic(track: MediaStreamTrack) {
    return this.micSender.replaceTrack(track)
  }

  /** 0..2: acima de 1 (100%) a voz é amplificada dentro do app. */
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(2, volume))
    this.applyVoice()
  }

  setDeafened(deafened: boolean) {
    this.deafened = deafened
    this.applyVoice()
    this.musicAudio.muted = deafened
  }

  setOutput(deviceId: string) {
    const sink = deviceId === 'default' ? '' : deviceId
    this.audio.setSinkId(sink).catch(() => {})
    this.musicAudio.setSinkId(sink).catch(() => {})
    setBoostOutput(deviceId)
  }

  /**
   * Até 100%, o próprio elemento toca no volume escolhido. Acima, ele fica mudo
   * (mas ligado: sem ele o Chromium não entrega o som da conexão pro WebAudio)
   * e a voz passa por um ganho.
   */
  private applyVoice() {
    const loud = this.volume > 1
    this.audio.volume = Math.min(1, this.volume)
    this.audio.muted = this.deafened || loud
    const stream = this.audio.srcObject as MediaStream | null
    if (!loud || this.deafened || !stream || this.closed) return this.dropBoost()
    if (this.boost?.stream !== stream) {
      this.dropBoost()
      const ctx = boostContext()
      const source = ctx.createMediaStreamSource(stream)
      const gain = ctx.createGain()
      source.connect(gain).connect(ctx.destination)
      this.boost = { stream, source, gain }
    }
    this.boost.gain.gain.value = this.volume
  }

  private dropBoost() {
    if (!this.boost) return
    this.boost.source.disconnect()
    this.boost.gain.disconnect()
    this.boost = null
  }

  /** Nível de voz (0..1) do que está chegando, direto do WebRTC, sem WebAudio. */
  audioLevel(): number {
    return this.micReceiver?.getSynchronizationSources()[0]?.audioLevel ?? 0
  }

  // ---------- Bot do Spotify ----------

  setMusicVolume(volume: number) {
    this.musicAudio.volume = Math.max(0, Math.min(1, volume))
  }

  /** Nível do Spotify que essa pessoa pôs (0..1), pro bloco do bot "acender" como quem fala. */
  musicLevel(): number {
    return this.musicReceiver?.getSynchronizationSources()[0]?.audioLevel ?? 0
  }

  /** Manda pelo canal do bot (se ainda não abriu, perde: o próximo estado vai inteiro). */
  sendMusicData(data: unknown): boolean {
    if (this.closed || this.musicChannel.readyState !== 'open') return false
    this.musicChannel.send(JSON.stringify(data))
    return true
  }

  /** Começa (ou para, com null) de mandar o som do meu bot do Spotify: estéreo, como música. */
  async sendMusic(stream: MediaStream | null) {
    if (stream) this.localStreams[stream.id] = 'music'
    this.musicTx = await this.setSending(
      this.musicTx,
      stream?.getAudioTracks()[0] ?? null,
      stream,
      // Abaixo da voz: se a rede apertar, a música cede primeiro.
      { maxBitrate: 160_000, priority: 'medium', networkPriority: 'medium' },
      null,
    )
  }

  // ---------- Tela ----------

  async sendScreen(stream: MediaStream | null, options: VideoSendOptions | null) {
    this.videoOptions = options
    if (stream) this.localStreams[stream.id] = 'screen'
    const video = stream?.getVideoTracks()[0] ?? null
    const audio = stream?.getAudioTracks()[0] ?? null
    const live = options && stream
    this.screenVideo = await this.setSending(
      this.screenVideo,
      live ? video : null,
      stream,
      options ? { maxBitrate: options.bitrate, maxFramerate: 60, priority: 'high', networkPriority: 'high' } : {},
      options?.codec ?? null,
    )
    this.screenAudio = await this.setSending(
      this.screenAudio,
      live ? audio : null,
      stream,
      { maxBitrate: 160_000, priority: 'high', networkPriority: 'high' },
      null,
    )
    await this.applyVideoParameters()
  }

  // ---------- Câmera ----------

  /** A câmera vai pra todo mundo da call (como no Discord), em 720p30 e até 1,5 Mbps. */
  async sendCamera(stream: MediaStream | null) {
    if (stream) this.localStreams[stream.id] = 'camera'
    this.cameraVideo = await this.setSending(
      this.cameraVideo,
      stream?.getVideoTracks()[0] ?? null,
      stream,
      { maxBitrate: 1_500_000, maxFramerate: 30, priority: 'medium', networkPriority: 'medium' },
      this.codec,
    )
  }

  private async setSending(
    transceiver: RTCRtpTransceiver | null,
    track: MediaStreamTrack | null,
    stream: MediaStream | null,
    encoding: RTCRtpEncodingParameters,
    codec: VideoCodec | null,
  ): Promise<RTCRtpTransceiver | null> {
    if (!track || !stream) {
      if (transceiver && transceiver.direction !== 'inactive') {
        await transceiver.sender.replaceTrack(null)
        transceiver.direction = 'inactive'
      }
      return transceiver
    }
    if (transceiver) {
      // Reaproveita o mesmo m-line em vez de criar outro a cada vez que assistem.
      await transceiver.sender.replaceTrack(track)
      transceiver.sender.setStreams(stream)
      transceiver.direction = 'sendonly'
      return transceiver
    }
    const created = this.pc.addTransceiver(track, { direction: 'sendonly', streams: [stream], sendEncodings: [encoding] })
    if (track.kind === 'video' && codec) {
      try {
        created.setCodecPreferences(codecOrder(codec))
      } catch {
        // sem suporte
      }
    }
    return created
  }

  /** Troca qualidade, prioridade ou codec da tela que já está sendo enviada, sem renegociar. */
  async updateVideo(options: VideoSendOptions) {
    if (!this.screenVideo?.sender.track) return
    this.videoOptions = options
    try {
      this.screenVideo.setCodecPreferences(codecOrder(options.codec))
    } catch {
      // vale pra próxima negociação; a troca imediata é pelo setParameters abaixo
    }
    await this.applyVideoParameters()
  }

  private async applyVideoParameters() {
    const sender = this.screenVideo?.sender
    if (sender?.track && this.videoOptions) await applyVideoParameters(sender, this.videoOptions)
  }

  async linkStats(): Promise<LinkStats> {
    const report = await this.pc.getStats()
    let pair: RTCIceCandidatePairStats | undefined
    report.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = report.get(s.selectedCandidatePairId)
    })
    if (!pair) {
      report.forEach((s) => {
        if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s
      })
    }
    this.measurePaths(report)
    if (!pair) return { rtt: null, route: null, paths: { ...this.paths } }
    const local = report.get(pair.localCandidateId)
    const remote = report.get(pair.remoteCandidateId)
    const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay'
    return {
      rtt: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
      route: relay ? 'relay' : 'direto',
      // O TURN cobra o que sai dele: nos dois sentidos, quando o meu lado passa por ele.
      relayBytes: local?.candidateType === 'relay' ? (pair.bytesSent ?? 0) + (pair.bytesReceived ?? 0) : 0,
      family: relay ? null : (ipFamily(local?.address ?? local?.ip) ?? ipFamily(remote?.address ?? remote?.ip)),
      paths: { ...this.paths },
    }
  }

  /**
   * Ping de cada família de IP pelos pares diretos que funcionam: o em uso é testado a cada
   * poucos segundos e o reserva (da outra família) a cada 15 a 25 s. Cada resposta nova vira
   * uma amostra.
   */
  private measurePaths(report: RTCStatsReport) {
    const marks = new Map<string, { responses: number; total: number }>()
    const now = Date.now()
    const best: Partial<Record<IpFamily, number>> = {}
    report.forEach((s) => {
      if (s.type !== 'candidate-pair' || s.state !== 'succeeded') return
      const local = report.get(s.localCandidateId)
      const remote = report.get(s.remoteCandidateId)
      if (!local || !remote || local.candidateType === 'relay' || remote.candidateType === 'relay') return
      const family = ipFamily(local.address ?? local.ip)
      if (!family) return
      const responses = s.responsesReceived ?? 0
      const total = s.totalRoundTripTime ?? 0
      marks.set(s.id, { responses, total })
      const prev = this.pairMarks.get(s.id) ?? { responses: 0, total: 0 }
      if (responses <= prev.responses) return
      const rtt = ((total - prev.total) / (responses - prev.responses)) * 1000
      best[family] = Math.min(best[family] ?? Infinity, rtt)
    })
    this.pairMarks = marks
    for (const [family, rtt] of Object.entries(best) as [IpFamily, number][]) this.paths[family] = { rtt, at: now }
  }

  async videoStats(direction: 'inbound' | 'outbound'): Promise<VideoStats | null> {
    return videoStatsFrom(await this.pc.getStats(), direction, direction === 'inbound' ? this.lastIn : this.lastOut)
  }

  /**
   * Troca a política e os servidores e refaz o ICE, sem derrubar a conexão. Sozinho não tira
   * a conexão de um caminho que ainda funciona (o ICE fica nele): quem conduz a negociação
   * refaz a conexão (`Call.rebuildPeer`), e esta só deixa a do outro lado configurada igual.
   */
  setRelay(relay: boolean, servers: RTCIceServer[]) {
    if (this.closed) return
    this.pc.setConfiguration({ ...this.pc.getConfiguration(), iceServers: servers, iceTransportPolicy: relay ? 'relay' : 'all' })
    this.pc.restartIce()
  }

  close() {
    this.closed = true
    this.dropBoost()
    this.audio.srcObject = null
    this.musicAudio.srcObject = null
    this.pc.close()
  }
}
