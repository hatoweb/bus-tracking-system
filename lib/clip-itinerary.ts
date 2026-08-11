import { haversineMeters } from "@/lib/bus-passed-stop"

type LngLat = [number, number] // GeoJSON: [lng, lat]
type LatLng = { lat: number; lng: number }

function nearestVertexIndex(coords: LngLat[], point: LatLng): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < coords.length; i++) {
    const [lng, lat] = coords[i]
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const d = haversineMeters(lat, lng, point.lat, point.lng)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/** Longitud aproximada de un tramo de coordenadas */
function pathLengthMeters(coords: LngLat[]): number {
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])
  }
  return total
}

/**
 * Recorta una polilínea entre el punto más cercano al origen
 * y el más cercano al destino (soporta anillos/itinerarios circulares).
 */
export function clipCoordsBetween(
  coords: LngLat[],
  start: LatLng,
  end: LatLng
): LngLat[] {
  if (!coords || coords.length < 2) return coords || []

  const iStart = nearestVertexIndex(coords, start)
  const iEnd = nearestVertexIndex(coords, end)

  if (iStart === iEnd) {
    // Incluir un poco de contexto alrededor
    const from = Math.max(0, iStart - 1)
    const to = Math.min(coords.length - 1, iEnd + 1)
    return coords.slice(from, to + 1)
  }

  if (iStart < iEnd) {
    const direct = coords.slice(iStart, iEnd + 1)
    // Camino largo dando la vuelta (por si el sentido útil es el anillo)
    const around = [...coords.slice(iStart), ...coords.slice(0, iEnd + 1)]
    // Preferir el camino directo salvo que sea absurdamente más largo
    // y el around sea claramente más corto (anillo)
    if (
      around.length > direct.length + 2 &&
      pathLengthMeters(around) < pathLengthMeters(direct) * 0.85
    ) {
      return around
    }
    return direct
  }

  // iStart > iEnd: comparar wrap vs tramo inverso
  const wrapped = [...coords.slice(iStart), ...coords.slice(0, iEnd + 1)]
  const reversed = coords.slice(iEnd, iStart + 1).slice().reverse()
  return pathLengthMeters(wrapped) <= pathLengthMeters(reversed) ? wrapped : reversed
}

/** Extrae LineStrings de un geometry GeoJSON */
function extractLineCoords(geometry: any): LngLat[][] {
  if (!geometry) return []
  const t = geometry.type
  if (t === "LineString" && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates as LngLat[]]
  }
  if (t === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates as LngLat[][]
  }
  if (t === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    return geometry.geometries.flatMap((g: any) => extractLineCoords(g))
  }
  // A veces el API ya manda el geometry "desnudo" como coordinates
  if (Array.isArray(geometry.coordinates) && Array.isArray(geometry.coordinates[0])) {
    const first = geometry.coordinates[0]
    if (typeof first[0] === "number") {
      return [geometry.coordinates as LngLat[]]
    }
    if (Array.isArray(first[0])) {
      return geometry.coordinates as LngLat[][]
    }
  }
  return []
}

/**
 * Recorta un GeoJSON de itinerario para mostrar solo el tramo útil
 * origen (abordaje) → destino (o parada cercana al destino).
 */
export function clipItineraryGeoJSON(
  geometry: any,
  start: LatLng | null | undefined,
  end: LatLng | null | undefined
): any | null {
  if (!geometry || !end) return geometry || null

  const lines = extractLineCoords(geometry)
  if (lines.length === 0) return geometry

  // Elegir la línea cuyo punto más cercano al destino esté más cerca
  let bestLine = lines[0]
  let bestEndDist = Infinity
  for (const line of lines) {
    if (line.length < 2) continue
    const i = nearestVertexIndex(line, end)
    const [lng, lat] = line[i]
    const d = haversineMeters(lat, lng, end.lat, end.lng)
    if (d < bestEndDist) {
      bestEndDist = d
      bestLine = line
    }
  }

  const origin = start || { lat: bestLine[0][1], lng: bestLine[0][0] }
  let clipped = clipCoordsBetween(bestLine, origin, end)

  // Asegurar que el último punto quede en/cerca del destino
  if (clipped.length >= 1) {
    const last = clipped[clipped.length - 1]
    const distLast = haversineMeters(last[1], last[0], end.lat, end.lng)
    if (distLast > 40) {
      clipped = [...clipped, [end.lng, end.lat]]
    }
  }

  if (clipped.length < 2) return geometry

  return {
    type: "LineString",
    coordinates: clipped,
  }
}

/** Elige la parada de destino más cercana al punto destino (fallback: el propio destino) */
export function pickTripEndPoint(
  destination: LatLng,
  destStops?: Array<{
    latitud: number
    longitud: number
    distancia_m?: number
    isAlightingRecommended?: boolean
  }> | null
): LatLng {
  if (destStops && destStops.length > 0) {
    const preferred = destStops.filter((s) => s.isAlightingRecommended)
    const pool = preferred.length > 0 ? preferred : destStops
    const sorted = [...pool].sort(
      (a, b) => (a.distancia_m ?? Infinity) - (b.distancia_m ?? Infinity)
    )
    const best = sorted[0]
    if (Number.isFinite(best.latitud) && Number.isFinite(best.longitud)) {
      return { lat: best.latitud, lng: best.longitud }
    }
  }
  return destination
}
