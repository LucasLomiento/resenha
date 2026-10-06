import type { SignalData } from '../../../../shared/protocol'
import { tuneScreenOpus } from './sdp'
import type { ScreenMode, VideoCodec } from './settings.svelte'

export interface PeerEvents {
  signal(data: SignalData): void
  /** Tela remota chegando (quando estou assistindo essa pessoa). */
  screen(stream: MediaStream | null): void
  /** Câmera da pessoa chegando. */
  camera(stream: MediaStream): void
  /** A outra pessoa pediu (true) ou largou (false) a minha tela. */
  watchRequest(watching: boolean): void
}

export interface VideoSendOptions {
  bitrate: number
  codec: VideoCodec
  mode: ScreenMode
}

export interface LinkStats {
  rtt: number | null
  route: 'direto' | 'relay' | null
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
  remoteScreen: MediaStream | null = null
  closed = false

  private makingOffer = false
  private ignoreOffer = false
  private settingAnswer = false
  private queue: Promise<void> = Promise.resolve()
  /** Candidatos que chegaram antes da descrição remota (comum quando as ofertas cruzam). */
  private pendingCandidates: RTCIceCandidateInit[] = []
  private localStreams: Record<string, 'mic' | 'screen' | 'camera'> = {}
  private remoteStreams: Record<string, 'mic' | 'screen' | 'camera'> = {}
  private micSender: RTCRtpSender
  private micReceiver: RTCRtpReceiver | null = null
  private screenVideo: RTCRtpTransceiver | null = null
  private screenAudio: RTCRtpTransceiver | null = null
  private cameraVideo: RTCRtpTransceiver | null = null
  private videoOptions: VideoSendOptions | null = null
  private lastIn = { bytes: 0, at: 0, jbDelay: 0, jbCount: 0 }
  private lastOut = { bytes: 0, at: 0, jbDelay: 0, jbCount: 0 }

  constructor(
    readonly connId: string,
    readonly userId: string,
    private polite: boolean,
    iceServers: RTCIceServer[],
    micStream: MediaStream,
    private codec: VideoCodec,
    private events: PeerEvents,
  ) {
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' })
    this.audio.autoplay = true

    this.localStreams[micStream.id] = 'mic'
    this.micSender = this.pc.addTrack(micStream.getAudioTracks()[0], micStream)

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true
        await this.pc.setLocalDescription()
        this.sendDescription()
      } catch (err) {
        console.error('[rtc] oferta falhou', this.connId, err)
      } finally {
        this.makingOffer = false
      }
    }

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.events.signal({ kind: 'candidate', candidate: candidate.toJSON() })
    }

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') this.pc.restartIce()
    }

    this.pc.ontrack = ({ track, streams, receiver, transceiver }) => {
      // Sem buffer extra além do mínimo que o próprio jitter buffer calcular.
      if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0

      const stream = streams[0]
      const kind = stream ? this.remoteStreams[stream.id] : undefined
      if (track.kind === 'audio' && kind !== 'screen') {
        this.micReceiver = receiver
        this.audio.srcObject = new MediaStream([track])
        this.audio.play().catch(() => {})
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

  private sendDescription() {
    const description = this.pc.localDescription
    if (!description) return
    this.events.signal({ kind: 'description', description: description.toJSON(), streams: { ...this.localStreams } })
  }

  /** Sinalização chega em ordem e é processada uma de cada vez. */
  handle(data: SignalData) {
    this.queue = this.queue
      .then(() => this.process(data))
      .catch((err) => console.error('[rtc] sinalização falhou', this.connId, data.kind, err))
  }

  private async process(data: SignalData) {
    if (this.closed) return
    switch (data.kind) {
      case 'description': {
        Object.assign(this.remoteStreams, data.streams)
        const mids = new Set([this.screenAudio?.mid].filter((m): m is string => !!m))
        const description: RTCSessionDescriptionInit = {
          type: data.description.type,
          sdp: tuneScreenOpus(data.description.sdp ?? '', mids),
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
          await this.pc.setLocalDescription()
          this.sendDescription()
        }
        await this.applyVideoParameters()
        return
      }
      case 'candidate':
        if (!data.candidate) return
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
    }
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

  setVolume(volume: number) {
    this.audio.volume = Math.max(0, Math.min(1, volume))
  }

  setDeafened(deafened: boolean) {
    this.audio.muted = deafened
  }

  setOutput(deviceId: string) {
    this.audio.setSinkId(deviceId === 'default' ? '' : deviceId).catch(() => {})
  }

  /** Nível de voz (0..1) do que está chegando, direto do WebRTC, sem WebAudio. */
  audioLevel(): number {
    return this.micReceiver?.getSynchronizationSources()[0]?.audioLevel ?? 0
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

  /**
   * Bitrate, 60 fps e o que sacrificar quando a rede apertar: em "movimento"
   * cai a resolução e mantém os 60 fps; em "nitidez" é o contrário.
   */
  private async applyVideoParameters() {
    const sender = this.screenVideo?.sender
    const options = this.videoOptions
    if (!sender?.track || !options) return
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

  // ---------- Estatísticas ----------

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
    if (!pair) return { rtt: null, route: null }
    const local = report.get(pair.localCandidateId)
    const remote = report.get(pair.remoteCandidateId)
    const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay'
    return {
      rtt: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
      route: relay ? 'relay' : 'direto',
    }
  }

  async videoStats(direction: 'inbound' | 'outbound'): Promise<VideoStats | null> {
    const report = await this.pc.getStats()
    let rtp: any
    report.forEach((s) => {
      if (s.type === `${direction}-rtp` && s.kind === 'video') rtp = s
    })
    if (!rtp) return null

    // Bitrate e jitter buffer pela diferença desde a última leitura, não pela média da sessão.
    const last = direction === 'inbound' ? this.lastIn : this.lastOut
    const bytes = direction === 'inbound' ? rtp.bytesReceived : rtp.bytesSent
    const elapsed = rtp.timestamp - last.at
    const bitrate = last.at && elapsed > 0 ? ((bytes - last.bytes) * 8 * 1000) / elapsed : 0
    const jbCount = (rtp.jitterBufferEmittedCount ?? 0) - last.jbCount
    const jbDelay = (rtp.jitterBufferDelay ?? 0) - last.jbDelay
    Object.assign(last, {
      bytes,
      at: rtp.timestamp,
      jbDelay: rtp.jitterBufferDelay ?? 0,
      jbCount: rtp.jitterBufferEmittedCount ?? 0,
    })

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

  close() {
    this.closed = true
    this.audio.srcObject = null
    this.pc.close()
  }
}
