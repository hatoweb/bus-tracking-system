/** Distancia Haversine en metros */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Rumbo geográfico 0–360° desde (lat1,lon1) hacia (lat2,lon2) */
export function bearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export { angleDiffDeg }

/**
 * ¿La parada sirve para ir al destino?
 * - Si está en el set de abordaje del viaje → candidato.
 * - Si hay bearing de la parada, debe apuntar hacia el destino (±90°).
 */
export function stopServesDestination(opts: {
  stopLat: number
  stopLng: number
  stopBearing?: number | null
  destination: { lat: number; lng: number }
  isBoardingCandidate?: boolean
  maxBearingDiffDeg?: number
}): { ok: boolean; reason: string; bearingToDest?: number; bearingDiff?: number } {
  const {
    stopLat,
    stopLng,
    stopBearing,
    destination,
    isBoardingCandidate = true,
    maxBearingDiffDeg = 90,
  } = opts

  if (!isBoardingCandidate) {
    return {
      ok: false,
      reason: "Esta parada no está vinculada a líneas que llegan a tu destino.",
    }
  }

  const bearingToDest = bearingDegrees(
    stopLat,
    stopLng,
    destination.lat,
    destination.lng
  )
  const course = stopBearing != null ? Number(stopBearing) : NaN

  if (!Number.isFinite(course) || course === 0) {
    // Sin bearing útil: confiar en el vínculo de líneas
    return { ok: true, reason: "Parada vinculada al destino.", bearingToDest }
  }

  const diff = angleDiffDeg(course, bearingToDest)
  if (diff > maxBearingDiffDeg) {
    return {
      ok: false,
      reason:
        "El sentido de esta parada (bearing) no apunta hacia tu destino. Elegí la parada del otro lado / sentido correcto.",
      bearingToDest,
      bearingDiff: Math.round(diff),
    }
  }

  return {
    ok: true,
    reason: "Parada en el sentido correcto hacia el destino.",
    bearingToDest,
    bearingDiff: Math.round(diff),
  }
}

export type StopRef = { lat: number; lng: number }
export type DestRef = { lat: number; lng: number }

/**
 * Heurística: el bus ya pasó la parada de abordaje (no sirve subir ahí).
 * - Si hay destino: más cerca del destino que la parada → ya pasó hacia allá.
 * - Si hay rumbo: se aleja de la parada (> ~100°) y no está encima de ella.
 */
export function hasBusPassedBoardingStop(opts: {
  busLat: number
  busLng: number
  rumbo?: number | null
  stop: StopRef
  destination?: DestRef | null
  /** Radio en el que aún se considera "en la parada" */
  atStopMeters?: number
}): boolean {
  const {
    busLat,
    busLng,
    rumbo,
    stop,
    destination,
    atStopMeters = 90,
  } = opts

  if (
    !Number.isFinite(busLat) ||
    !Number.isFinite(busLng) ||
    !Number.isFinite(stop.lat) ||
    !Number.isFinite(stop.lng)
  ) {
    return false
  }

  const distBusStop = haversineMeters(busLat, busLng, stop.lat, stop.lng)
  if (distBusStop <= atStopMeters) return false

  if (
    destination &&
    Number.isFinite(destination.lat) &&
    Number.isFinite(destination.lng)
  ) {
    const distBusDest = haversineMeters(
      busLat,
      busLng,
      destination.lat,
      destination.lng
    )
    const distStopDest = haversineMeters(
      stop.lat,
      stop.lng,
      destination.lat,
      destination.lng
    )
    // Margen ~70 m para GPS / curvatura
    if (distBusDest + 70 < distStopDest) return true
  }

  const course = rumbo != null ? Number(rumbo) : NaN
  if (Number.isFinite(course) && distBusStop > 100) {
    const toStop = bearingDegrees(busLat, busLng, stop.lat, stop.lng)
    // Rumbo apuntando lejos de la parada → ya la dejó atrás
    if (angleDiffDeg(course, toStop) > 100) return true
  }

  return false
}

/**
 * True si el bus ya pasó la parada de referencia del viaje
 * (elegida, o la recomendada más cercana al bus).
 */
export function evaluateBusVsBoardingStops(opts: {
  busLat: number
  busLng: number
  rumbo?: number | null
  boardingStops: StopRef[]
  destination?: DestRef | null
}): boolean {
  const { boardingStops } = opts
  if (!boardingStops.length) return false

  // Evaluar contra la parada de abordaje más cercana al bus
  let nearest = boardingStops[0]
  let nearestDist = Infinity
  for (const s of boardingStops) {
    const d = haversineMeters(opts.busLat, opts.busLng, s.lat, s.lng)
    if (d < nearestDist) {
      nearestDist = d
      nearest = s
    }
  }

  return hasBusPassedBoardingStop({
    busLat: opts.busLat,
    busLng: opts.busLng,
    rumbo: opts.rumbo,
    stop: nearest,
    destination: opts.destination,
  })
}
