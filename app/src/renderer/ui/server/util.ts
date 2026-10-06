// Pequenas coisas que as telas do servidor dividem: opções, textos de tempo, imagem do ícone.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// ---------- Opções que o servidor aceita ----------

/** Validade do convite, em segundos (0 = não vence). */
export const INVITE_AGES: { value: string; label: string }[] = [
  { value: '1800', label: '30 minutos' },
  { value: '3600', label: '1 hora' },
  { value: '21600', label: '6 horas' },
  { value: '43200', label: '12 horas' },
  { value: '86400', label: '1 dia' },
  { value: '604800', label: '7 dias' },
  { value: '0', label: 'Sempre' },
]

/** Usos do convite ("none" = sem limite). */
export const INVITE_USES: { value: string; label: string }[] = [
  { value: 'none', label: 'Sem limite' },
  ...[1, 5, 10, 25, 50, 100].map((n) => ({ value: String(n), label: n === 1 ? '1 pessoa' : `${n} pessoas` })),
]

export function inviteOptions(age: string, uses: string): { maxAge: number; maxUses: number | null } {
  return { maxAge: Number(age), maxUses: uses === 'none' ? null : Number(uses) }
}

/** Modo lento, em segundos. */
export const SLOWMODES: { value: string; label: string }[] = [
  [0, 'Desligado'],
  [5, '5 s'],
  [10, '10 s'],
  [15, '15 s'],
  [30, '30 s'],
  [60, '1 min'],
  [120, '2 min'],
  [300, '5 min'],
  [600, '10 min'],
  [900, '15 min'],
  [1800, '30 min'],
  [3600, '1 h'],
  [7200, '2 h'],
  [21600, '6 h'],
].map(([value, label]) => ({ value: String(value), label: String(label) }))

/** Castigo, em minutos. */
export const TIMEOUTS: { value: string; label: string }[] = [
  { value: '1', label: '1 min' },
  { value: '5', label: '5 min' },
  { value: '10', label: '10 min' },
  { value: '60', label: '1 hora' },
  { value: '1440', label: '1 dia' },
  { value: '10080', label: '7 dias' },
]

/** "10 minutos", "1 hora", "1 semana". */
export function durationText(minutes: number): string {
  if (minutes % 10080 === 0) return plural(minutes / 10080, 'semana', 'semanas')
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'dia', 'dias')
  if (minutes % 60 === 0) return plural(minutes / 60, 'hora', 'horas')
  return plural(minutes, 'minuto', 'minutos')
}

// ---------- Texto ----------

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

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

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

/** "agora", "há 3 horas", "ontem", "em 6 dias". */
export function relative(ms: number, now: number): string {
  const diff = ms - now
  const abs = Math.abs(diff)
  if (abs < 45_000) return 'agora'
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), 'minute')
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), 'hour')
  if (abs < 30 * DAY) return rtf.format(Math.round(diff / DAY), 'day')
  if (abs < 365 * DAY) return rtf.format(Math.round(diff / (30 * DAY)), 'month')
  return rtf.format(Math.round(diff / (365 * DAY)), 'year')
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
const clockFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** "5 out 2026". */
export function shortDate(ms: number): string {
  return dateFmt.format(ms).replaceAll(' de ', ' ').replace('.', '')
}

/** "14:32" hoje, senão "5 out 2026, 14:32". */
export function whenText(ms: number, now: number): string {
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString()
  return sameDay ? clockFmt.format(ms) : `${shortDate(ms)}, ${clockFmt.format(ms)}`
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
    throw new Error('Esse arquivo não é uma imagem.')
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
    throw new Error('A imagem ficou grande demais. Tente outra.')
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
