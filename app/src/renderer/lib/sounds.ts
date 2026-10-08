// Sons do app, sintetizados na hora com WebAudio (sem arquivos de áudio).
// Saem pelo mesmo processo de áudio do app, então nunca vazam pro áudio da
// tela que você estiver transmitindo.
//
// Cada família de evento tem um timbre próprio, pra dar pra saber o que
// aconteceu sem olhar: marimba (você entra/sai da call), gota (os outros
// entram/saem), clique (microfone), clique grave duplo (fone), sino de vidro
// (mensagem, menção), brilho (transmissão) e sopro (quem assiste a sua tela).
// Tudo passa por um reverb curto e um compressor, e o volume de cada som foi
// medido e acertado pra nenhum sair mais alto que os outros.

import { settings } from './settings.svelte'

export type SoundName =
  | 'self-join'
  | 'self-leave'
  | 'join'
  | 'leave'
  /** O dono do Resenha entra na call (no lugar do "alguém entra"; pra ele, no lugar do "você entra"). */
  | 'founder-join'
  /** O Pioneiro (a primeira pessoa que chegou) entra na call (idem). */
  | 'pioneer-join'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  /** Alguém começou a transmitir. */
  | 'live'
  /** A transmissão que eu assistia acabou. */
  | 'stream-end'
  /** Alguém começou a assistir a minha tela. */
  | 'viewer-join'
  /** Alguém parou de assistir a minha tela. */
  | 'viewer-leave'
  | 'message'
  | 'mention'
  /** Chamada privada chegando (repete enquanto toca). */
  | 'ring'
  /** Chamando a outra pessoa (repete enquanto ninguém atende). */
  | 'ringback'

/** Nome de cada som, pra prévia nas configurações. */
export const SOUND_LABELS: [SoundName, string][] = [
  ['self-join', 'Você entra'],
  ['self-leave', 'Você sai'],
  ['join', 'Alguém entra'],
  ['leave', 'Alguém sai'],
  ['founder-join', 'O dono do Resenha entra'],
  ['pioneer-join', 'O Pioneiro entra'],
  ['mute', 'Mutar'],
  ['unmute', 'Desmutar'],
  ['deafen', 'Ensurdecer'],
  ['undeafen', 'Voltar a ouvir'],
  ['live', 'Ao vivo'],
  ['stream-end', 'Fim da transmissão'],
  ['viewer-join', 'Alguém assiste'],
  ['viewer-leave', 'Parou de assistir'],
  ['message', 'Mensagem'],
  ['mention', 'Menção'],
  ['ring', 'Ligação'],
  ['ringback', 'Chamando'],
]

const NOTE = {
  C5: 523.25,
  E5: 659.25,
  Gs5: 830.61,
  G5: 783.99,
  A5: 880,
  B5: 987.77,
  C6: 1046.5,
  D6: 1174.66,
  E6: 1318.51,
  G6: 1567.98,
  A6: 1760,
}

// ---------- Instrumentos ----------

interface Bus {
  ctx: BaseAudioContext
  /** Entrada do som (vai pro seco e pro reverb). */
  input: AudioNode
}

interface Voice {
  gain?: number
  /** -1 (esquerda) a 1 (direita). */
  pan?: number
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseCache.get(ctx)
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    noiseCache.set(ctx, buffer)
  }
  return buffer
}

/** Ponto de saída de uma voz: ganho e posição no estéreo. */
function output(bus: Bus, voice: Voice): GainNode {
  const amp = bus.ctx.createGain()
  amp.gain.value = voice.gain ?? 1
  if (voice.pan) {
    const panner = bus.ctx.createStereoPanner()
    panner.pan.value = voice.pan
    amp.connect(panner).connect(bus.input)
  } else amp.connect(bus.input)
  return amp
}

/** Envelope de percussão: ataque curtinho e queda exponencial. */
function strike(param: AudioParam, at: number, peak: number, decay: number, attack = 0.004) {
  param.setValueAtTime(0.0001, at)
  param.exponentialRampToValueAtTime(peak, at + attack)
  param.exponentialRampToValueAtTime(0.0001, at + attack + decay)
}

/** Marimba: fundamental + parciais altos (4x e 10x) que morrem logo, como tecla de madeira. */
function mallet(bus: Bus, f: number, at: number, voice: Voice & { decay?: number; bright?: number } = {}) {
  const out = output(bus, voice)
  const decay = voice.decay ?? 0.55
  const bright = voice.bright ?? 1
  for (const [ratio, amp, life] of [
    [1, 1, 1],
    [3.98, 0.32 * bright, 0.16],
    [10.1, 0.09 * bright, 0.05],
  ]) {
    const osc = bus.ctx.createOscillator()
    osc.frequency.value = f * ratio
    const env = bus.ctx.createGain()
    strike(env.gain, at, amp, decay * life)
    osc.connect(env).connect(out)
    osc.start(at)
    osc.stop(at + decay * life + 0.05)
  }
}

/** Sino de vidro (FM): o brilho do ataque vem da moduladora, que some rápido e deixa um tom puro. */
function bell(bus: Bus, f: number, at: number, voice: Voice & { decay?: number; ratio?: number; index?: number } = {}) {
  const out = output(bus, voice)
  const decay = voice.decay ?? 0.7
  const carrier = bus.ctx.createOscillator()
  carrier.frequency.value = f
  const modulator = bus.ctx.createOscillator()
  modulator.frequency.value = f * (voice.ratio ?? 3.5)
  const depth = bus.ctx.createGain()
  const index = (voice.index ?? 1.6) * f
  depth.gain.setValueAtTime(index, at)
  depth.gain.exponentialRampToValueAtTime(index * 0.02, at + decay * 0.35)
  modulator.connect(depth).connect(carrier.frequency)
  const env = bus.ctx.createGain()
  strike(env.gain, at, 1, decay, 0.003)
  carrier.connect(env).connect(out)
  for (const osc of [carrier, modulator]) {
    osc.start(at)
    osc.stop(at + decay + 0.05)
  }
}

/** Gota: seno que sobe rapidinho até a nota (ou desce, com `fall`), redondo e curto. */
function drop(bus: Bus, f: number, at: number, voice: Voice & { fall?: boolean; decay?: number } = {}) {
  const out = output(bus, voice)
  const decay = voice.decay ?? 0.22
  const osc = bus.ctx.createOscillator()
  osc.frequency.setValueAtTime(voice.fall ? f * 1.25 : f * 0.72, at)
  osc.frequency.exponentialRampToValueAtTime(f, at + 0.045)
  const env = bus.ctx.createGain()
  strike(env.gain, at, 1, decay, 0.006)
  osc.connect(env).connect(out)
  osc.start(at)
  osc.stop(at + decay + 0.05)
}

/** Clique com glissando (microfone e fone): tom que desliza + um estalo bem curto de ruído. */
function blip(bus: Bus, from: number, to: number, at: number, voice: Voice & { decay?: number; click?: number } = {}) {
  const out = output(bus, voice)
  const decay = voice.decay ?? 0.09
  const osc = bus.ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(to, at + decay * 0.8)
  const env = bus.ctx.createGain()
  strike(env.gain, at, 1, decay, 0.002)
  osc.connect(env).connect(out)
  osc.start(at)
  osc.stop(at + decay + 0.05)

  const click = bus.ctx.createBufferSource()
  click.buffer = noiseBuffer(bus.ctx)
  const band = bus.ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = Math.max(from, to) * 3
  band.Q.value = 1.5
  const clickEnv = bus.ctx.createGain()
  strike(clickEnv.gain, at, voice.click ?? 0.35, 0.012, 0.001)
  click.connect(band).connect(clickEnv).connect(out)
  click.start(at)
  click.stop(at + 0.05)
}

/** Sopro: ruído com filtro que varre (entra subindo, sai descendo). */
function whoosh(bus: Bus, from: number, to: number, at: number, voice: Voice & { length?: number } = {}) {
  const out = output(bus, voice)
  const length = voice.length ?? 0.32
  const source = bus.ctx.createBufferSource()
  source.buffer = noiseBuffer(bus.ctx)
  const band = bus.ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 1.4
  band.frequency.setValueAtTime(from, at)
  band.frequency.exponentialRampToValueAtTime(to, at + length)
  const env = bus.ctx.createGain()
  env.gain.setValueAtTime(0.0001, at)
  env.gain.exponentialRampToValueAtTime(1, at + length * 0.45)
  env.gain.exponentialRampToValueAtTime(0.0001, at + length)
  source.connect(band).connect(env).connect(out)
  source.start(at)
  source.stop(at + length + 0.05)
}

/** Tom de chamada (como o "tuuu" do telefone no Brasil, 425 Hz), com entrada e saída macias. */
function tone(bus: Bus, f: number, at: number, length: number, voice: Voice = {}) {
  const out = output(bus, voice)
  for (const [ratio, amp] of [
    [1, 1],
    [2, 0.12],
  ]) {
    const osc = bus.ctx.createOscillator()
    osc.frequency.value = f * ratio
    const env = bus.ctx.createGain()
    env.gain.setValueAtTime(0.0001, at)
    env.gain.exponentialRampToValueAtTime(amp, at + 0.04)
    env.gain.setValueAtTime(amp, at + length - 0.08)
    env.gain.exponentialRampToValueAtTime(0.0001, at + length)
    osc.connect(env).connect(out)
    osc.start(at)
    osc.stop(at + length + 0.05)
  }
}

// ---------- Os sons ----------

/** Cada som, desenhado a partir de `at` (segundos no relógio do contexto). */
const SOUNDS: Record<SoundName, (bus: Bus, at: number) => void> = {
  'self-join': (bus, at) => {
    const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6]
    notes.forEach((f, i) => mallet(bus, f, at + i * 0.06, { gain: 0.8, pan: -0.24 + i * 0.16 }))
  },
  'self-leave': (bus, at) => {
    const notes = [NOTE.C6, NOTE.G5, NOTE.E5, NOTE.C5]
    notes.forEach((f, i) => mallet(bus, f, at + i * 0.07, { gain: 0.75, bright: 0.55, pan: 0.24 - i * 0.16 }))
  },
  join: (bus, at) => {
    drop(bus, NOTE.A5, at, { gain: 0.9, pan: -0.1 })
    drop(bus, NOTE.E6, at + 0.085, { gain: 0.8, pan: 0.1 })
  },
  'founder-join': (bus, at) => {
    // Fanfarra curta: arpejo de marimba subindo e um acorde de sinos com brilho por cima.
    ;[NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => mallet(bus, f, at + i * 0.07, { gain: 0.7, pan: -0.2 + i * 0.2 }))
    const top = at + 0.22
    bell(bus, NOTE.C6, top, { gain: 0.5, decay: 0.95, pan: -0.15 })
    bell(bus, NOTE.E6, top + 0.02, { gain: 0.42, decay: 0.95, pan: 0.15 })
    bell(bus, NOTE.G6, top + 0.04, { gain: 0.32, decay: 1.05, ratio: 4.1 })
    whoosh(bus, 2600, 9000, top - 0.06, { gain: 0.22, length: 0.5 })
  },
  'pioneer-join': (bus, at) => {
    // Chamado de explorador: um sopro que sobe (vento) e sinos em quartas e quintas, abertos.
    whoosh(bus, 450, 5200, at, { gain: 0.32, length: 0.34 })
    bell(bus, NOTE.A5, at + 0.12, { gain: 0.55, decay: 0.7, pan: -0.25, ratio: 3 })
    bell(bus, NOTE.E6, at + 0.22, { gain: 0.48, decay: 0.8, pan: 0.2, ratio: 3 })
    bell(bus, NOTE.A6, at + 0.32, { gain: 0.36, decay: 1, ratio: 4.1 })
    mallet(bus, NOTE.A5 / 2, at + 0.12, { gain: 0.45, decay: 0.7 })
  },
  leave: (bus, at) => {
    drop(bus, NOTE.E6, at, { fall: true, gain: 0.75, pan: 0.1 })
    drop(bus, NOTE.A5, at + 0.09, { fall: true, gain: 0.7, pan: -0.1, decay: 0.26 })
  },
  mute: (bus, at) => blip(bus, 900, 470, at, { gain: 0.9 }),
  unmute: (bus, at) => blip(bus, 470, 900, at, { gain: 0.9 }),
  deafen: (bus, at) => {
    blip(bus, 640, 320, at, { gain: 0.95, decay: 0.1, click: 0.25 })
    blip(bus, 430, 215, at + 0.085, { gain: 0.95, decay: 0.14, click: 0.2 })
  },
  undeafen: (bus, at) => {
    blip(bus, 215, 430, at, { gain: 0.9, decay: 0.09, click: 0.2 })
    blip(bus, 320, 640, at + 0.075, { gain: 0.9, decay: 0.12, click: 0.25 })
  },
  live: (bus, at) => {
    const notes = [NOTE.G5, NOTE.B5, NOTE.D6, NOTE.G6]
    notes.forEach((f, i) => bell(bus, f, at + i * 0.055, { gain: 0.42, decay: 0.75, pan: -0.3 + i * 0.2 }))
    bell(bus, NOTE.G6 * 2, at + 0.2, { gain: 0.08, decay: 0.5, ratio: 7, index: 0.8 })
  },
  'stream-end': (bus, at) => {
    const notes = [NOTE.G6, NOTE.D6, NOTE.B5]
    notes.forEach((f, i) => bell(bus, f, at + i * 0.08, { gain: 0.38, decay: 0.6, index: 1.1, pan: 0.2 - i * 0.2 }))
  },
  'viewer-join': (bus, at) => {
    whoosh(bus, 500, 3600, at, { gain: 0.5, length: 0.3 })
    bell(bus, NOTE.A6, at + 0.17, { gain: 0.32, decay: 0.45, index: 1.2 })
  },
  'viewer-leave': (bus, at) => {
    whoosh(bus, 3600, 500, at, { gain: 0.42, length: 0.3 })
    bell(bus, NOTE.E6, at + 0.16, { gain: 0.24, decay: 0.35, index: 0.9 })
  },
  message: (bus, at) => {
    bell(bus, NOTE.E6, at, { gain: 0.55, decay: 0.4, ratio: 3.5, index: 1.4 })
    mallet(bus, NOTE.E5, at, { gain: 0.25, decay: 0.3, bright: 0.3 })
  },
  mention: (bus, at) => {
    bell(bus, NOTE.B5, at, { gain: 0.5, decay: 0.45, pan: -0.12 })
    bell(bus, NOTE.E6, at + 0.09, { gain: 0.55, decay: 0.6, pan: 0.12 })
    bell(bus, NOTE.E6 * 2, at + 0.09, { gain: 0.07, decay: 0.4, ratio: 2, index: 0.6 })
  },
  ring: (bus, at) => {
    const phrase: [number, number][] = [
      [NOTE.E5, 0],
      [NOTE.B5, 0.14],
      [NOTE.E6, 0.28],
      [NOTE.Gs5, 0.56],
      [NOTE.B5, 0.7],
      [NOTE.E6, 0.84],
    ]
    for (const [f, offset] of phrase) {
      bell(bus, f, at + offset, { gain: 0.38, decay: 0.55, index: 1.3 })
      mallet(bus, f, at + offset, { gain: 0.3, decay: 0.4 })
    }
  },
  ringback: (bus, at) => tone(bus, 425, at, 1, { gain: 0.32 }),
}

/**
 * Volume de cada som, acertado pela medição (RMS de 50 ms no trecho mais alto)
 * pra todos soarem parecidos. Os de atenção (ligação, menção) ficam um pouco acima.
 */
const LEVEL: Record<SoundName, number> = {
  'self-join': 0.61,
  'self-leave': 0.62,
  join: 0.87,
  leave: 0.85,
  'founder-join': 0.54,
  'pioneer-join': 0.6,
  mute: 1.57,
  unmute: 1.6,
  deafen: 0.73,
  undeafen: 0.82,
  live: 0.99,
  'stream-end': 0.78,
  'viewer-join': 0.99,
  'viewer-leave': 1.23,
  message: 1.02,
  mention: 1.06,
  ring: 0.72,
  ringback: 0.64,
}

// ---------- Saída ----------

const reverbCache = new WeakMap<BaseAudioContext, AudioBuffer>()

/** Resposta de uma sala pequena: ruído que decai em ~0,6 s, um pouco mais escuro no fim. */
function roomResponse(ctx: BaseAudioContext): AudioBuffer {
  let buffer = reverbCache.get(ctx)
  if (!buffer) {
    const length = Math.round(ctx.sampleRate * 0.7)
    buffer = ctx.createBuffer(2, length, ctx.sampleRate)
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      let smooth = 0
      for (let i = 0; i < length; i++) {
        const t = i / ctx.sampleRate
        smooth += ((Math.random() * 2 - 1) - smooth) * (0.6 - Math.min(0.45, t * 0.7))
        data[i] = smooth * Math.exp(-t * 7)
      }
    }
    reverbCache.set(ctx, buffer)
  }
  return buffer
}

/** Cadeia de saída: seco + reverb curto, compressor suave e o volume. */
function createBus(ctx: BaseAudioContext, destination: AudioNode, volume: number): { bus: Bus; master: GainNode } {
  const input = ctx.createGain()
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -16
  compressor.ratio.value = 3
  compressor.attack.value = 0.003
  compressor.release.value = 0.12
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 7000
  const reverb = ctx.createConvolver()
  reverb.buffer = roomResponse(ctx)
  const wet = ctx.createGain()
  wet.gain.value = 0.16
  input.connect(compressor)
  input.connect(reverb).connect(wet).connect(compressor)
  const master = ctx.createGain()
  master.gain.value = volume
  compressor.connect(tone).connect(master).connect(destination)
  return { bus: { ctx, input }, master }
}

/** Desenha um som num contexto qualquer (o de verdade, ou um offline pra medir). */
export function renderSound(ctx: BaseAudioContext, destination: AudioNode, name: SoundName, at: number, volume = 1) {
  const { bus } = createBus(ctx, destination, volume * LEVEL[name])
  SOUNDS[name](bus, at)
}

let context: AudioContext | null = null
let sink = ''

function ctx(): AudioContext {
  context ??= new AudioContext({ latencyHint: 'interactive' })
  if (context.state === 'suspended') context.resume().catch(() => {})
  const wanted = settings.outputDevice === 'default' ? '' : settings.outputDevice
  if (wanted !== sink && 'setSinkId' in context) {
    sink = wanted
    ;(context as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(wanted).catch(() => {})
  }
  return context
}

/** `preview`: tocado de propósito nas configurações (vale mesmo com "Mensagem nova" desligado). */
export function playSound(name: SoundName, preview = false) {
  if (!settings.sounds || settings.soundVolume <= 0) return
  if (!preview && (name === 'message' || name === 'mention') && !settings.messageSound) return
  try {
    const audio = ctx()
    renderSound(audio, audio.destination, name, audio.currentTime + 0.01, settings.soundVolume * 0.75)
  } catch (err) {
    console.warn('som falhou', err)
  }
}
