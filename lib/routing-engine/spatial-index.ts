import { Footpath, Stop } from './types'

/** Radio medio de la Tierra en metros */
const EARTH_RADIUS_M = 6371000

/** Velocidad promedio de caminata humana: ~1.2 m/s (72 m/min, 4.32 km/h) */
export const WALKING_SPEED_M_PER_MIN = 72

/**
 * Distancia Haversine precisa en metros entre dos puntos geográficos (WGS84).
 */
export function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}

export interface NearbyStopResult {
  stop: Stop
  distance_m: number
}

/**
 * Índice espacial en grilla (Spatial Hash Grid) para búsquedas de proximidad en O(1)/O(k).
 */
export class SpatialStopIndex {
  private cellSizeDeg: number
  private grid = new Map<string, Stop[]>()

  constructor(cellSizeDeg = 0.005) {
    // 0.005 grados ≈ 550 metros
    this.cellSizeDeg = cellSizeDeg
  }

  private cellKey(lat: number, lng: number): string {
    const r = Math.floor(lat / this.cellSizeDeg)
    const c = Math.floor(lng / this.cellSizeDeg)
    return `${r}:${c}`
  }

  public insert(stop: Stop): void {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return
    const key = this.cellKey(stop.lat, stop.lng)
    let cell = this.grid.get(key)
    if (!cell) {
      cell = []
      this.grid.set(key, cell)
    }
    cell.push(stop)
  }

  public build(stops: Iterable<Stop>): void {
    this.grid.clear()
    for (const s of stops) {
      this.insert(s)
    }
  }

  /**
   * Encuentra paradas cercanas a un punto (lat, lng) dentro de maxRadiusM.
   */
  public findNearby(
    lat: number,
    lng: number,
    maxRadiusM = 1000,
    maxResults = 25
  ): NearbyStopResult[] {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []

    // Grados de tolerancia según radio
    const latSpan = (maxRadiusM / 111320) * 1.1
    const lngSpan =
      (maxRadiusM / (111320 * Math.cos((lat * Math.PI) / 180) || 1)) * 1.1

    const minLat = lat - latSpan
    const maxLat = lat + latSpan
    const minLng = lng - lngSpan
    const maxLng = lng + lngSpan

    const minR = Math.floor(minLat / this.cellSizeDeg)
    const maxR = Math.floor(maxLat / this.cellSizeDeg)
    const minC = Math.floor(minLng / this.cellSizeDeg)
    const maxC = Math.floor(maxLng / this.cellSizeDeg)

    const candidates: NearbyStopResult[] = []

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const cell = this.grid.get(`${r}:${c}`)
        if (!cell) continue

        for (const stop of cell) {
          const dist = haversineDistanceM(lat, lng, stop.lat, stop.lng)
          if (dist <= maxRadiusM) {
            candidates.push({ stop, distance_m: Math.round(dist) })
          }
        }
      }
    }

    candidates.sort((a, b) => a.distance_m - b.distance_m)
    return candidates.slice(0, maxResults)
  }
}

/**
 * Precalcula conexiones a pie (footpaths) entre paradas que distan <= maxWalkM.
 */
export function buildFootpaths(
  stopsMap: Map<number, Stop>,
  spatialIndex: SpatialStopIndex,
  maxWalkM = 350
): Map<number, Footpath[]> {
  const footpaths = new Map<number, Footpath[]>()

  for (const [stopId, stop] of stopsMap.entries()) {
    const nearby = spatialIndex.findNearby(stop.lat, stop.lng, maxWalkM, 20)
    const paths: Footpath[] = []

    for (const item of nearby) {
      if (item.stop.id === stopId) continue // no caminar a la misma parada
      paths.push({
        to_stop_id: item.stop.id,
        distance_m: item.distance_m,
        walk_time_min: Number((item.distance_m / WALKING_SPEED_M_PER_MIN).toFixed(1)),
      })
    }

    if (paths.length > 0) {
      footpaths.set(stopId, paths)
    }
  }

  return footpaths
}
