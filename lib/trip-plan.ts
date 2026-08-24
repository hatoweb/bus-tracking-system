/** Un tramo de viaje (directo o parte de un transbordo). */
export type TripLeg = {
  leg: number
  id_itinerario: number
  ruta_hex: string
  linea: string | null
  ramal: string | null
  eot_nombre: string
  cod_catalogo: number
  boarding: {
    id: number
    name: string
    lat: number | null
    lng: number | null
  }
  alighting: {
    id: number
    name: string
    lat: number | null
    lng: number | null
  }
  num_stops?: number
  estimated_ride_min?: number
}

export type TripTransfer = {
  id: number
  name: string
  lat: number | null
  lng: number | null
  type?: 'same_stop' | 'walk'
  from_stop_id?: number
  from_stop_name?: string
  to_stop_id?: number
  to_stop_name?: string
  to_lat?: number | null
  to_lng?: number | null
  walk_distance_m?: number
  walk_time_min?: number
  dist_a_c_m?: number
  dist_c_b_m?: number
  total_m?: number
}

/** Plan directo (1 itinerario) o con transbordo (2 itinerarios). */
export type TripPlanResult = {
  type: 'direct' | 'transfer'
  legs: TripLeg[]
  transfer?: TripTransfer
  score: number
  /** Posición en la lista de opciones (1 = mejor) */
  rank?: number
  walk_origin_m?: number
  walk_dest_m?: number
  walk_transfer_m?: number
  total_walk_m?: number
  total_walk_min?: number
  total_ride_min?: number
  total_duration_min?: number
}

export function formatTripPlanSummary(plan: TripPlanResult): string {
  if (plan.type === 'direct' && plan.legs[0]) {
    const l = plan.legs[0]
    const lineLabel = l.linea ? `L${l.linea}` : l.eot_nombre
    const walkOri =
      plan.walk_origin_m && plan.walk_origin_m > 30
        ? `Caminá ${Math.round(plan.walk_origin_m)} m a ${l.boarding.name}. `
        : `Subí en ${l.boarding.name}. `
    const rideInfo =
      l.num_stops != null && l.estimated_ride_min != null
        ? `Viajá ${l.num_stops} paradas (~${Math.round(l.estimated_ride_min)} min) en ${lineLabel} (${l.eot_nombre}). `
        : `Tomá ${lineLabel} (${l.eot_nombre}). `
    const walkDst =
      plan.walk_dest_m && plan.walk_dest_m > 30
        ? `Bajá en ${l.alighting.name} y caminá ${Math.round(plan.walk_dest_m)} m a tu destino.`
        : `Bajá en ${l.alighting.name}.`

    return `Opción directa · ${lineLabel}: ${walkOri}${rideInfo}${walkDst}`
  }

  if (plan.type === 'transfer' && plan.legs.length >= 2) {
    const [a, b] = plan.legs
    const lineA = a.linea ? `L${a.linea}` : a.eot_nombre
    const lineB = b.linea ? `L${b.linea}` : b.eot_nombre

    const isWalk =
      plan.transfer?.type === 'walk' ||
      (plan.transfer?.walk_distance_m != null &&
        plan.transfer.walk_distance_m > 20)

    const walkTransferTxt = isWalk
      ? ` 2) Caminá ${Math.round(plan.transfer?.walk_distance_m || 0)} m a ${plan.transfer?.to_stop_name || b.boarding.name}.`
      : ` 2) En la misma parada (${plan.transfer?.name || a.alighting.name}), hacé transbordo.`

    return (
      `Opción con transbordo: ` +
      `1) Tomá ${lineA} en ${a.boarding.name} hasta ${a.alighting.name}.` +
      walkTransferTxt +
      ` 3) Tomá ${lineB} hasta ${b.alighting.name}.`
    )
  }

  return 'Plan de viaje calculado.'
}

/** Clave de deduplicación: misma empresa/línea = misma opción para el usuario. */
function optionDedupeKey(plan: TripPlanResult): string {
  if (plan.type === 'direct' && plan.legs[0]) {
    const l = plan.legs[0]
    const linea = (l.linea || '').trim()
    return `d|${l.cod_catalogo}|${linea}`
  }
  if (plan.type === 'transfer' && plan.legs.length >= 2) {
    const [a, b] = plan.legs
    return `t|${a.cod_catalogo}|${(a.linea || '').trim()}|${b.cod_catalogo}|${(b.linea || '').trim()}`
  }
  return `x|${plan.legs.map((l) => l.id_itinerario).join('-')}`
}

/** Hasta N opciones: primero directos, luego transbordos (sin repetir empresa/línea). */
export function buildTripOptions(
  direct: TripPlanResult[],
  transfers: TripPlanResult[],
  limit = 3
): TripPlanResult[] {
  const out: TripPlanResult[] = []
  const seen = new Set<string>()

  const pushUnique = (plan: TripPlanResult) => {
    if (out.length >= limit) return
    const key = optionDedupeKey(plan)
    if (seen.has(key)) return
    seen.add(key)
    out.push(plan)
  }

  for (const d of direct) pushUnique(d)
  for (const t of transfers) pushUnique(t)

  return out.map((p, i) => ({ ...p, rank: i + 1 }))
}
