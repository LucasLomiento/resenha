// Áudio da tela no Linux, sem a voz da call.
//
// O venmic (o mesmo do Vesktop) cria no PipeWire um microfone virtual,
// "vencord-screen-share", e liga nele a saída de todos os apps que tocam no
// alto-falante padrão, menos os excluídos. Excluímos o processo "Audio
// Service" do Chromium, que é por onde sai TODO o som do app (vozes da call,
// som de tela que você está assistindo, notificações), e qualquer captura de
// microfone. O renderer depois pega esse microfone virtual com getUserMedia.

import type { Node, PatchBay } from '@vencord/venmic'
import { app } from 'electron'
import { join } from 'node:path'

let patchBay: PatchBay | null | undefined
let linkedPid: string | null = null
let watchdog: NodeJS.Timeout | null = null

function obtain(): PatchBay | null {
  if (patchBay !== undefined) return patchBay
  patchBay = null
  if (process.platform !== 'linux') return null
  try {
    // Empacotado, vai só o binário pronto (em resources/); o pacote npm do
    // venmic arrasta o cmake-js inteiro, que só serve pra compilar.
    const venmic = (
      app.isPackaged ? require(join(process.resourcesPath, `venmic-${process.arch}.node`)) : require('@vencord/venmic')
    ) as typeof import('@vencord/venmic')
    if (venmic.PatchBay.hasPipeWire()) patchBay = new venmic.PatchBay()
    else console.warn('venmic: PipeWire não encontrado')
  } catch (err) {
    console.error('venmic: falhou ao carregar', err)
  }
  return patchBay
}

export function screenAudioAvailable(): boolean {
  return obtain() !== null
}

function audioServicePid(): string | null {
  return app.getAppMetrics().find((p) => p.name === 'Audio Service')?.pid?.toString() ?? null
}

function link(pb: PatchBay, mute: boolean): boolean {
  const pid = audioServicePid()
  const exclude: Node[] = [{ 'media.class': 'Stream/Input/Audio' }]
  if (pid) exclude.push({ 'application.process.id': pid })
  linkedPid = pid
  return pb.link({
    exclude,
    mute,
    ignore_devices: true,
    only_speakers: true,
    only_default_speakers: true,
  })
}

export function startScreenAudio(): { ok: boolean; error?: string } {
  const pb = obtain()
  if (!pb) return { ok: false, error: 'PipeWire/venmic indisponível' }
  // Começa mudo e o renderer desmuta depois de pegar o microfone virtual,
  // igual o Vesktop faz, pra não vazar um estalo antes da captura começar.
  if (!link(pb, true)) return { ok: false, error: 'venmic não conseguiu ligar o áudio' }

  // Se o processo de áudio do Chromium reiniciar, o PID muda e a exclusão
  // deixaria a voz da call passar. Confere e religa.
  stopWatchdog()
  watchdog = setInterval(() => {
    const pid = audioServicePid()
    if (pid !== linkedPid) {
      console.warn(`venmic: Audio Service mudou de PID (${linkedPid} -> ${pid}), religando`)
      link(pb, false)
    }
  }, 3000)
  return { ok: true }
}

export function unmuteScreenAudio() {
  obtain()?.unmute()
}

export function stopScreenAudio() {
  stopWatchdog()
  obtain()?.unlink()
  linkedPid = null
}

function stopWatchdog() {
  if (watchdog) clearInterval(watchdog)
  watchdog = null
}
