// Tela pelo SFU do Cloudflare Realtime, quando 2 ou mais pessoas assistem: quem
// compartilha manda e codifica uma cópia só, e o Cloudflare distribui. Com uma
// pessoa só a tela continua direta (P2P), que é de graça e tem menos atraso.
//
// Cada lado tem uma RTCPeerConnection só pro SFU, separada das conexões diretas
// da call (a voz continua P2P). O app não fala com o Cloudflare direto: o nosso
// servidor guarda a chave e repassa (server/src/media.ts).

import type { Api } from './api'
import { applyVideoParameters, codecOrder, videoStatsFrom, type SfuScreen, type StatsMark, type VideoSendOptions, type VideoStats } from './peer'
import { tuneScreenOpus } from './sdp'

const STUN: RTCIceServer = { urls: 'stun:stun.cloudflare.com:3478' }
/** Se a conexão com o SFU não abrir nisso, desiste (e a tela segue direta). */
const CONNECT_TIMEOUT = 10_000

export const SCREEN_VIDEO = 'screen-video'
export const SCREEN_AUDIO = 'screen-audio'

type Session = { sessionId: string; token: string }

/** Só o TURN do Cloudflare (o STUN vai sempre). */
function iceFrom(servers: RTCIceServer[]): RTCIceServer[] {
  const turn = servers.filter((s) => [s.urls].flat().some((url) => String(url).startsWith('turn')))
  return [STUN, ...turn]
}

function connected(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pc.connectionState === 'connected') return resolve()
    const timer = setTimeout(() => {
      pc.removeEventListener('connectionstatechange', check)
      reject(new Error('o SFU não conectou'))
    }, CONNECT_TIMEOUT)
    const check = () => {
      if (pc.connectionState === 'connected') {
        clearTimeout(timer)
        pc.removeEventListener('connectionstatechange', check)
        resolve()
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        clearTimeout(timer)
        pc.removeEventListener('connectionstatechange', check)
        reject(new Error(`conexão com o SFU: ${pc.connectionState}`))
      }
    }
    pc.addEventListener('connectionstatechange', check)
  })
}

/** Quem compartilha: publica a tela (vídeo e som) uma vez no SFU. */
export class SfuPublisher {
  private mark: StatsMark = { bytes: 0, at: 0, jbDelay: 0, jbCount: 0 }
  private closed = false

  private constructor(
    private api: Api,
    private pc: RTCPeerConnection,
    private session: Session,
    private video: RTCRtpTransceiver,
    private mids: string[],
    readonly info: SfuScreen,
    /** Codec negociado no começo: quem assiste puxou com ele, então não muda no meio. */
    private codec: VideoSendOptions['codec'],
  ) {}

  static async start(api: Api, stream: MediaStream, options: VideoSendOptions, ice: RTCIceServer[]): Promise<SfuPublisher> {
    const [videoTrack] = stream.getVideoTracks()
    const [audioTrack] = stream.getAudioTracks()
    if (!videoTrack) throw new Error('sem vídeo pra publicar')
    const session = await api.sfuSession()
    const pc = new RTCPeerConnection({ iceServers: iceFrom(ice), bundlePolicy: 'max-bundle' })
    try {
      const video = pc.addTransceiver(videoTrack, { direction: 'sendonly', streams: [stream] })
      try {
        video.setCodecPreferences(codecOrder(options.codec))
      } catch {
        // codec indisponível: fica o padrão
      }
      const audio = audioTrack ? pc.addTransceiver(audioTrack, { direction: 'sendonly', streams: [stream] }) : null
      await pc.setLocalDescription(await pc.createOffer())
      const tracks = [{ mid: video.mid!, trackName: SCREEN_VIDEO }, ...(audio ? [{ mid: audio.mid!, trackName: SCREEN_AUDIO }] : [])]
      const { sdp } = await api.sfuPush(session, pc.localDescription!.sdp, tracks)
      // Som da tela em estéreo e com bitrate de música (quem recebe põe o estéreo na ponta dele).
      await pc.setRemoteDescription({ type: 'answer', sdp: audio ? tuneScreenOpus(sdp, new Set([audio.mid!])) : sdp })
      await applyVideoParameters(video.sender, options)
      if (audio) {
        const params = audio.sender.getParameters()
        if (params.encodings?.length) {
          params.encodings[0].maxBitrate = 160_000
          await audio.sender.setParameters(params).catch(() => {})
        }
      }
      await connected(pc)
      const info = { session: session.sessionId, video: SCREEN_VIDEO, audio: audio ? SCREEN_AUDIO : null }
      return new SfuPublisher(api, pc, session, video, tracks.map((t) => t.mid), info, options.codec)
    } catch (err) {
      pc.close()
      throw err
    }
  }

  /**
   * Qualidade ou prioridade mudaram no meio da transmissão. O codec fica o do começo:
   * trocar pelo setParameters mudaria o que chega no SFU, e quem assiste (que negociou
   * o codec antigo com o Cloudflare) não decodificaria mais.
   */
  async updateVideo(options: VideoSendOptions) {
    if (!this.closed) await applyVideoParameters(this.video.sender, { ...options, codec: this.codec })
  }

  async videoStats(): Promise<VideoStats | null> {
    return this.closed ? null : videoStatsFrom(await this.pc.getStats(), 'outbound', this.mark)
  }

  get failed(): boolean {
    return this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed'
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.pc.close()
    void this.api.sfuClose(this.session, this.mids).catch(() => {})
  }
}

/** Quem assiste: puxa a tela de quem publicou. */
export class SfuViewer {
  readonly stream = new MediaStream()
  private mark: StatsMark = { bytes: 0, at: 0, jbDelay: 0, jbCount: 0 }
  private counted = 0
  private closed = false

  private constructor(
    private api: Api,
    private pc: RTCPeerConnection,
    private session: Session,
    private mids: string[],
  ) {}

  static async start(api: Api, info: SfuScreen, ice: RTCIceServer[]): Promise<SfuViewer> {
    const session = await api.sfuSession()
    const pc = new RTCPeerConnection({ iceServers: iceFrom(ice), bundlePolicy: 'max-bundle' })
    const viewer = new SfuViewer(api, pc, session, [])
    pc.ontrack = (event) => {
      viewer.stream.addTrack(event.track)
      // Menos atraso: o jitter buffer no mínimo, como na conexão direta.
      if ('jitterBufferTarget' in event.receiver) (event.receiver as RTCRtpReceiver & { jitterBufferTarget: number }).jitterBufferTarget = 0
    }
    try {
      const remote = [{ sessionId: info.session, trackName: info.video }, ...(info.audio ? [{ sessionId: info.session, trackName: info.audio }] : [])]
      const pulled = await api.sfuPull(session, remote)
      if (!pulled.sdp) throw new Error('o SFU não mandou a oferta')
      viewer.mids = pulled.tracks.map((t) => t.mid)
      await pc.setRemoteDescription({ type: 'offer', sdp: pulled.sdp })
      const answer = await pc.createAnswer()
      // Quem recebe precisa de stereo=1 no SDP dele, senão o som da tela chega mono.
      const audioMid = pulled.tracks.find((t) => t.trackName === info.audio)?.mid
      const sdp = audioMid ? tuneScreenOpus(answer.sdp ?? '', new Set([audioMid])) : (answer.sdp ?? '')
      await pc.setLocalDescription({ type: 'answer', sdp })
      await api.sfuRenegotiate(session, sdp)
      await connected(pc)
      if (!viewer.stream.getVideoTracks().length) throw new Error('o SFU não mandou o vídeo')
      return viewer
    } catch (err) {
      viewer.close()
      throw err
    }
  }

  async videoStats(): Promise<VideoStats | null> {
    return this.closed ? null : videoStatsFrom(await this.pc.getStats(), 'inbound', this.mark)
  }

  /** Bytes recebidos do SFU desde a última vez que contou (pra cota do mês). */
  async newBytes(): Promise<number> {
    if (this.closed) return 0
    let total = 0
    ;(await this.pc.getStats()).forEach((s) => {
      // Com os cabeçalhos: o Cloudflare cobra o pacote inteiro.
      if (s.type === 'inbound-rtp') total += ((s as RTCInboundRtpStreamStats).bytesReceived ?? 0) + ((s as RTCInboundRtpStreamStats & { headerBytesReceived?: number }).headerBytesReceived ?? 0)
    })
    const fresh = Math.max(0, total - this.counted)
    this.counted = total
    return fresh
  }

  get failed(): boolean {
    return this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed'
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const track of this.stream.getTracks()) track.stop()
    this.pc.close()
    if (this.mids.length) void this.api.sfuClose(this.session, this.mids).catch(() => {})
  }
}
