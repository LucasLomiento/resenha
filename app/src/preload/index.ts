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
  ink: {
    monitors: () => ipcRenderer.invoke('ink:monitors'),
    start: (connector) => ipcRenderer.invoke('ink:start', connector),
    event: (event) => ipcRenderer.send('ink:event', event),
    stop: () => ipcRenderer.send('ink:stop'),
    onClosed: (callback) => {
      ipcRenderer.on('ink:closed', () => callback())
    },
  },
  screenAudio: {
    apps: () => ipcRenderer.invoke('screen-audio:apps'),
    start: (options) => ipcRenderer.invoke('screen-audio:start', options),
    unmute: () => ipcRenderer.invoke('screen-audio:unmute'),
    stop: () => ipcRenderer.invoke('screen-audio:stop'),
  },
  attention: () => ipcRenderer.send('attention'),
  showWindow: () => ipcRenderer.send('show-window'),
  pendingInvite: () => ipcRenderer.invoke('invite:pending'),
  onInvite: (callback) => {
    ipcRenderer.on('invite', (_event, code: string) => callback(code))
  },
  turnstile: (server) => ipcRenderer.invoke('turnstile:verify', server),
  download: (url) => ipcRenderer.send('download', url),
  setLocale: (locale) => ipcRenderer.send('locale', locale),
  desktop: {
    get: () => ipcRenderer.invoke('desktop:get'),
    set: (patch) => ipcRenderer.invoke('desktop:set', patch),
    failed: () => ipcRenderer.invoke('desktop:failed'),
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
    install: (rejoin) => ipcRenderer.invoke('update:install', rejoin),
    takeRejoin: () => ipcRenderer.invoke('update:take-rejoin'),
    onState: (callback) => {
      ipcRenderer.on('update:state', (_event, state: UpdateState) => callback(state))
    },
  },
}

contextBridge.exposeInMainWorld('resenha', api)
