import {
  haversineDistanceM,
  SpatialStopIndex,
  WALKING_SPEED_M_PER_MIN,
} from './spatial-index'
import {
  ItineraryPattern,
  PlannedStop,
  PlannedTransfer,
  PlannedTripLeg,
  PlannedTripOption,
  Stop,
  TransitNetwork,
} from './types'

export interface RoutePlanQuery {
  latOrigen: number
  lngOrigen: number
  latDestino: number
  lngDestino: number
  origenParadaIds?: number[]
  destinoParadaIds?: number[]
  codCatalogo?: number | null
  maxOptions?: number
  maxWalkOriginM?: number
  maxWalkDestM?: number
  maxWalkTransferM?: number
}

/** Tiempo estimado en minutos por cada parada intermedia en bus (~40 seg) */
const TIME_PER_BUS_STOP_MIN = 0.65

/** Tiempo de espera estimado para transbordo en minutos */
const TRANSFER_WAIT_PENALTY_MIN = 7.0

/** Ponderador de fatiga al caminar (Google Maps / OTP usa ~1.5x respecto al tiempo a bordo) */
const WALK_FATIGUE_FACTOR = 1.4

function dedupeKey(option: PlannedTripOption): string {
  if (option.type === 'direct' && option.legs[0]) {
    const l = option.legs[0]
    const linea = (l.linea || '').trim()
    return `d|${l.cod_catalogo}|${linea}`
  }
  if (option.type === 'transfer' && option.legs.length >= 2) {
    const [a, b] = option.legs
    return `t|${a.cod_catalogo}|${(a.linea || '').trim()}|${b.cod_catalogo}|${(b.linea || '').trim()}`
  }
  return `x|${option.legs.map((l) => l.id_itinerario).join('-')}`
}

export function planJourney(
  network: TransitNetwork,
  spatialIndex: SpatialStopIndex,
  query: RoutePlanQuery
): PlannedTripOption[] {
  const {
    latOrigen,
    lngOrigen,
    latDestino,
    lngDestino,
    origenParadaIds = [],
    destinoParadaIds = [],
    codCatalogo = null,
    maxOptions = 3,
    maxWalkOriginM = 1200,
    maxWalkDestM = 1200,
    maxWalkTransferM = 350,
  } = query

  // 1) Encontrar paradas candidatas de Origen
  const originCandidateMap = new Map<number, { stop: Stop; walk_m: number }>()

  // Paradas provistas explícitamente
  for (const id of origenParadaIds) {
    const s = network.stops.get(id)
    if (s) {
      const dist = Math.round(haversineDistanceM(latOrigen, lngOrigen, s.lat, s.lng))
      originCandidateMap.set(id, { stop: s, walk_m: dist })
    }
  }

  // Búsqueda espacial de proximidad
  const spatialOrigin = spatialIndex.findNearby(latOrigen, lngOrigen, maxWalkOriginM, 15)
  for (const item of spatialOrigin) {
    if (!originCandidateMap.has(item.stop.id)) {
      originCandidateMap.set(item.stop.id, { stop: item.stop, walk_m: item.distance_m })
    }
  }

  // 2) Encontrar paradas candidatas de Destino
  const destCandidateMap = new Map<number, { stop: Stop; walk_m: number }>()

  for (const id of destinoParadaIds) {
    const s = network.stops.get(id)
    if (s) {
      const dist = Math.round(haversineDistanceM(latDestino, lngDestino, s.lat, s.lng))
      destCandidateMap.set(id, { stop: s, walk_m: dist })
    }
  }

  const spatialDest = spatialIndex.findNearby(latDestino, lngDestino, maxWalkDestM, 15)
  for (const item of spatialDest) {
    if (!destCandidateMap.has(item.stop.id)) {
      destCandidateMap.set(item.stop.id, { stop: item.stop, walk_m: item.distance_m })
    }
  }

  if (originCandidateMap.size === 0 || destCandidateMap.size === 0) {
    return []
  }

  const directOptions: PlannedTripOption[] = []
  const transferOptions: PlannedTripOption[] = []

  // -------------------------------------------------------------
  // FASE 1: Búsqueda de Viajes Directos (0 transbordos / 1 bus)
  // -------------------------------------------------------------
  for (const [originStopId, originEntry] of originCandidateMap.entries()) {
    const passages = network.stopToItineraries.get(originStopId)
    if (!passages) continue

    for (const passage of passages) {
      const itin = network.itineraries.get(passage.id_itinerario)
      if (!itin) continue

      if (codCatalogo != null && itin.cod_catalogo !== codCatalogo) {
        continue
      }

      const oIndex = passage.stop_index
      // Recorrer las paradas posteriores de este itinerario
      for (let dIndex = oIndex + 1; dIndex < itin.stops.length; dIndex++) {
        const destStopEntry = itin.stops[dIndex]
        const destCandidate = destCandidateMap.get(destStopEntry.stop_id)

        if (destCandidate) {
          const numStops = dIndex - oIndex
          const walkOriginM = originEntry.walk_m
          const walkDestM = destCandidate.walk_m
          const totalWalkM = walkOriginM + walkDestM
          const walkMin = totalWalkM / WALKING_SPEED_M_PER_MIN
          const rideMin = numStops * TIME_PER_BUS_STOP_MIN + 2.0 // tiempo base

          const score =
            walkMin * WALK_FATIGUE_FACTOR +
            rideMin +
            (walkOriginM + walkDestM) * 0.02

          const leg: PlannedTripLeg = {
            leg: 1,
            id_itinerario: itin.id_itinerario,
            ruta_hex: itin.ruta_hex,
            linea: itin.linea,
            ramal: itin.ramal,
            eot_nombre: itin.eot_nombre,
            cod_catalogo: itin.cod_catalogo,
            boarding: {
              id: originEntry.stop.id,
              name: originEntry.stop.name,
              lat: originEntry.stop.lat,
              lng: originEntry.stop.lng,
            },
            alighting: {
              id: destCandidate.stop.id,
              name: destCandidate.stop.name,
              lat: destCandidate.stop.lat,
              lng: destCandidate.stop.lng,
            },
            num_stops: numStops,
            estimated_ride_min: Number(rideMin.toFixed(1)),
          }

          directOptions.push({
            type: 'direct',
            legs: [leg],
            walk_origin_m: walkOriginM,
            walk_dest_m: walkDestM,
            walk_transfer_m: 0,
            total_walk_m: totalWalkM,
            total_walk_min: Number(walkMin.toFixed(1)),
            total_ride_min: Number(rideMin.toFixed(1)),
            total_duration_min: Number((walkMin + rideMin).toFixed(1)),
            score,
          })
        }
      }
    }
  }

  // -------------------------------------------------------------
  // FASE 2: Búsqueda con Transbordo (1 transbordo / 2 buses + caminata)
  // -------------------------------------------------------------
  // Solo se calcula si se necesitan más opciones o variedad
  for (const [originStopId, originEntry] of originCandidateMap.entries()) {
    const passages1 = network.stopToItineraries.get(originStopId)
    if (!passages1) continue

    for (const passage1 of passages1) {
      const itin1 = network.itineraries.get(passage1.id_itinerario)
      if (!itin1) continue

      if (codCatalogo != null && itin1.cod_catalogo !== codCatalogo) {
        continue
      }

      const oIndex = passage1.stop_index
      const maxHops1 = Math.min(oIndex + 40, itin1.stops.length - 1)

      // Recorrer paradas intermedias para bajar del primer bus (C1)
      for (let c1Index = oIndex + 1; c1Index <= maxHops1; c1Index++) {
        const c1StopId = itin1.stops[c1Index].stop_id
        const c1Stop = network.stops.get(c1StopId)
        if (!c1Stop) continue

        // Paradas de transbordo posibles desde C1:
        // a) La misma parada C1 (caminata = 0)
        // b) Paradas conectadas por footpath (caminata <= maxWalkTransferM)
        const transferCandidates: Array<{
          to_stop: Stop
          walk_m: number
          walk_min: number
        }> = [{ to_stop: c1Stop, walk_m: 0, walk_min: 0 }]

        const footpaths = network.footpaths.get(c1StopId)
        if (footpaths) {
          for (const fp of footpaths) {
            if (fp.distance_m <= maxWalkTransferM) {
              const fpStop = network.stops.get(fp.to_stop_id)
              if (fpStop) {
                transferCandidates.push({
                  to_stop: fpStop,
                  walk_m: fp.distance_m,
                  walk_min: fp.walk_time_min,
                })
              }
            }
          }
        }

        // Evaluar subida al segundo bus (C2)
        for (const tc of transferCandidates) {
          const c2Stop = tc.to_stop
          const passages2 = network.stopToItineraries.get(c2Stop.id)
          if (!passages2) continue

          for (const passage2 of passages2) {
            const itin2 = network.itineraries.get(passage2.id_itinerario)
            if (!itin2) continue
            // Evitar transbordar al mismo itinerario
            if (itin2.id_itinerario === itin1.id_itinerario) continue

            const c2Index = passage2.stop_index
            const maxHops2 = Math.min(c2Index + 40, itin2.stops.length - 1)

            for (let dIndex = c2Index + 1; dIndex <= maxHops2; dIndex++) {
              const destStopEntry = itin2.stops[dIndex]
              const destCandidate = destCandidateMap.get(destStopEntry.stop_id)

              if (destCandidate) {
                const hops1 = c1Index - oIndex
                const hops2 = dIndex - c2Index

                const walkOriginM = originEntry.walk_m
                const walkTransferM = tc.walk_m
                const walkDestM = destCandidate.walk_m
                const totalWalkM = walkOriginM + walkTransferM + walkDestM
                const totalWalkMin = totalWalkM / WALKING_SPEED_M_PER_MIN

                const ride1Min = hops1 * TIME_PER_BUS_STOP_MIN + 2.0
                const ride2Min = hops2 * TIME_PER_BUS_STOP_MIN + 2.0
                const totalRideMin = ride1Min + ride2Min

                const totalDurationMin =
                  totalWalkMin + totalRideMin + TRANSFER_WAIT_PENALTY_MIN

                const score =
                  totalWalkMin * WALK_FATIGUE_FACTOR +
                  totalRideMin +
                  TRANSFER_WAIT_PENALTY_MIN +
                  (walkOriginM + walkDestM + walkTransferM) * 0.02 +
                  (hops1 + hops2) * 0.15

                const leg1: PlannedTripLeg = {
                  leg: 1,
                  id_itinerario: itin1.id_itinerario,
                  ruta_hex: itin1.ruta_hex,
                  linea: itin1.linea,
                  ramal: itin1.ramal,
                  eot_nombre: itin1.eot_nombre,
                  cod_catalogo: itin1.cod_catalogo,
                  boarding: {
                    id: originEntry.stop.id,
                    name: originEntry.stop.name,
                    lat: originEntry.stop.lat,
                    lng: originEntry.stop.lng,
                  },
                  alighting: {
                    id: c1Stop.id,
                    name: c1Stop.name,
                    lat: c1Stop.lat,
                    lng: c1Stop.lng,
                  },
                  num_stops: hops1,
                  estimated_ride_min: Number(ride1Min.toFixed(1)),
                }

                const leg2: PlannedTripLeg = {
                  leg: 2,
                  id_itinerario: itin2.id_itinerario,
                  ruta_hex: itin2.ruta_hex,
                  linea: itin2.linea,
                  ramal: itin2.ramal,
                  eot_nombre: itin2.eot_nombre,
                  cod_catalogo: itin2.cod_catalogo,
                  boarding: {
                    id: c2Stop.id,
                    name: c2Stop.name,
                    lat: c2Stop.lat,
                    lng: c2Stop.lng,
                  },
                  alighting: {
                    id: destCandidate.stop.id,
                    name: destCandidate.stop.name,
                    lat: destCandidate.stop.lat,
                    lng: destCandidate.stop.lng,
                  },
                  num_stops: hops2,
                  estimated_ride_min: Number(ride2Min.toFixed(1)),
                }

                const transfer: PlannedTransfer = {
                  type: tc.walk_m > 20 ? 'walk' : 'same_stop',
                  id: c1Stop.id,
                  name:
                    tc.walk_m > 20
                      ? `${c1Stop.name} ➔ ${c2Stop.name} (${tc.walk_m} m a pie)`
                      : c1Stop.name,
                  lat: c1Stop.lat,
                  lng: c1Stop.lng,
                  from_stop_id: c1Stop.id,
                  from_stop_name: c1Stop.name,
                  to_stop_id: c2Stop.id,
                  to_stop_name: c2Stop.name,
                  to_lat: c2Stop.lat,
                  to_lng: c2Stop.lng,
                  walk_distance_m: tc.walk_m,
                  walk_time_min: tc.walk_min,
                  dist_a_c_m: Math.round(
                    haversineDistanceM(latOrigen, lngOrigen, c1Stop.lat, c1Stop.lng)
                  ),
                  dist_c_b_m: Math.round(
                    haversineDistanceM(c2Stop.lat, c2Stop.lng, latDestino, lngDestino)
                  ),
                  total_m: Math.round(
                    haversineDistanceM(latOrigen, lngOrigen, c1Stop.lat, c1Stop.lng) +
                      haversineDistanceM(c2Stop.lat, c2Stop.lng, latDestino, lngDestino)
                  ),
                }

                transferOptions.push({
                  type: 'transfer',
                  legs: [leg1, leg2],
                  transfer,
                  walk_origin_m: walkOriginM,
                  walk_dest_m: walkDestM,
                  walk_transfer_m: walkTransferM,
                  total_walk_m: totalWalkM,
                  total_walk_min: Number(totalWalkMin.toFixed(1)),
                  total_ride_min: Number(totalRideMin.toFixed(1)),
                  total_duration_min: Number(totalDurationMin.toFixed(1)),
                  score,
                })
              }
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // FASE 3: Deduplicación y Selección de Mejores Opciones
  // -------------------------------------------------------------
  directOptions.sort((a, b) => a.score - b.score)
  transferOptions.sort((a, b) => a.score - b.score)

  const finalOptions: PlannedTripOption[] = []
  const seenKeys = new Set<string>()

  const pushUnique = (plan: PlannedTripOption) => {
    if (finalOptions.length >= maxOptions) return
    const key = dedupeKey(plan)
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    finalOptions.push(plan)
  }

  // Directos primero
  for (const d of directOptions) {
    pushUnique(d)
  }

  // Luego transbordos
  for (const t of transferOptions) {
    pushUnique(t)
  }

  return finalOptions.map((opt, i) => ({
    ...opt,
    rank: i + 1,
  }))
}
