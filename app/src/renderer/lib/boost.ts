// Volume acima de 100% (como no Discord, até 200%): o elemento de áudio só vai
// até 1, então quem está mais alto que isso toca por um ganho do WebAudio,
// dentro do app. O volume do sistema nunca é mexido.

let context: AudioContext | null = null
let sink = ''
/** Vozes amplificadas agora: sem nenhuma, o contexto dorme (não segura a saída de som acordada). */
let users = 0

/**
 * Um contexto só pra todo mundo amplificado (criado na primeira vez que alguém passa de 100%).
 * Cada voz que passa a tocar por aqui chama isso uma vez e `releaseBoost` quando sai.
 */
export function boostContext(): AudioContext {
  if (!context) {
    context = new AudioContext({ latencyHint: 'interactive' })
    applySink()
  }
  users++
  if (context.state === 'suspended') void context.resume().catch(() => {})
  return context
}

export function releaseBoost() {
  users = Math.max(0, users - 1)
  if (users === 0 && context?.state === 'running') void context.suspend().catch(() => {})
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
