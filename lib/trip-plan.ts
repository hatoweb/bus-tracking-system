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
}

/** Plan directo (1 itinerario) o con transbordo (2 itinerarios unidos en C). */
export type TripPlanResult = {
  type: 'direct' | 'transfer'
  legs: TripLeg[]
  transfer?: {
    id: number
    name: string
    lat: number | null
    lng: number | null
    dist_a_c_m?: number
    dist_c_b_m?: number
    total_m?: number
  }
  score: number
  /** Posición en la lista de opciones (1 = mejor) */
  rank?: number
}

export function formatTripPlanSummary(plan: TripPlanResult): string {
  if (plan.type === 'direct' && plan.legs[0]) {
    const l = plan.legs[0]
    const lineLabel = l.linea ? `L${l.linea}` : l.eot_nombre
    return (
      `Opción directa (1 itinerario · sentido A→B) · ${lineLabel} (${l.eot_nombre}). ` +
      `Subí en ${l.boarding.name}; bajá en ${l.alighting.name}.`
    )
  }
  if (plan.type === 'transfer' && plan.legs.length >= 2) {
    const [a, b] = plan.legs
    const t = plan.transfer?.name || a.alighting.name
    const ac =
      plan.transfer?.dist_a_c_m != null
        ? ` A→C ${Math.round(plan.transfer.dist_a_c_m)} m`
        : ''
    const cb =
      plan.transfer?.dist_c_b_m != null
        ? ` · C→B ${Math.round(plan.transfer.dist_c_b_m)} m`
        : ''
    return (
      `Opción con transbordo en ${t} (sentido A→C→B).` +
      (ac || cb ? `${ac}${cb}.` : ' ') +
      ` 1) ${a.linea ? `L${a.linea}` : a.eot_nombre}: ${a.boarding.name} → ${a.alighting.name}.` +
      ` 2) ${b.linea ? `L${b.linea}` : b.eot_nombre}: ${b.boarding.name} → ${b.alighting.name}.`
    )
  }
  return 'Plan de viaje calculado.'
}

/** Clave de deduplicación: misma empresa/línea = misma opción para el usuario. */
function optionDedupeKey(plan: TripPlanResult): string {
  if (plan.type === 'direct' && plan.legs[0]) {
    const l = plan.legs[0]
    const linea = (l.linea || '').trim()
    // Una opción directa por empresa (+ línea si existe); no repetir ramales/paradas.
    return `d|${l.cod_catalogo}|${linea}`
  }
  if (plan.type === 'transfer' && plan.legs.length >= 2) {
    const [a, b] = plan.legs
    return `t|${a.cod_catalogo}|${(a.linea || '').trim()}|${b.cod_catalogo}|${(b.linea || '').trim()}`
  }
  return `x|${plan.legs.map((l) => l.id_itinerario).join('-')}`
}

/** Hasta 3 opciones: primero directos, luego transbordos más cortos (sin repetir empresa/línea). */
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

  // Directos ya vienen ordenados por score; el primero de cada clave gana.
  for (const d of direct) pushUnique(d)
  for (const t of transfers) pushUnique(t)

  return out.map((p, i) => ({ ...p, rank: i + 1 }))
}
