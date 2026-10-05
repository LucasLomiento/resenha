// Atualização pelo próprio app, a partir das Releases do GitHub.
//
// O electron-updater procura e baixa (e confere o hash). A instalação depende
// do formato:
// - Windows (instalador NSIS) e AppImage: o próprio electron-updater instala.
// - .pacman (Arch/CachyOS): instalamos nós. Primeiro tentamos o pkexec, que
//   funciona onde há agente do polkit (KDE). Sem agente (ex.: Hyprland puro),
//   abrimos um terminal com sudo. O PacmanUpdater do electron-updater não
//   serve aqui: ele não tem esse plano B e, se falha, roda `pacman -Sy`
//   (atualização parcial, que no Arch é furada).

import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../preload/api'

let state: UpdateState = { status: 'idle' }
let downloadedFile: string | null = null
let notify: (state: UpdateState) => void = () => {}

function set(next: UpdateState) {
  state = next
  notify(state)
}

function packageType(): string | null {
  try {
    return readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim()
  } catch {
    return null
  }
}

export function supported(): boolean {
  return app.isPackaged && (process.platform === 'win32' || !!process.env.APPIMAGE || packageType() === 'pacman')
}

export function setupUpdater(onState: (state: UpdateState) => void) {
  notify = onState
  if (!supported()) {
    set({ status: 'unsupported' })
    return
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => set({ status: 'none' }))
  autoUpdater.on('update-available', (info) => set({ status: 'available', version: info.version }))
  autoUpdater.on('download-progress', (progress) => {
    if (state.status === 'downloading') set({ ...state, percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (event) => {
    downloadedFile = event.downloadedFile
    set({ status: 'ready', version: event.version })
  })
  autoUpdater.on('error', (err) => set({ status: 'error', message: err?.message ?? String(err) }))

  // Confere sozinho pouco depois de abrir e a cada 6 horas.
  setTimeout(() => checkForUpdates(), 15_000)
  setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000)
}

export function updateState(): UpdateState {
  return state
}

export async function checkForUpdates() {
  if (!supported() || ['downloading', 'ready', 'installing'].includes(state.status)) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ status: 'error', message: (err as Error).message })
  }
}

export async function downloadUpdate() {
  if (state.status !== 'available') return
  set({ status: 'downloading', version: state.version, percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    set({ status: 'error', message: (err as Error).message })
  }
}

export async function installUpdate() {
  if (state.status !== 'ready') return
  const version = state.version
  set({ status: 'installing', version })
  if (packageType() === 'pacman' && downloadedFile) return installPacman(downloadedFile, version)
  autoUpdater.quitAndInstall(false, true)
}

function run(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.on('error', () => resolve(null))
    child.on('exit', (code) => resolve(code))
  })
}

async function installPacman(file: string, version: string) {
  const code = await run('pkexec', ['pacman', '-U', '--noconfirm', file])
  if (code === 0) {
    app.relaunch()
    return app.exit(0)
  }
  // 126 = a pessoa cancelou a senha; aí não insiste.
  if (code === 126) return set({ status: 'ready', version })

  // Sem agente do polkit: terminal com sudo, que no fim reabre o app.
  const terminal = findTerminal()
  if (!terminal) {
    return set({
      status: 'error',
      message: `Não achei um terminal pra pedir a senha. Instale manualmente: sudo pacman -U "${file}"`,
    })
  }
  const script = [
    `echo 'Atualizando o Resenha pra versão ${version}. Digite sua senha:'`,
    `sudo pacman -U --noconfirm '${file.replace(/'/g, `'\\''`)}'`,
    `setsid '${process.execPath.replace(/'/g, `'\\''`)}' >/dev/null 2>&1 &`,
    'sleep 1',
  ].join('; ')
  spawn(terminal.command, [...terminal.args, 'bash', '-c', script], { detached: true, stdio: 'ignore' }).unref()
  app.exit(0)
}

function findTerminal(): { command: string; args: string[] } | null {
  const candidates: { command: string; args: string[] }[] = [
    { command: 'foot', args: ['-T', 'Atualizar Resenha'] },
    { command: 'konsole', args: ['-e'] },
    { command: 'kitty', args: ['--title', 'Atualizar Resenha'] },
    { command: 'alacritty', args: ['-T', 'Atualizar Resenha', '-e'] },
    { command: 'ghostty', args: ['-e'] },
    { command: 'xfce4-terminal', args: ['-x'] },
    { command: 'xterm', args: ['-e'] },
  ]
  return candidates.find((t) => spawnSync('which', [t.command]).status === 0) ?? null
}
