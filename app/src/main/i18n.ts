// Textos do processo principal (bandeja, avisos do sistema, janelas da atualização) nos
// três idiomas do app. O idioma vem da interface (`setLocale` pelo IPC) e fica guardado no
// desktop.json, pra bandeja já abrir certa antes da janela carregar.

export type Locale = 'pt' | 'en' | 'es'

export const isLocale = (value: unknown): value is Locale => value === 'pt' || value === 'en' || value === 'es'

/** Idioma do sistema (app.getLocale: "pt-BR", "en-US"...), se for um dos três; senão, inglês. */
export function localeFrom(tag: string): Locale {
  const base = tag.toLowerCase().split(/[-_]/)[0]
  return isLocale(base) ? base : 'en'
}

const pt = {
  tray: {
    open: 'Abrir o Resenha',
    mute: 'Mutar microfone',
    deafen: 'Ensurdecer',
    leave: 'Sair da call',
    quit: 'Fechar o Resenha',
    /** Dica do ícone mutado ou ensurdecido (o normal é só "Resenha"). */
    muted: 'Resenha · mutado',
    deafened: 'Resenha · ensurdecido',
  },
  /** Barra de tarefas do Windows: selo no ícone e botões na miniatura. */
  taskbar: {
    muted: 'Mutado',
    deafened: 'Ensurdecido',
    speaking: 'Falando',
    mute: 'Mutar',
    unmute: 'Desmutar',
    deafen: 'Ensurdecer',
    undeafen: 'Voltar a ouvir',
  },
  /** Nome dos atalhos globais (a descrição dos binds do Hyprland, na lista de atalhos do sistema). */
  shortcuts: {
    'toggle-mute': 'mutar ou desmutar',
    'toggle-deafen': 'ensurdecer ou voltar a ouvir',
    'toggle-share': 'compartilhar ou parar a tela',
    'leave-call': 'sair da call',
    'show-window': 'mostrar a janela',
  },
  update: {
    /** Título da janela do terminal que pede a senha. */
    terminalTitle: 'Atualizar Resenha',
    terminalPrompt: (version: string) => `Atualizando o Resenha pra versão ${version}. Digite sua senha:`,
    terminalFailed: 'Não deu pra atualizar. Aperte Enter pra abrir o Resenha.',
    noTerminal: (file: string) => `Não achei um terminal pra pedir a senha. Instale manualmente: sudo pacman -U "${file}"`,
    /** Vem depois de "Não deu pra atualizar:" na tela. */
    pacmanFailed: (code: number) =>
      `o pacman parou com erro (código ${code}). Se outro programa estiver usando o pacman, espere ele terminar e tente de novo.`,
  },
  /** Janelinha do anti-robô do cadastro (Turnstile). */
  /** Menu do clique direito (corretor, copiar e colar, links). */
  contextMenu: {
    cut: 'Recortar',
    copy: 'Copiar',
    paste: 'Colar',
    selectAll: 'Selecionar tudo',
    copyLink: 'Copiar link',
    openLink: 'Abrir link no navegador',
    copyImage: 'Copiar imagem',
    addToDictionary: 'Adicionar ao dicionário',
    noSuggestions: 'Sem sugestões',
  },
  /** A janela caiu várias vezes seguidas: o app pergunta em vez de recarregar de novo. */
  crashed: {
    message: 'A janela do Resenha fechou sozinha várias vezes seguidas.',
    detail: 'Pode ser falta de memória ou um problema com a placa de vídeo. Recarregar tenta de novo.',
    reload: 'Recarregar',
    quit: 'Fechar o Resenha',
  },
  verifyTitle: 'Verificação',
  /** Bot do Spotify: a página que o navegador mostra depois do login e o terminal que instala o librespot. */
  spotify: {
    connected: 'Spotify conectado. Pode fechar esta aba e voltar pro Resenha.',
    failed: 'Não deu pra conectar o Spotify. Volte pro Resenha e tente de novo.',
    installTitle: 'Instalar librespot',
    installPrompt: 'Instalando o librespot (o Spotify do bot do Resenha). Digite sua senha:',
    installDone: 'Pronto. Pode fechar esta janela e voltar pro Resenha.',
    installFailed: 'Não deu pra instalar. Aperte Enter pra fechar.',
  },
}

const en: typeof pt = {
  tray: {
    open: 'Open Resenha',
    mute: 'Mute microphone',
    deafen: 'Deafen',
    leave: 'Leave call',
    quit: 'Quit Resenha',
    muted: 'Resenha · muted',
    deafened: 'Resenha · deafened',
  },
  taskbar: {
    muted: 'Muted',
    deafened: 'Deafened',
    speaking: 'Speaking',
    mute: 'Mute',
    unmute: 'Unmute',
    deafen: 'Deafen',
    undeafen: 'Undeafen',
  },
  shortcuts: {
    'toggle-mute': 'mute or unmute',
    'toggle-deafen': 'deafen or undeafen',
    'toggle-share': 'start or stop screen share',
    'leave-call': 'leave call',
    'show-window': 'show window',
  },
  update: {
    terminalTitle: 'Update Resenha',
    terminalPrompt: (version: string) => `Updating Resenha to version ${version}. Enter your password:`,
    terminalFailed: "Couldn't update. Press Enter to open Resenha.",
    noTerminal: (file: string) => `Couldn't find a terminal to ask for your password. Install it manually: sudo pacman -U "${file}"`,
    pacmanFailed: (code: number) =>
      `pacman stopped with an error (code ${code}). If another program is using pacman, wait for it to finish and try again.`,
  },
  contextMenu: {
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
    copyLink: 'Copy link',
    openLink: 'Open link in browser',
    copyImage: 'Copy image',
    addToDictionary: 'Add to dictionary',
    noSuggestions: 'No suggestions',
  },
  crashed: {
    message: 'The Resenha window closed on its own several times in a row.',
    detail: 'It may be low memory or a graphics card problem. Reloading tries again.',
    reload: 'Reload',
    quit: 'Quit Resenha',
  },
  verifyTitle: 'Verification',
  spotify: {
    connected: 'Spotify connected. You can close this tab and go back to Resenha.',
    failed: "Couldn't connect Spotify. Go back to Resenha and try again.",
    installTitle: 'Install librespot',
    installPrompt: "Installing librespot (the Spotify player behind Resenha's bot). Enter your password:",
    installDone: 'Done. You can close this window and go back to Resenha.',
    installFailed: "Couldn't install it. Press Enter to close.",
  },
}

const es: typeof pt = {
  tray: {
    open: 'Abrir Resenha',
    mute: 'Silenciar micrófono',
    deafen: 'Ensordecer',
    leave: 'Salir de la llamada',
    quit: 'Cerrar Resenha',
    muted: 'Resenha · silenciado',
    deafened: 'Resenha · ensordecido',
  },
  taskbar: {
    muted: 'Silenciado',
    deafened: 'Ensordecido',
    speaking: 'Hablando',
    mute: 'Silenciar',
    unmute: 'Quitar silencio',
    deafen: 'Ensordecer',
    undeafen: 'Volver a escuchar',
  },
  shortcuts: {
    'toggle-mute': 'silenciar o activar micrófono',
    'toggle-deafen': 'ensordecer o volver a escuchar',
    'toggle-share': 'compartir o dejar de compartir pantalla',
    'leave-call': 'salir de la llamada',
    'show-window': 'mostrar la ventana',
  },
  update: {
    terminalTitle: 'Actualizar Resenha',
    terminalPrompt: (version: string) => `Actualizando Resenha a la versión ${version}. Escribe tu contraseña:`,
    terminalFailed: 'No se pudo actualizar. Presiona Enter para abrir Resenha.',
    noTerminal: (file: string) => `No encontré una terminal para pedir tu contraseña. Instálalo manualmente: sudo pacman -U "${file}"`,
    pacmanFailed: (code: number) =>
      `pacman terminó con un error (código ${code}). Si otro programa está usando pacman, espera a que termine e inténtalo de nuevo.`,
  },
  contextMenu: {
    cut: 'Cortar',
    copy: 'Copiar',
    paste: 'Pegar',
    selectAll: 'Seleccionar todo',
    copyLink: 'Copiar enlace',
    openLink: 'Abrir enlace en el navegador',
    copyImage: 'Copiar imagen',
    addToDictionary: 'Añadir al diccionario',
    noSuggestions: 'Sin sugerencias',
  },
  crashed: {
    message: 'La ventana de Resenha se cerró sola varias veces seguidas.',
    detail: 'Puede ser falta de memoria o un problema con la tarjeta gráfica. Recargar lo intenta de nuevo.',
    reload: 'Recargar',
    quit: 'Cerrar Resenha',
  },
  verifyTitle: 'Verificación',
  spotify: {
    connected: 'Spotify conectado. Puedes cerrar esta pestaña y volver a Resenha.',
    failed: 'No se pudo conectar Spotify. Vuelve a Resenha e inténtalo de nuevo.',
    installTitle: 'Instalar librespot',
    installPrompt: 'Instalando librespot (el Spotify del bot de Resenha). Escribe tu contraseña:',
    installDone: 'Listo. Puedes cerrar esta ventana y volver a Resenha.',
    installFailed: 'No se pudo instalar. Presiona Enter para cerrar.',
  },
}

const CATALOGS: Record<Locale, typeof pt> = { pt, en, es }

let current: Locale = 'pt'
const listeners = new Set<() => void>()

export const mainLocale = () => current

/** Os textos do idioma em uso. Leia na hora de montar (menu, aviso), não guarde. */
export const tm = () => CATALOGS[current]

export function setMainLocale(locale: Locale) {
  if (locale === current) return
  current = locale
  for (const listener of listeners) listener()
}

/** Pra refazer o que já está na tela (menu da bandeja) quando o idioma muda. */
export function onLocaleChange(listener: () => void) {
  listeners.add(listener)
}
