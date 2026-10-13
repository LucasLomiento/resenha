// Volume acima de 100% (como no Discord, até 200%): o elemento de áudio só vai
// até 1, então quem está mais alto que isso toca por um ganho do WebAudio,
// dentro do app. O volume do sistema nunca é mexido.

let context: AudioContext | null = null
let sink = ''

/** Um contexto só pra todo mundo amplificado (criado na primeira vez que alguém passa de 100%). */
export function boostContext(): AudioContext {
  if (!context) {
    context = new AudioContext({ latencyHint: 'interactive' })
    applySink()
  }
  if (context.state === 'suspended') void context.resume().catch(() => {})
  return context
}

/** A saída escolhida nas configurações vale pra quem está amplificado também. */
export function setBoostOutput(deviceId: string) {
  sink = deviceId === 'default' ? '' : deviceId
  applySink()
}

function applySink() {
  const ctx = context as (AudioContext & { setSinkId?(id: string): Promise<void> }) | null
  ctx?.setSinkId?.(sink).catch(() => {})
}
