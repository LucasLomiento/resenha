// Aviso do sistema: no computador, o Notification do navegador (o Electron mostra como
// aviso do sistema); no celular, a notificação nativa (a ponte do Capacitor), porque a
// WebView do Android não tem Notification.

export function notify(title: string, options: { body: string; onclick?: () => void }) {
  if (window.resenha.notify) return window.resenha.notify(title, options.body, options.onclick)
  const notification = new Notification(title, { body: options.body, silent: true })
  if (options.onclick) notification.onclick = options.onclick
}
