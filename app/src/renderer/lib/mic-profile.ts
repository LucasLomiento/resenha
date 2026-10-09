// Perfis do microfone (como no Discord): "isolar voz" é o processamento normal do app, e
// "estúdio" desliga tudo (som puro, pra quem usa fone). O resto é "personalizado", nas
// configurações de voz.

import { settings } from './settings.svelte'

export type MicProfile = 'isolation' | 'studio' | 'custom'

export function micProfile(): MicProfile {
  const { noiseReduction, echoCancellation, autoGainControl, gate } = settings
  if (noiseReduction === 'off' && !echoCancellation && !autoGainControl && !gate.enabled) return 'studio'
  if (noiseReduction === 'rnnoise' && echoCancellation && !autoGainControl) return 'isolation'
  return 'custom'
}

/** Aplica o perfil nas configurações (quem chama reabre o microfone da call). */
export function setMicProfile(profile: Exclude<MicProfile, 'custom'>) {
  if (profile === 'studio') {
    settings.noiseReduction = 'off'
    settings.echoCancellation = false
    settings.gate.enabled = false
  } else {
    settings.noiseReduction = 'rnnoise'
    settings.echoCancellation = true
  }
  settings.autoGainControl = false
}
