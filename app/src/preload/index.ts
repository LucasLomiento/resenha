import { contextBridge, ipcRenderer } from 'electron'
import type { ResenhaApi } from './api'

const api: ResenhaApi = {
  platform: () => ipcRenderer.invoke('platform:info'),
  session: {
    get: () => ipcRenderer.invoke('session:get'),
    set: (session) => ipcRenderer.invoke('session:set', session),
  },
  share: {
    sources: () => ipcRenderer.invoke('share:sources'),
    select: (choice) => ipcRenderer.invoke('share:select', choice),
  },
  screenAudio: {
    start: () => ipcRenderer.invoke('screen-audio:start'),
    unmute: () => ipcRenderer.invoke('screen-audio:unmute'),
    stop: () => ipcRenderer.invoke('screen-audio:stop'),
  },
  attention: () => ipcRenderer.send('attention'),
  download: (url) => ipcRenderer.send('download', url),
}

contextBridge.exposeInMainWorld('resenha', api)
