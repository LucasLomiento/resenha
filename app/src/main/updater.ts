// Atualização pelo próprio app, a partir das Releases do GitHub.
//
// O electron-updater procura e baixa (e confere o hash). Procura logo ao abrir e
// a cada 30 minutos, e baixa sozinho quando não tem call (90 MB de uma vez
// engasgam a transmissão); o app avisa quando dá pra instalar. A instalação
// depende do formato:
// - Windows (instalador NSIS) e AppImage: o próprio electron-updater instala.
// - .pacman (Arch/CachyOS): instalamos nós. Primeiro tentamos o pkexec, que
//   funciona onde há agente do polkit (KDE, Omarchy). Sem agente, abrimos um
//   terminal com sudo. O PacmanUpdater do electron-updater não serve aqui: ele
//   não tem esse plano B e, se falha, roda `pacman -Sy` (atualização parcial,
//   que no Arch é furada).
//
// No Linux, o pkexec, o terminal e a reabertura do app saem pelo systemd
// (`systemd-run --user`), não por aqui. O `app.relaunch()` do Electron abre o
// app novo com a trava "no new privileges" (o Chromium liga ela em quem ele
// lança), e com essa trava o pkexec e o sudo não viram root: a atualização
// seguinte fechava o app sem instalar. O que o systemd abre vem sem a trava,
// mesmo que este processo tenha (os que foram reabertos pela 1.2.1 ou antes).

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../preload/api'

let state: UpdateState = { status: 'idle' }
let downloadedFile: string | null = null
let notify: (state: UpdateState) => void = () => {}
/** Em call agora (o renderer avisa pelo mesmo estado da bandeja). */
let inCall = false

/** De quanto em quanto tempo procura versão nova. */
const CHECK_EVERY = 30 * 60 * 1000

function set(next: UpdateState) {
  // A instalação não aconteceu (senha cancelada, erro): o app continua aberto, a volta pra call não vale.
  if (state.status === 'installing' && next.status !== 'installing') forgetRejoin()
  state = next
  notify(state)
}

// ---------- Voltar pra call depois de atualizar ----------

const rejoinFile = () => join(app.getPath('userData'), 'rejoin.json')

/**
 * Grava em disco, na hora (síncrono), a call em que a pessoa está: o app fecha logo
 * depois pra instalar, e o armazenamento da página nem sempre chega a ser salvo.
 */
function saveRejoin(rejoin: unknown) {
  try {
    if (rejoin && typeof rejoin === 'object') writeFileSync(rejoinFile(), JSON.stringify(rejoin))
    else forgetRejoin()
  } catch (err) {
    console.warn('atualização: não deu pra gravar a call pra voltar', err)
  }
}

function forgetRejoin() {
  rmSync(rejoinFile(), { force: true })
}

/** A call gravada antes de reiniciar (uma vez só). */
export function takeRejoin(): unknown {
  try {
    const saved = JSON.parse(readFileSync(rejoinFile(), 'utf8')) as unknown
    forgetRejoin()
    return saved
  } catch {
    return null
  }
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
  autoUpdater.on('update-available', (info) => {
    set({ status: 'available', version: info.version })
    if (!inCall) void downloadUpdate()
  })
  autoUpdater.on('download-progress', (progress) => {
    if (state.status === 'downloading') set({ ...state, percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (event) => {
    downloadedFile = event.downloadedFile
    set({ status: 'ready', version: event.version })
  })
  autoUpdater.on('error', (err) => set({ status: 'error', message: err?.message ?? String(err) }))

  // Confere sozinho pouco depois de abrir e a cada 30 minutos.
  setTimeout(() => checkForUpdates(), 10_000)
  setInterval(() => checkForUpdates(), CHECK_EVERY)
}

/** Entrou ou saiu de call: saindo, baixa o que estava esperando. */
export function setUpdaterCall(active: boolean) {
  inCall = active
  if (!active && state.status === 'available') void downloadUpdate()
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

export async function installUpdate(rejoin?: unknown) {
  // Antes de tudo (e antes do app fechar): a call pra voltar quando o app abrir de novo.
  saveRejoin(rejoin)
  if (state.status !== 'ready') return
  const version = state.version
  set({ status: 'installing', version })
  if (packageType() === 'pacman' && downloadedFile) return installPacman(downloadedFile, version)
  autoUpdater.quitAndInstall(false, true)
}

/** Este processo está com a trava "no new privileges" (aí o pkexec e o sudo daqui não funcionam). */
function noNewPrivs(): boolean {
  try {
    return /^NoNewPrivs:\s*1/m.test(readFileSync('/proc/self/status', 'utf8'))
  } catch {
    return false
  }
}

const hasSystemdRun = (): boolean => ['/usr/bin/systemd-run', '/bin/systemd-run'].some((path) => existsSync(path))

/** O que o app e o terminal precisam do ambiente desta sessão (o do systemd pode estar sem). */
const SESSION_ENV = [
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_TYPE',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_DESKTOP',
  'DESKTOP_SESSION',
  'DBUS_SESSION_BUS_ADDRESS',
  'PATH',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_MESSAGES',
  'ELECTRON_OZONE_PLATFORM_HINT',
  'RESENHA_PROFILE',
]

/** Monta o comando pra rodar fora deste processo (pelo systemd, sem a trava), ou direto se não tiver systemd. */
function outside(command: string[], options: { wait: boolean }): [string, string[]] {
  if (!hasSystemdRun()) return [command[0], command.slice(1)]
  const env = SESSION_ENV.filter((name) => process.env[name]).flatMap((name) => ['-E', name])
  return ['systemd-run', ['--user', '--collect', '--quiet', ...(options.wait ? ['--wait'] : []), ...env, '--', ...command]]
}

function run(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.on('error', () => resolve(null))
    child.on('exit', (code) => resolve(code))
  })
}

/** Abre o app de novo assim que este processo terminar (o app só aceita uma janela aberta). */
function relaunchWhenGone() {
  const script = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done; exec "$0"`
  const [command, args] = outside(['sh', '-c', script, process.execPath], { wait: false })
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

async function installPacman(file: string, version: string) {
  if (noNewPrivs()) console.warn('atualização: este processo tem a trava "no new privileges"; o pkexec vai pelo systemd')
  const code = await run(...outside(['pkexec', 'pacman', '-U', '--noconfirm', file], { wait: true }))
  if (code === 0) {
    relaunchWhenGone()
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
  const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`
  const script = [
    `echo 'Atualizando o Resenha pra versão ${version}. Digite sua senha:'`,
    // Se não der, mostra o erro em vez de fechar (e reabrir a versão velha) sem dizer nada.
    `sudo pacman -U --noconfirm ${quote(file)} || { echo; echo 'Não deu pra atualizar. Aperte Enter pra abrir o Resenha.'; read -r _; }`,
    `setsid ${quote(process.execPath)} >/dev/null 2>&1 &`,
    'sleep 1',
  ].join('; ')
  const [command, args] = outside([terminal.command, ...terminal.args, 'bash', '-c', script], { wait: false })
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
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
