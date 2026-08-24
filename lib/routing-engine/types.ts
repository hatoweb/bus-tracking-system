export interface Stop {
  id: number
  source_id: string | null
  name: string
  lat: number
  lng: number
  bearing: number | null
}

export interface Footpath {
  to_stop_id: number
  distance_m: number
  walk_time_min: number
}

export interface ItineraryStopEntry {
  stop_id: number
  order: number
}

export interface ItineraryPattern {
  id_itinerario: number
  ruta_hex: string
  linea: string | null
  ramal: string | null
  eot_nombre: string
  cod_catalogo: number
  stops: ItineraryStopEntry[]
  /** Mapa stop_id -> posición en el array stops para búsqueda O(1) */
  stopIndexMap: Map<number, number>
}

export interface StopPassage {
  id_itinerario: number
  stop_index: number
}

export interface TransitNetwork {
  version: number
  loadedAt: number
  stops: Map<number, Stop>
  itineraries: Map<number, ItineraryPattern>
  /** Por cada parada, qué itinerarios pasan por ella y en qué posición */
  stopToItineraries: Map<number, StopPassage[]>
  /** Por cada parada, paradas cercanas a las que se puede caminar */
  footpaths: Map<number, Footpath[]>
}

export interface PlannedStop {
  id: number
  name: string
  lat: number | null
  lng: number | null
}

export interface PlannedTripLeg {
  leg: number
  id_itinerario: number
  ruta_hex: string
  linea: string | null
  ramal: string | null
  eot_nombre: string
  cod_catalogo: number
  boarding: PlannedStop
  alighting: PlannedStop
  num_stops: number
  estimated_ride_min: number
}

export interface PlannedTransfer {
  type: 'same_stop' | 'walk'
  id: number
  name: string
  lat: number | null
  lng: number | null
  from_stop_id: number
  from_stop_name: string
  to_stop_id: number
  to_stop_name: string
  to_lat: number | null
  to_lng: number | null
  walk_distance_m: number
  walk_time_min: number
  dist_a_c_m?: number
  dist_c_b_m?: number
  total_m?: number
}

export interface PlannedTripOption {
  type: 'direct' | 'transfer'
  legs: PlannedTripLeg[]
  transfer?: PlannedTransfer
  walk_origin_m: number
  walk_dest_m: number
  walk_transfer_m: number
  total_walk_m: number
  total_walk_min: number
  total_ride_min: number
  total_duration_min: number
  score: number
  rank?: number
}
