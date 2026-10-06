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

async function audioContext(): Promise<AudioContext> {
  // 48 kHz: é a taxa que o RNNoise espera (blocos de 480 = 10 ms).
  context ??= new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' })
  if (context.state === 'suspended') await context.resume().catch(() => {})
  loading ??= context.audioWorklet.addModule(workletUrl)
  await loading
  return context
}

export class MicPipeline {
  /** Nível do que está saindo (dBFS, depois da redução de ruído). */
  levelDb = -100
  /** Limiar aberto (ou sem limiar e com som). */
  open = false
  /** Só no plano B (sem processamento): mede o nível direto do microfone. */
  private meter: LevelMeter | null = null

  private constructor(
    readonly raw: MediaStreamTrack,
    readonly track: MediaStreamTrack,
    private nodes: { source: MediaStreamAudioSourceNode; worklet: AudioWorkletNode } | null,
  ) {
    if (!nodes) this.meter = new LevelMeter(raw)
  }

  /**
   * Monta o processamento. Se o AudioWorklet falhar por qualquer motivo, segue
   * com o microfone cru, porque é melhor a call funcionar sem filtro do que não funcionar.
   */
  static async create(raw: MediaStreamTrack): Promise<MicPipeline> {
    try {
      const ctx = await audioContext()
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
    this.meter?.close()
    if (this.nodes) {
      this.nodes.worklet.port.postMessage('close')
      this.nodes.source.disconnect()
      this.nodes.worklet.disconnect()
    }
    this.track.stop()
    this.raw.stop()
  }
}
