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
}

export function formatTripPlanSummary(plan: TripPlanResult): string {
  if (plan.type === 'direct' && plan.legs[0]) {
    const l = plan.legs[0]
    const lineLabel = l.linea ? `L${l.linea}` : l.eot_nombre
    return (
      `Viaje directo (1 itinerario) · ${lineLabel} (${l.eot_nombre}). ` +
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
      `Viaje con transbordo en ${t} (punto C).` +
      (ac || cb ? `${ac}${cb}.` : ' ') +
      ` 1) ${a.linea ? `L${a.linea}` : a.eot_nombre}: ${a.boarding.name} → ${a.alighting.name}.` +
      ` 2) ${b.linea ? `L${b.linea}` : b.eot_nombre}: ${b.boarding.name} → ${b.alighting.name}.`
    )
  }
  return 'Plan de viaje calculado.'
}
