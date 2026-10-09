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
  update: {
    /** Título da janela do terminal que pede a senha. */
    terminalTitle: 'Atualizar Resenha',
    terminalPrompt: (version: string) => `Atualizando o Resenha pra versão ${version}. Digite sua senha:`,
    terminalFailed: 'Não deu pra atualizar. Aperte Enter pra abrir o Resenha.',
    noTerminal: (file: string) => `Não achei um terminal pra pedir a senha. Instale manualmente: sudo pacman -U "${file}"`,
  },
  /** Janelinha do anti-robô do cadastro (Turnstile). */
  verifyTitle: 'Verificação',
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
  update: {
    terminalTitle: 'Update Resenha',
    terminalPrompt: (version: string) => `Updating Resenha to version ${version}. Enter your password:`,
    terminalFailed: "Couldn't update. Press Enter to open Resenha.",
    noTerminal: (file: string) => `Couldn't find a terminal to ask for your password. Install it manually: sudo pacman -U "${file}"`,
  },
  verifyTitle: 'Verification',
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
  update: {
    terminalTitle: 'Actualizar Resenha',
    terminalPrompt: (version: string) => `Actualizando Resenha a la versión ${version}. Escribe tu contraseña:`,
    terminalFailed: 'No se pudo actualizar. Presiona Enter para abrir Resenha.',
    noTerminal: (file: string) => `No encontré una terminal para pedir tu contraseña. Instálalo manualmente: sudo pacman -U "${file}"`,
  },
  verifyTitle: 'Verificación',
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
