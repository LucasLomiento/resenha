import type { MapView, StreetSpot } from '../../shared/protocol'

// Mapa compartilhado de cada servidor: o que vem do app (vista, cursor,
// marcador) é conferido aqui antes de ir pros outros ou pro banco.

/** O MapLibre não passa disso (mais perto do polo a projeção estoura). */
const MAX_LAT = 85.06
const MAX_ZOOM = 24
const MAX_PITCH = 85

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits

function finite(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
}

/** Volta pro intervalo -180..180 (o mapa dá a volta no mundo e a longitude passa disso). */
function wrap(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

/** Um ponto no mapa (cursor ou marcador), ou null se não for. */
export function cleanPoint(lng: unknown, lat: unknown): { lng: number; lat: number } | null {
  if (!finite(lng, 100_000) || !finite(lat, 90)) return null
  return { lng: round(wrap(lng), 6), lat: round(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)), 6) }
}

/** Lugar do Street View (ponto + direção), ou null se não for. */
export function cleanStreet(value: unknown): StreetSpot | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const at = cleanPoint(v.lng, v.lat)
  if (!at || !finite(v.heading, 100_000)) return null
  return { ...at, heading: round(((v.heading % 360) + 360) % 360, 1) }
}

export function cleanView(value: unknown): MapView | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const at = cleanPoint(v.lng, v.lat)
  if (!at || !finite(v.zoom, 1000) || !finite(v.bearing, 100_000) || !finite(v.pitch, 1000)) return null
  return {
    ...at,
    zoom: round(Math.max(0, Math.min(MAX_ZOOM, v.zoom)), 3),
    bearing: round(wrap(v.bearing), 2),
    pitch: round(Math.max(0, Math.min(MAX_PITCH, v.pitch)), 2),
  }
}

/** A vista guardada no banco (texto JSON), ou null. */
export function parseView(text: string | null): MapView | null {
  if (!text) return null
  try {
    return cleanView(JSON.parse(text))
  } catch {
    return null
  }
}
