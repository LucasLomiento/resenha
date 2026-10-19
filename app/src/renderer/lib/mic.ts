// Microfone -> processador (RNNoise + limiar) -> faixa que vai pra call.

import { LevelMeter } from './media'
import type { MicOptions } from './mic-worklet'
import workletUrl from './mic-worklet.ts?worker&url'
import { settings } from './settings.svelte'

export type { MicOptions }

export function micOptions(): MicOptions {
  return {
    denoise: settings.noiseReduction === 'rnnoise',
    gate: settings.gate.enabled,
    auto: settings.gate.auto,
    thresholdDb: settings.gate.thresholdDb,
  }
}

let context: AudioContext | null = null
let loading: Promise<void> | null = null
/** Microfones abertos neste contexto: sem nenhum (fora da call), ele dorme e não segura a saída de som (nem o fone Bluetooth) acordada. */
let users = 0

async function audioContext(): Promise<AudioContext> {
  // 48 kHz: é a taxa que o RNNoise espera (blocos de 480 = 10 ms).
  context ??= new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' })
  if (context.state === 'suspended') await context.resume().catch(() => {})
  loading ??= context.audioWorklet.addModule(workletUrl)
  await loading
  return context
}

function release() {
  users = Math.max(0, users - 1)
  if (users === 0 && context?.state === 'running') void context.suspend().catch(() => {})
}

export class MicPipeline {
  /** Nível do que está saindo (dBFS, depois da redução de ruído). */
  levelDb = -100
  /** Limiar aberto (ou sem limiar e com som). */
  open = false
  /** Só no plano B (sem processamento): mede o nível direto do microfone. */
  private meter: LevelMeter | null = null
  private closed = false

  private constructor(
    readonly raw: MediaStreamTrack,
    readonly track: MediaStreamTrack,
    private nodes: { source: MediaStreamAudioSourceNode; worklet: AudioWorkletNode } | null,
    /** Sem microfone: uma faixa muda no lugar (entrou na call só pra ouvir). */
    readonly silent = false,
  ) {
    if (!nodes && !silent) this.meter = new LevelMeter(raw)
  }

  /** Sem microfone (ou sem permissão): faixa muda, pra entrar na call só pra ouvir. */
  static async silent(): Promise<MicPipeline> {
    const ctx = await audioContext()
    users++
    const track = ctx.createMediaStreamDestination().stream.getAudioTracks()[0]
    return new MicPipeline(track, track, null, true)
  }

  /**
   * Monta o processamento. Se o AudioWorklet falhar por qualquer motivo, segue
   * com o microfone cru, porque é melhor a call funcionar sem filtro do que não funcionar.
   */
  static async create(raw: MediaStreamTrack): Promise<MicPipeline> {
    let counted = false
    try {
      const ctx = await audioContext()
      users++
      counted = true
      const source = ctx.createMediaStreamSource(new MediaStream([raw]))
      const worklet = new AudioWorkletNode(ctx, 'resenha-mic', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: micOptions(),
      })
      const destination = ctx.createMediaStreamDestination()
      source.connect(worklet).connect(destination)
      const pipeline = new MicPipeline(raw, destination.stream.getAudioTracks()[0], { source, worklet })
      worklet.port.onmessage = (event: MessageEvent<{ levelDb: number; open: boolean; error?: string }>) => {
        if (event.data.error) return console.error(event.data.error)
        pipeline.levelDb = event.data.levelDb
        pipeline.open = event.data.open
      }
      worklet.onprocessorerror = () => console.error('processador do microfone parou com erro')
      return pipeline
    } catch (err) {
      console.error('processamento do microfone indisponível, seguindo sem filtro', err)
      if (counted) release()
      return new MicPipeline(raw, raw, null)
    }
  }

  get processing(): boolean {
    return this.nodes !== null
  }

  /** Falando agora: com limiar, é o limiar aberto; sem, é ter som de verdade. */
  get speaking(): boolean {
    if (this.meter) return this.meter.level() > 0.02
    return settings.gate.enabled ? this.open : this.levelDb > -42
  }

  /** Nível pro medidor das configurações (dBFS). */
  get currentDb(): number {
    if (this.meter) return 20 * Math.log10(this.meter.level() + 1e-6)
    return this.levelDb
  }

  /** Muda redução de ruído e limiar na hora, sem reabrir o microfone. */
  update() {
    this.nodes?.worklet.port.postMessage(micOptions())
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.meter?.close()
    if (this.nodes) {
      this.nodes.worklet.port.postMessage('close')
      this.nodes.source.disconnect()
      this.nodes.worklet.disconnect()
    }
    if (this.nodes || this.silent) release()
    this.track.stop()
    this.raw.stop()
  }
}
