// O ícone da bandeja no Linux só pode nascer com a barra pronta.
//
// O Electron pergunta UMA vez, ao criar o Tray, se há quem receba o ícone: o
// StatusNotifierWatcher com um host registrado (no Omarchy, os dois são a barra). Se não
// houver, cai no ícone antigo do GTK, que no Wayland não aparece, e nunca mais tenta. No
// login o Resenha abre junto com a barra e às vezes chega antes dela: o app fica de pé,
// escondido e sem ícone. Daí esperar a barra (mesma saída da Lousa, `quadro-negro/src/bandeja.js`).
// Depois de inscrito, a barra reiniciar não é problema: o Electron se reinscreve sozinho.
// Sem nada do Electron aqui: o teste roda no Node.

import { execFile } from 'node:child_process'

const WATCHER = 'org.kde.StatusNotifierWatcher'

/** A barra está pronta pra receber ícones? null quando não dá pra perguntar (sem busctl). */
export function trayHostReady(): Promise<boolean | null> {
  return new Promise((resolve) => {
    execFile(
      'busctl',
      ['--user', 'get-property', WATCHER, '/StatusNotifierWatcher', WATCHER, 'IsStatusNotifierHostRegistered'],
      { timeout: 3000 },
      (err, stdout) => {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') resolve(null)
        else resolve(!err && String(stdout).trim() === 'b true')
      },
    )
  })
}

type WaitOptions = {
  ask?: () => Promise<boolean | null>
  interval?: number
  limit?: number
  platform?: NodeJS.Platform
}

/**
 * Chama `create` quando a barra estiver pronta. Fora do Linux, sem como perguntar ou passado
 * o `limit`, chama do mesmo jeito (sem barra nenhuma, fica o que o Electron conseguir, como
 * antes). Devolve o cancelar.
 */
export function whenTrayHostReady(
  create: () => void,
  { ask = trayHostReady, interval = 1000, limit = 120_000, platform = process.platform }: WaitOptions = {},
): () => void {
  if (platform !== 'linux') {
    create()
    return () => {}
  }
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const start = Date.now()
  const attempt = async () => {
    const ready = await ask()
    if (cancelled) return
    if (ready !== false || Date.now() - start >= limit) {
      create()
      return
    }
    timer = setTimeout(attempt, interval)
  }
  void attempt()
  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
