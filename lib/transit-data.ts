export type BusStatus = "stopped" | "moving" | "near" | "arrival"

export type Stop = {
  id: string
  name: string
  // Coordenadas en el lienzo del mapa (0-100)
  x: number
  y: number
  order: number
}

export type Bus = {
  id: string
  line: string
  plate: string
  driver: string
  // posición a lo largo de la ruta, de 0 a 1
  progress: number
  // velocidad de avance por tick
  speedFactor: number
  status: BusStatus
  speedKmh: number
  passengers: number
  capacity: number
  // Estado de simulación: ticks que el bus permanece detenido en una parada
  dwellTicks: number
  // Última parada donde el bus hizo detención
  lastStopId: string | null
}

export type ScheduleEntry = {
  id: string
  line: string
  departure: string
  arrival: string
  frequency: string
  status: "en-curso" | "programado" | "finalizado" | "retrasado"
}

// Recorrido definido como puntos de una polilínea sobre el mapa (0-100)
export const ROUTE_PATH: { x: number; y: number }[] = [
  { x: 8, y: 82 },
  { x: 18, y: 74 },
  { x: 26, y: 60 },
  { x: 34, y: 52 },
  { x: 44, y: 50 },
  { x: 52, y: 42 },
  { x: 58, y: 30 },
  { x: 68, y: 26 },
  { x: 78, y: 30 },
  { x: 86, y: 22 },
  { x: 92, y: 12 },
]

export const STOPS: Stop[] = [
  { id: "p1", name: "Terminal Sur", x: 8, y: 82, order: 1 },
  { id: "p2", name: "Av. Los Andes", x: 26, y: 60, order: 2 },
  { id: "p3", name: "Plaza Central", x: 44, y: 50, order: 3 },
  { id: "p4", name: "Hospital Regional", x: 58, y: 30, order: 4 },
  { id: "p5", name: "Universidad", x: 78, y: 30, order: 5 },
  { id: "p6", name: "Terminal Norte", x: 92, y: 12, order: 6 },
]

export const INITIAL_BUSES: Bus[] = [
  {
    id: "b1",
    line: "L1",
    plate: "BUS-1024",
    driver: "M. Fernández",
    progress: 0.08,
    speedFactor: 0.0022,
    status: "moving",
    speedKmh: 34,
    passengers: 22,
    capacity: 48,
    dwellTicks: 0,
    lastStopId: null,
  },
  {
    id: "b2",
    line: "L1",
    plate: "BUS-1047",
    driver: "J. Rojas",
    progress: 0.35,
    speedFactor: 0.0018,
    status: "moving",
    speedKmh: 28,
    passengers: 41,
    capacity: 48,
    dwellTicks: 0,
    lastStopId: null,
  },
  {
    id: "b3",
    line: "L1",
    plate: "BUS-1063",
    driver: "C. Medina",
    progress: 0.62,
    speedFactor: 0.0019,
    status: "stopped",
    speedKmh: 0,
    passengers: 18,
    capacity: 48,
    dwellTicks: 4,
    lastStopId: "p4",
  },
  {
    id: "b4",
    line: "L1",
    plate: "BUS-1088",
    driver: "A. Salazar",
    progress: 0.86,
    speedFactor: 0.0016,
    status: "near",
    speedKmh: 19,
    passengers: 30,
    capacity: 48,
    dwellTicks: 0,
    lastStopId: null,
  },
]

export const SCHEDULE: ScheduleEntry[] = [
  { id: "s1", line: "L1", departure: "05:30", arrival: "06:20", frequency: "cada 10 min", status: "finalizado" },
  { id: "s2", line: "L1", departure: "06:00", arrival: "06:50", frequency: "cada 10 min", status: "finalizado" },
  { id: "s3", line: "L1", departure: "07:15", arrival: "08:05", frequency: "cada 8 min", status: "en-curso" },
  { id: "s4", line: "L1", departure: "07:45", arrival: "08:35", frequency: "cada 8 min", status: "en-curso" },
  { id: "s5", line: "L1", departure: "08:10", arrival: "09:00", frequency: "cada 12 min", status: "retrasado" },
  { id: "s6", line: "L1", departure: "08:40", arrival: "09:30", frequency: "cada 12 min", status: "programado" },
  { id: "s7", line: "L1", departure: "09:20", arrival: "10:10", frequency: "cada 15 min", status: "programado" },
]

export const STATUS_LABEL: Record<BusStatus, string> = {
  stopped: "Detenido",
  moving: "En movimiento",
  near: "Cercano",
  arrival: "Llegando a parada",
}

export const STATUS_DESCRIPTION: Record<BusStatus, string> = {
  stopped: "El vehículo se encuentra detenido.",
  moving: "El vehículo circula con normalidad.",
  near: "El vehículo se aproxima a una parada.",
  arrival: "El vehículo está llegando a la parada.",
}

// Devuelve el color (token CSS) asociado a cada estado
export const STATUS_COLOR_VAR: Record<BusStatus, string> = {
  stopped: "var(--status-stopped)",
  moving: "var(--status-moving)",
  near: "var(--status-near)",
  arrival: "var(--status-arrival)",
}

// Interpola una posición (x,y) a lo largo de la ruta según un progreso 0..1
export function positionOnRoute(progress: number): { x: number; y: number; angle: number } {
  const p = Math.max(0, Math.min(1, progress))
  const total = ROUTE_PATH.length - 1
  const scaled = p * total
  const i = Math.min(Math.floor(scaled), total - 1)
  const t = scaled - i
  const a = ROUTE_PATH[i]
  const b = ROUTE_PATH[i + 1]
  const x = a.x + (b.x - a.x) * t
  const y = a.y + (b.y - a.y) * t
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  return { x, y, angle }
}

// Distancia (en unidades de progreso) a la parada más cercana por delante
export function nearestStopInfo(progress: number): { stop: Stop; distance: number } {
  const stopProgress = STOPS.map((s) => ({
    stop: s,
    prog: s.order === 1 ? 0 : (s.order - 1) / (STOPS.length - 1),
  }))
  let best = stopProgress[0]
  let bestDist = Number.POSITIVE_INFINITY
  for (const sp of stopProgress) {
    const d = Math.abs(sp.prog - progress)
    if (d < bestDist) {
      bestDist = d
      best = sp
    }
  }
  return { stop: best.stop, distance: bestDist }
}
