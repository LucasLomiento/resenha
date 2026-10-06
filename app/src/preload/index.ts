import { contextBridge, ipcRenderer } from 'electron'
import type { ResenhaApi, ShortcutAction, UpdateState } from './api'

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
    apps: () => ipcRenderer.invoke('screen-audio:apps'),
    start: (options) => ipcRenderer.invoke('screen-audio:start', options),
    unmute: () => ipcRenderer.invoke('screen-audio:unmute'),
    stop: () => ipcRenderer.invoke('screen-audio:stop'),
  },
  attention: () => ipcRenderer.send('attention'),
  pendingInvite: () => ipcRenderer.invoke('invite:pending'),
  onInvite: (callback) => {
    ipcRenderer.on('invite', (_event, code: string) => callback(code))
  },
  turnstile: (server) => ipcRenderer.invoke('turnstile:verify', server),
  download: (url) => ipcRenderer.send('download', url),
  desktop: {
    get: () => ipcRenderer.invoke('desktop:get'),
    set: (patch) => ipcRenderer.invoke('desktop:set', patch),
  },
  callState: (state) => ipcRenderer.send('call-state', state),
  unread: (count) => ipcRenderer.send('unread', count),
  onAction: (callback) => {
    ipcRenderer.on('action', (_event, action: ShortcutAction) => callback(action))
  },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (callback) => {
      ipcRenderer.on('update:state', (_event, state: UpdateState) => callback(state))
    },
  },
}

contextBridge.exposeInMainWorld('resenha', api)
