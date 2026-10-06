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
let current: ScreenAudioOptions = { mode: 'all', apps: [] }

export interface ScreenAudioOptions {
  /** all: tudo menos apps de voz; apps: só os escolhidos (pelo binário). */
  mode: 'all' | 'apps'
  apps: string[]
}

/**
 * Apps de voz/chamada: o som deles nunca entra no áudio da tela por padrão,
 * senão quem assiste ouve a sua call do Discord, por exemplo.
 */
const VOICE_APPS = [
  'vesktop', 'discord', 'discordcanary', 'discordptb', 'discord-canary', 'discord-ptb', 'legcord', 'armcord',
  'webcord', 'equibop', 'dorion', 'teamspeak', 'teamspeak3', 'ts3client', 'ts3client_linux_amd64', 'mumble',
  'zoom', 'zoom.real', 'teams', 'teams-for-linux', 'skypeforlinux', 'slack', 'element', 'element-desktop',
  'signal', 'signal-desktop', 'telegram-desktop', 'whatsapp', 'whatsapp-for-linux', 'zapzap', 'ferdium', 'jitsi',
]

const isVoiceApp = (value: string | undefined) => !!value && VOICE_APPS.includes(value.toLowerCase())

export interface PlayingApp {
  binary: string
  name: string
  voice: boolean
}

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

/** Apps tocando som agora (pro seletor), sem o próprio Resenha. Só leitura: não mexe em nada. */
export function listPlayingApps(): PlayingApp[] {
  const pb = obtain()
  if (!pb) return []
  const pid = audioServicePid()
  const apps = new Map<string, PlayingApp>()
  for (const node of pb.list(['application.name'])) {
    if (node['media.class'] !== 'Stream/Output/Audio' || node['application.process.id'] === pid) continue
    const binary = node['application.process.binary'] || node['application.name']
    if (!binary || apps.has(binary)) continue
    apps.set(binary, { binary, name: node['application.name'] || binary, voice: isVoiceApp(binary) || isVoiceApp(node['application.name']) })
  }
  return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function link(pb: PatchBay, mute: boolean): boolean {
  const pid = audioServicePid()
  const exclude: Node[] = [{ 'media.class': 'Stream/Input/Audio' }]
  if (pid) exclude.push({ 'application.process.id': pid })
  linkedPid = pid

  if (current.mode === 'apps') {
    const include: Node[] = current.apps.flatMap((app): Node[] => [{ 'application.process.binary': app }, { 'application.name': app }])
    return pb.link({ include, exclude, mute, ignore_devices: true, only_speakers: true, only_default_speakers: true })
  }

  // O venmic compara propriedades por igualdade exata: entra a lista fixa (minúscula e com
  // inicial maiúscula) e os nomes exatos de quem está tocando agora.
  for (const app of VOICE_APPS) {
    const capitalized = app[0].toUpperCase() + app.slice(1)
    for (const variant of new Set([app, capitalized])) {
      exclude.push({ 'application.process.binary': variant }, { 'application.name': variant })
    }
  }
  for (const node of pb.list(['application.name'])) {
    if (isVoiceApp(node['application.process.binary']) || isVoiceApp(node['application.name'])) {
      if (node['application.process.binary']) exclude.push({ 'application.process.binary': node['application.process.binary'] })
      exclude.push({ 'application.name': node['application.name'] })
    }
  }
  return pb.link({ exclude, mute, ignore_devices: true, only_speakers: true, only_default_speakers: true })
}

export function startScreenAudio(options: ScreenAudioOptions = { mode: 'all', apps: [] }): { ok: boolean; error?: string } {
  const pb = obtain()
  if (!pb) return { ok: false, error: 'PipeWire/venmic indisponível' }
  current = options.mode === 'apps' && options.apps.length > 0 ? options : { mode: 'all', apps: [] }
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
  patchBay?.unmute()
}

/** Só mexe no PipeWire se o venmic chegou a ser usado. */
export function stopScreenAudio() {
  stopWatchdog()
  patchBay?.unlink()
  linkedPid = null
}

function stopWatchdog() {
  if (watchdog) clearInterval(watchdog)
  watchdog = null
}
