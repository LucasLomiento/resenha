// Menu do clique direito da janela. O Electron não tem nenhum sozinho: sem isso, o corretor
// sublinhava a palavra sem ter como ver a sugestão, e não dava pra copiar ou colar pelo mouse.
// Os menus da própria página (mensagem, pessoa, canal) cancelam o evento no renderer, e aí
// este nem abre.

import { clipboard, Menu, shell, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'
import { tm } from './i18n'

export function attachContextMenu(win: BrowserWindow) {
  win.webContents.on('context-menu', (_event, params) => {
    const items = contextItems(win, params)
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window: win })
  })
}

function contextItems(win: BrowserWindow, params: ContextMenuParams): MenuItemConstructorOptions[] {
  const t = tm().contextMenu
  const contents = win.webContents
  const groups: MenuItemConstructorOptions[][] = []
  if (params.misspelledWord) {
    const suggestions = params.dictionarySuggestions.slice(0, 5).map((word) => ({ label: word, click: () => contents.replaceMisspelling(word) }))
    groups.push([
      ...(suggestions.length > 0 ? suggestions : [{ label: t.noSuggestions, enabled: false }]),
      { label: t.addToDictionary, click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
    ])
  }
  // Só link da web: o resto (file:, javascript:...) nem aparece.
  const link = /^https?:\/\//i.test(params.linkURL) ? params.linkURL : null
  if (link) {
    groups.push([
      { label: t.openLink, click: () => void shell.openExternal(link) },
      { label: t.copyLink, click: () => clipboard.writeText(link) },
    ])
  }
  if (params.mediaType === 'image' && params.hasImageContents) {
    groups.push([{ label: t.copyImage, click: () => contents.copyImageAt(params.x, params.y) }])
  }
  if (params.isEditable) {
    const can = params.editFlags
    groups.push([
      { label: t.cut, role: 'cut', enabled: can.canCut },
      { label: t.copy, role: 'copy', enabled: can.canCopy },
      { label: t.paste, role: 'paste', enabled: can.canPaste },
      { type: 'separator' },
      { label: t.selectAll, role: 'selectAll', enabled: can.canSelectAll },
    ])
  } else if (params.selectionText.trim()) {
    groups.push([{ label: t.copy, role: 'copy' }])
  }
  return groups.flatMap((group, i) => (i > 0 ? [{ type: 'separator' as const }, ...group] : group))
}
