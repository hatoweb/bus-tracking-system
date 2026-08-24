export type BusAccesibilidad = {
  tiene_rampa: boolean | null
  id_bus: number | null
  numero_orden: number | null
}

/**
 * GPS mean_id es hexadecimal de la unidad operativa (ej. 0000c → 12).
 * En CID se cruza con buses.numero_orden vía bus_empresa
 * (agency_id GPS = bus_empresa.id_eot).
 */
export function meanIdToNumeroOrden(meanId: string | null | undefined): number | null {
  const raw = String(meanId ?? '').trim()
  if (!raw || !/^[0-9a-fA-F]+$/.test(raw)) return null
  const n = parseInt(raw, 16)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** ETA aproximado en minutos a partir de distancia y velocidad. */
export function estimateEtaMinutes(
  distanceMeters: number | null | undefined,
  speedKmh: number | null | undefined
): number | null {
  if (
    distanceMeters == null ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0
  ) {
    return null
  }
  const speed = Number(speedKmh)
  if (!Number.isFinite(speed) || speed < 3 || speed > 120) return null
  const hours = distanceMeters / 1000 / speed
  const mins = Math.round(hours * 60)
  if (mins < 1) return 1
  if (mins > 180) return null
  return mins
}

export function formatDistanceLabel(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000
    return `${km.toLocaleString('es-PY', {
      minimumFractionDigits: km >= 10 ? 0 : 1,
      maximumFractionDigits: 1,
    })} km`
  }
  return `${Math.round(meters)} m`
}
