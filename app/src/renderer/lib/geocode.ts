// Busca de endereço pelo Nominatim (OpenStreetMap), de graça e sem chave. As
// regras de uso pedem no máximo uma busca por segundo e nada de autocompletar:
// a tela só busca quando a pessoa aperta Enter, e aqui ainda espera o segundo passar.

export interface Place {
  name: string
  /** O resto do endereço (bairro, cidade, estado, país). */
  detail: string
  lng: number
  lat: number
  /** Oeste, sul, leste, norte. */
  bbox: [number, number, number, number] | null
}

interface NominatimResult {
  lat: string
  lon: string
  name?: string
  display_name: string
  boundingbox?: [string, string, string, string]
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const cache = new Map<string, Place[]>()
let nextAt = 0

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (!q) return []
  const key = q.toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached
  const wait = nextAt - Date.now()
  nextAt = Math.max(nextAt, Date.now()) + 1000
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  const params = new URLSearchParams({ format: 'jsonv2', q, limit: '5', 'accept-language': 'pt-BR' })
  const res = await fetch(`${ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(res.status === 429 ? 'Muitas buscas seguidas. Espere um pouco.' : 'A busca não respondeu. Tente de novo.')
  const places = ((await res.json()) as NominatimResult[]).map(toPlace).filter((p): p is Place => !!p)
  if (cache.size > 100) cache.clear()
  cache.set(key, places)
  return places
}

function toPlace(r: NominatimResult): Place | null {
  const lat = Number(r.lat)
  const lng = Number(r.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const parts = r.display_name.split(', ')
  const name = r.name?.trim() || parts[0] || r.display_name
  const detail = parts.filter((part, i) => !(i === 0 && part === name)).join(', ')
  // O Nominatim manda sul, norte, oeste, leste.
  const box = r.boundingbox?.map(Number)
  const bbox = box && box.length === 4 && box.every(Number.isFinite) ? ([box[2], box[0], box[3], box[1]] as Place['bbox']) : null
  return { name, detail, lng, lat, bbox }
}
