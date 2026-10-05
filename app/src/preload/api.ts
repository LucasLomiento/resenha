// Contrato entre o renderer e o processo principal (exposto como window.resenha).

export interface PlatformInfo {
  platform: string
  /** No Wayland quem escolhe a tela é o seletor do portal, não o nosso. */
  portalPicker: boolean
  /**
   * Como o áudio da tela é capturado sem a voz da call:
   * - venmic: Linux/PipeWire, todos os apps menos o nosso
   * - exclude-self: Windows 10 22H2+, sistema inteiro menos o nosso processo
   * - loopback-all: Windows antigo, pega tudo (a voz da call vai junto)
   * - none: sem áudio da tela
   */
  screenAudio: 'venmic' | 'exclude-self' | 'loopback-all' | 'none'
  version: string
}

export interface SavedSession {
  server: string
  token: string
}

export interface CaptureSource {
  id: string
  name: string
  thumbnail: string
  kind: 'screen' | 'window'
}

export interface ResenhaApi {
  platform(): Promise<PlatformInfo>
  session: {
    get(): Promise<SavedSession | null>
    set(session: SavedSession | null): Promise<void>
  }
  share: {
    sources(): Promise<CaptureSource[]>
    /** Avisa o principal o que entregar no próximo getDisplayMedia. */
    select(choice: { sourceId: string | null; audio: boolean }): Promise<void>
  }
  screenAudio: {
    start(): Promise<{ ok: boolean; error?: string }>
    unmute(): Promise<void>
    stop(): Promise<void>
  }
  attention(): void
  /** Baixa um anexo com o diálogo de salvar do sistema. */
  download(url: string): void
}
