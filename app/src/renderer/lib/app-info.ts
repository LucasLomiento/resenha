import type { PlatformInfo } from '../../preload/api'

/**
 * Versão e sistema deste app, que vão no `auth` de cada conexão: o dono vê em Plataforma →
 * Contas, e o servidor sabe que este app entende a pausa (4008). Preenchido no `boot`, antes
 * de qualquer conexão abrir.
 */
export const appInfo: { version?: string; platform?: string } = {}

/** O sistema como o Node chama (`linux`, `win32`, `android`…), que é como a Plataforma mostra. */
export function setAppInfo(info: PlatformInfo) {
  appInfo.version = info.version
  appInfo.platform = info.platform
}
