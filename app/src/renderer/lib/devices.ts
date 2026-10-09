// Aparelhos de áudio e câmera (pra Voz e vídeo e pros menus do microfone e do fone na dock).

export interface Devices {
  inputs: MediaDeviceInfo[]
  outputs: MediaDeviceInfo[]
  cameras: MediaDeviceInfo[]
}

export async function listDevices(): Promise<Devices> {
  let devices = await navigator.mediaDevices.enumerateDevices()
  // Sem nenhum acesso ao microfone ainda, o Chromium esconde os nomes: pede uma vez e solta.
  if (!devices.some((d) => d.label)) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of probe.getTracks()) track.stop()
      devices = await navigator.mediaDevices.enumerateDevices()
    } catch {
      // sem permissão: fica a lista sem nomes
    }
  }
  return {
    // O microfone virtual do áudio da tela não serve como microfone de voz.
    inputs: devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications' && !d.label.includes('vencord-screen-share')),
    outputs: devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications'),
    cameras: devices.filter((d) => d.kind === 'videoinput'),
  }
}

/** Os aparelhos de verdade da lista (o "default" do Chromium vira o "Padrão do sistema" à parte). */
export const namedDevices = (list: MediaDeviceInfo[]) => list.filter((d) => d.deviceId && d.deviceId !== 'default')
