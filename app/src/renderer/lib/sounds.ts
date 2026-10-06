// Sons do app, sintetizados na hora com WebAudio (sem arquivos de áudio).
// Saem pelo mesmo processo de áudio do app, então nunca vazam pro áudio da
// tela que você estiver transmitindo.

import { settings } from './settings.svelte'

export type SoundName =
  | 'self-join'
  | 'self-leave'
  | 'join'
  | 'leave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'live'
  | 'message'
  /** Chamada privada chegando (repete enquanto toca). */
  | 'ring'
  /** Chamando a outra pessoa (repete enquanto ninguém atende). */
  | 'ringback'

interface Note {
  /** frequência (Hz) */
  f: number
  /** início (s) */
  at: number
  /** duração (s) */
  dur: number
  gain?: number
  type?: OscillatorType
}

const C5 = 523.25
const E5 = 659.25
const G5 = 783.99
const A5 = 880
const C6 = 1046.5
const E6 = 1318.5

const SOUNDS: Record<SoundName, Note[]> = {
  'self-join': [
    { f: C5, at: 0, dur: 0.16 },
    { f: E5, at: 0.07, dur: 0.16 },
    { f: G5, at: 0.14, dur: 0.28 },
  ],
  'self-leave': [
    { f: G5, at: 0, dur: 0.16 },
    { f: E5, at: 0.07, dur: 0.16 },
    { f: C5, at: 0.14, dur: 0.28 },
  ],
  join: [
    { f: E5, at: 0, dur: 0.14 },
    { f: A5, at: 0.08, dur: 0.24 },
  ],
  leave: [
    { f: A5, at: 0, dur: 0.14 },
    { f: E5, at: 0.08, dur: 0.24 },
  ],
  mute: [
    { f: 620, at: 0, dur: 0.07, gain: 0.7 },
    { f: 440, at: 0.06, dur: 0.12, gain: 0.7 },
  ],
  unmute: [
    { f: 440, at: 0, dur: 0.07, gain: 0.7 },
    { f: 620, at: 0.06, dur: 0.12, gain: 0.7 },
  ],
  deafen: [
    { f: 520, at: 0, dur: 0.08, gain: 0.7 },
    { f: 390, at: 0.07, dur: 0.08, gain: 0.7 },
    { f: 290, at: 0.14, dur: 0.16, gain: 0.7 },
  ],
  undeafen: [
    { f: 290, at: 0, dur: 0.08, gain: 0.7 },
    { f: 390, at: 0.07, dur: 0.08, gain: 0.7 },
    { f: 520, at: 0.14, dur: 0.16, gain: 0.7 },
  ],
  ring: [
    { f: E5, at: 0, dur: 0.16 },
    { f: G5, at: 0.18, dur: 0.16 },
    { f: E6, at: 0.36, dur: 0.34, gain: 0.8 },
    { f: E5, at: 0.9, dur: 0.16 },
    { f: G5, at: 1.08, dur: 0.16 },
    { f: E6, at: 1.26, dur: 0.34, gain: 0.8 },
  ],
  ringback: [
    { f: 440, at: 0, dur: 0.45, gain: 0.35 },
    { f: 480, at: 0, dur: 0.45, gain: 0.35 },
  ],
  live: [
    { f: G5, at: 0, dur: 0.12 },
    { f: C6, at: 0.07, dur: 0.12 },
    { f: E6, at: 0.14, dur: 0.3, gain: 0.8 },
  ],
  message: [
    { f: A5, at: 0, dur: 0.09, gain: 0.6 },
    { f: E6, at: 0.05, dur: 0.18, gain: 0.45 },
  ],
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

export function playSound(name: SoundName) {
  if (!settings.sounds || settings.soundVolume <= 0) return
  if (name === 'message' && !settings.messageSound) return
  try {
    const audio = ctx()
    const master = audio.createGain()
    master.gain.value = settings.soundVolume * 0.35
    // Um passa-baixa leve tira a aspereza do timbre.
    const filter = audio.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 4200
    filter.connect(master).connect(audio.destination)

    const start = audio.currentTime + 0.01
    for (const note of SOUNDS[name]) {
      for (const [type, mix, detune] of [
        [note.type ?? 'sine', 1, 0],
        ['triangle', 0.35, 4],
      ] as const) {
        const osc = audio.createOscillator()
        osc.type = type
        osc.frequency.value = note.f
        osc.detune.value = detune
        const env = audio.createGain()
        const peak = (note.gain ?? 1) * mix
        const t0 = start + note.at
        env.gain.setValueAtTime(0.0001, t0)
        env.gain.exponentialRampToValueAtTime(peak, t0 + 0.008)
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur)
        osc.connect(env).connect(filter)
        osc.start(t0)
        osc.stop(t0 + note.dur + 0.05)
      }
    }
  } catch (err) {
    console.warn('som falhou', err)
  }
}
