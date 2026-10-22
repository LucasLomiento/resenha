// Aviso do sistema: no computador, o Notification do Electron no processo principal (que
// consegue tirar o aviso depois, até da central de notificações do Windows); no celular, a
// notificação nativa (a ponte do Capacitor), porque a WebView do Android não tem Notification.

/** `tag`: o aviso novo com a mesma etiqueta substitui o anterior (um por conversa, em vez de empilhar). */
export function notify(title: string, options: { body: string; tag?: string; onclick?: () => void }) {
  window.resenha.notify(title, { body: options.body, tag: options.tag }, options.onclick)
}

/** Tira o aviso com essa etiqueta (a pessoa viu, aqui ou em outro aparelho). */
export function dismissNotice(tag: string) {
  window.resenha.dismissNotification(tag)
}
