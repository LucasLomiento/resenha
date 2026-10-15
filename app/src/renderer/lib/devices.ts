// Aparelhos de áudio e câmera (pra Voz e vídeo e pros menus do microfone e do fone na dock).

/**
 * Toca um elemento de som ou vídeo pela saída escolhida ("default": a do sistema). No celular
 * (o WebView do Android) não tem como escolher: o `setSinkId` nem existe, e chamar dava erro
 * no meio da montagem da call (na 1.14, o som da call do celular não saía).
 */
export function setSink(element: HTMLMediaElement | null | undefined, deviceId: string): Promise<void> {
  if (!element || typeof element.setSinkId !== 'function') return Promise.resolve()
  return element.setSinkId(deviceId === 'default' ? '' : deviceId).catch(() => {})
}

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
