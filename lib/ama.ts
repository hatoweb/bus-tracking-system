/**
 * Área Metropolitana de Asunción (AMA):
 * Asunción + distritos de Central definidos para el proyecto.
 */

/** viewbox Nominatim: left,top,right,bottom = minLon,maxLat,maxLon,minLat */
export const AMA_NOMINATIM_VIEWBOX = '-57.72,-25.12,-57.28,-25.52'

/** Bounding box [minLng, minLat, maxLng, maxLat] */
export const AMA_BBOX = {
  minLng: -57.72,
  minLat: -25.52,
  maxLng: -57.28,
  maxLat: -25.12,
} as const

/** Distritos Central incluidos en AMA (sin tildes, lower) */
export const AMA_CENTRAL_DISTRITOS = [
  'lambare',
  'limpio',
  'villa elisa',
  'nemby',
  'ypane',
  'fernando de la mora',
  'mariano roque alonso',
  'luque',
  'san lorenzo',
  'san antonio',
  'capiata',
  'aregua',
  'itaugua',
] as const

export function stripAccents(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function isInsideAmaBbox(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lng >= AMA_BBOX.minLng &&
    lng <= AMA_BBOX.maxLng &&
    lat >= AMA_BBOX.minLat &&
    lat <= AMA_BBOX.maxLat
  )
}

/** ¿El texto menciona Asunción, Central o un distrito AMA? */
export function textLooksLikeAma(text: string): boolean {
  const n = stripAccents(text)
  if (!n) return false
  if (
    n.includes('asuncion') ||
    n.includes('distrito capital') ||
    n.includes('gran asuncion') ||
    n.includes('area metropolitana')
  ) {
    return true
  }
  if (n.includes('central') && (n.includes('paraguay') || n.includes('departamento'))) {
    return true
  }
  if (AMA_CENTRAL_DISTRITOS.some((d) => n.includes(d))) return true

  // Abreviaciones frecuentes en catalogo_rutas
  if (n.includes('mariano') && n.includes('alonso')) return true
  if (n.includes('fernando') && n.includes('mora')) return true
  if (n.includes('fdo') && n.includes('mora')) return true
  if (n.includes('villa elisa') || n.includes('v. elisa')) return true
  if (n.includes('san lorenzo') || n.includes('s. lorenzo')) return true
  if (n.includes('san antonio')) return true

  return false
}

/**
 * Filtra un resultado Nominatim al AMA por bbox y/o address.
 */
export function nominatimResultInAma(item: {
  lat?: string | number
  lon?: string | number
  display_name?: string
  address?: Record<string, string>
}): boolean {
  const lat = Number(item.lat)
  const lng = Number(item.lon)
  if (isInsideAmaBbox(lat, lng)) return true

  const addr = item.address || {}
  const parts = [
    item.display_name,
    addr.city,
    addr.town,
    addr.municipality,
    addr.county,
    addr.state,
    addr.suburb,
    addr.city_district,
  ]
    .filter(Boolean)
    .join(' ')

  return textLooksLikeAma(parts)
}
