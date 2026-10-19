// O ícone da bandeja no Linux só pode nascer com a barra pronta.
//
// O Electron pergunta UMA vez, ao criar o Tray, se há quem receba o ícone: o
// StatusNotifierWatcher com um host registrado (no Omarchy, os dois são a barra). Se não
// houver, cai no ícone antigo do GTK, que no Wayland não aparece, e nunca mais tenta. No
// login o Resenha abre junto com a barra e às vezes chega antes dela: o app fica de pé,
// escondido e sem ícone. Daí esperar a barra (mesma saída da Lousa, `quadro-negro/src/bandeja.js`).
// Depois de inscrito, a barra reiniciar não é problema: o Electron se reinscreve sozinho.
// No X11 o ícone antigo do GTK aparece (bandeja XEmbed: i3, polybar, LXDE): sem watcher
// nenhum, cria na hora, como antes da 1.14.5.
// Sem nada do Electron aqui: o teste roda no Node.

import { execFile } from 'node:child_process'

const WATCHER = 'org.kde.StatusNotifierWatcher'

/**
 * - ready: a barra está pronta pra receber ícones
 * - waiting: tem watcher, mas nenhuma barra se registrou ainda
 * - absent: nem watcher (GNOME sem a extensão de AppIndicator, i3 só com XEmbed...)
 * - unknown: não dá pra perguntar (sem busctl, sem barramento)
 */
export type TrayHost = 'ready' | 'waiting' | 'absent' | 'unknown'

function busctl(args: string[]): Promise<{ out: string; error: boolean; missing: boolean }> {
  return new Promise((resolve) => {
    execFile('busctl', ['--user', ...args], { timeout: 3000 }, (err, stdout) =>
      resolve({ out: String(stdout).trim(), error: !!err, missing: (err as NodeJS.ErrnoException | null)?.code === 'ENOENT' }),
    )
  })
}

/** Como está a barra agora (pelo D-Bus da sessão). */
export async function trayHostState(): Promise<TrayHost> {
  const owner = await busctl(['call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner', 's', WATCHER])
  if (owner.missing || owner.error) return 'unknown'
  if (owner.out === 'b false') return 'absent'
  const host = await busctl(['get-property', WATCHER, '/StatusNotifierWatcher', WATCHER, 'IsStatusNotifierHostRegistered'])
  return !host.error && host.out === 'b true' ? 'ready' : 'waiting'
}

type WaitOptions = {
  ask?: () => Promise<TrayHost>
  interval?: number
  limit?: number
  /** Depois do limite, no Wayland: de quanto em quanto tempo ainda pergunta (a barra pode subir depois). */
  slowInterval?: number
  platform?: NodeJS.Platform
  /** Sessão Wayland: lá o ícone antigo do GTK não aparece nunca. */
  wayland?: boolean
  /** Wayland, passado o limite sem barra: não tem onde pôr o ícone (por enquanto). */
  onGiveUp?: () => void
}

const isWayland = () => process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY

/**
 * Chama `create` quando a barra estiver pronta. Fora do Linux ou sem como perguntar, chama na
 * hora. No X11, sem watcher nenhum ou passado o `limit`, chama do mesmo jeito (fica o ícone do
 * GTK). No Wayland, passado o `limit`, avisa `onGiveUp` e continua perguntando devagar: se a
 * barra aparecer depois, cria. Devolve o cancelar.
 */
export function whenTrayHostReady(
  create: () => void,
  {
    ask = trayHostState,
    interval = 1000,
    limit = 120_000,
    slowInterval = 15_000,
    platform = process.platform,
    wayland = isWayland(),
    onGiveUp,
  }: WaitOptions = {},
): () => void {
  if (platform !== 'linux') {
    create()
    return () => {}
  }
  let cancelled = false
  let gaveUp = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const start = Date.now()
  const attempt = async () => {
    const host = await ask()
    if (cancelled) return
    if (host === 'ready' || host === 'unknown' || (!wayland && host === 'absent')) return create()
    if (Date.now() - start >= limit) {
      if (!wayland) return create()
      if (!gaveUp) {
        gaveUp = true
        onGiveUp?.()
      }
    }
    timer = setTimeout(attempt, gaveUp ? slowInterval : interval)
  }
  void attempt()
  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
