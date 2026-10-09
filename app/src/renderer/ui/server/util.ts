// Pequenas coisas que as telas do servidor dividem: opções, textos de tempo, imagem do ícone.

import { fmt, m } from '../../lib/i18n.svelte'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// ---------- Opções que o servidor aceita ----------
// Funções (e não listas prontas): os rótulos saem no idioma de quando a tela pede.

/** Validade do convite, em segundos (0 = não vence). */
export function inviteAges(): { value: string; label: string }[] {
  const t = m.server.time
  return [
    { value: '1800', label: t.minutes(30) },
    { value: '3600', label: t.hours(1) },
    { value: '21600', label: t.hours(6) },
    { value: '43200', label: t.hours(12) },
    { value: '86400', label: t.days(1) },
    { value: '604800', label: t.days(7) },
    { value: '0', label: t.forever },
  ]
}

/** Usos do convite ("none" = sem limite). */
export function inviteUses(): { value: string; label: string }[] {
  return [
    { value: 'none', label: m.server.time.noLimit },
    ...[1, 5, 10, 25, 50, 100].map((n) => ({ value: String(n), label: m.server.shared.people(n) })),
  ]
}

export function inviteOptions(age: string, uses: string): { maxAge: number; maxUses: number | null } {
  return { maxAge: Number(age), maxUses: uses === 'none' ? null : Number(uses) }
}

/** Modo lento, em segundos. */
export function slowmodes(): { value: string; label: string }[] {
  const t = m.server.time
  return [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600].map((seconds) => ({
    value: String(seconds),
    label:
      seconds === 0
        ? t.off
        : seconds < 60
          ? t.secondsShort(seconds)
          : seconds < 3600
            ? t.minutesShort(seconds / 60)
            : t.hoursShort(seconds / 3600),
  }))
}

/** Castigo, em minutos. */
export function timeouts(): { value: string; label: string }[] {
  const t = m.server.time
  return [
    { value: '1', label: t.minutesShort(1) },
    { value: '5', label: t.minutesShort(5) },
    { value: '10', label: t.minutesShort(10) },
    { value: '60', label: t.hours(1) },
    { value: '1440', label: t.days(1) },
    { value: '10080', label: t.days(7) },
  ]
}

/** "10 minutos", "1 hora", "1 semana". */
export function durationText(minutes: number): string {
  const t = m.server.time
  if (minutes % 10080 === 0) return t.weeks(minutes / 10080)
  if (minutes % 1440 === 0) return t.days(minutes / 1440)
  if (minutes % 60 === 0) return t.hours(minutes / 60)
  return t.minutes(minutes)
}

// ---------- Texto ----------

/** Pra busca: sem acento e sem caixa. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Igual ao servidor: espaços juntos e sem sobra nas pontas. */
export function cleanName(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** "agora", "há 3 horas", "ontem", "em 6 dias". */
export function relative(ms: number, now: number): string {
  const diff = ms - now
  const abs = Math.abs(diff)
  if (abs < 45_000) return m.server.time.now
  if (abs < HOUR) return fmt.relative(Math.round(diff / MINUTE), 'minute')
  if (abs < DAY) return fmt.relative(Math.round(diff / HOUR), 'hour')
  if (abs < 30 * DAY) return fmt.relative(Math.round(diff / DAY), 'day')
  if (abs < 365 * DAY) return fmt.relative(Math.round(diff / (30 * DAY)), 'month')
  return fmt.relative(Math.round(diff / (365 * DAY)), 'year')
}

/** "5 out 2026". */
export function shortDate(ms: number): string {
  return fmt.date(ms, { day: 'numeric', month: 'short', year: 'numeric' }).replaceAll(' de ', ' ').replace('.', '')
}

const clock = (ms: number) => fmt.date(ms, { hour: '2-digit', minute: '2-digit' })

/** "14:32" hoje, senão "5 out 2026, 14:32". */
export function whenText(ms: number, now: number): string {
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString()
  return sameDay ? clock(ms) : `${shortDate(ms)}, ${clock(ms)}`
}

// ---------- Área de transferência ----------

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// ---------- Ícone do servidor ----------

const MAX_ICON_BYTES = 512 * 1024
const ICON_SIZE = 512

/**
 * Ícone escolhido -> quadrado de no máximo 512 px (recorte no centro), em WebP
 * de até 512 KB (PNG se o WebP não sair). O servidor recusa acima disso.
 */
export async function iconBlob(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(m.server.icon.notImage)
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const size = Math.min(ICON_SIZE, side)
    const canvas = new OffscreenCanvas(size, size)
    const g = canvas.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality })
      if (blob.type !== 'image/webp') break
      if (blob.size <= MAX_ICON_BYTES) return blob
    }
    const png = await canvas.convertToBlob({ type: 'image/png' })
    if (png.size <= MAX_ICON_BYTES) return png
    throw new Error(m.server.icon.tooBig)
  } finally {
    bitmap.close()
  }
}

/** Abre o seletor de arquivos do sistema (só imagens). */
export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}
