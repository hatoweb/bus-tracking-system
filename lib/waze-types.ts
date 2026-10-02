export type WazeAlertType =
  | "ACCIDENT"
  | "JAM"
  | "ROAD_CLOSED"
  | "HAZARD"
  | string

export interface WazeAlert {
  id: string
  type: WazeAlertType
  subtype?: string
  street: string
  municipio?: string
  location: {
    lat: number
    lon: number
  }
  report_rating?: number
  reliability: number
  descripcion?: string
  pubMillis?: number
}

export interface WazeJam {
  id: string
  street: string
  municipio?: string
  speedKMH: number
  freeFlowSpeedKMH: number
  delaySeconds: number
  lengthMeters: number
  level: number // 1 a 5
  line: Array<{
    lat: number
    lon: number
  }>
}

export interface WazeData {
  alerts: WazeAlert[]
  jams: WazeJam[]
  source: string
  timestamp: string
}
