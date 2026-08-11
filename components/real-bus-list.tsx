"use client"

import { Bus as BusIcon, Gauge, Clock, MapPin } from "lucide-react"
import { type RealBus } from "@/components/real-route-map"
import { STATUS_LABEL, STATUS_COLOR_VAR, type BusStatus } from "@/lib/transit-data"

export type RealBusWithDistance = RealBus & {
  distanceMeters?: number
  linea?: string
  ramal?: string
  linea_label?: string
  eot_nombre?: string
  velocidad_calculada?: number
  /** Ya pasó la parada de abordaje del viaje (no sirve subir) */
  passedBoardingStop?: boolean
}

type RealBusListProps = {
  buses: RealBusWithDistance[]
  selectedBusId: string | null
  onSelectBus: (id: string) => void
  /** Si true, solo muestra la(s) línea(s) más cercana(s) al usuario */
  onlyClosestLines?: boolean
  maxLines?: number
  avgSpeedKmh?: number | null
  userHasLocation?: boolean
}

export function getRealBusStatusKey(velocidad: number): BusStatus {
  if (!velocidad || velocidad === 0) return "stopped"
  if (velocidad <= 8) return "arrival"
  if (velocidad <= 20) return "near"
  return "moving"
}

/** Una entrada por mean_id, con distancia opcional, ordenada de más cerca a más lejos. */
export function prepareClosestLineBuses(
  buses: RealBusWithDistance[],
  maxLines = 3
): RealBusWithDistance[] {
  const unique = Array.from(new Map(buses.map((b) => [b.mean_id, b])).values())

  const withDist = unique
    .filter((b) => typeof b.distanceMeters === "number" && Number.isFinite(b.distanceMeters))
    .sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0))

  if (withDist.length === 0) {
    return unique.slice(0, maxLines)
  }

  // Preferir buses que aún no pasaron la parada; luego por distancia
  const ranked = [...withDist].sort((a, b) => {
    const ap = a.passedBoardingStop ? 1 : 0
    const bp = b.passedBoardingStop ? 1 : 0
    if (ap !== bp) return ap - bp
    return (a.distanceMeters || 0) - (b.distanceMeters || 0)
  })

  // Una por línea (linea_label / route_id); si no hay, por mean_id
  const byLine = new Map<string, RealBusWithDistance>()
  for (const bus of ranked) {
    const key =
      String(
        bus.linea_label || bus.linea || bus.route_id || `bus:${bus.mean_id}`
      ).trim() || `bus:${bus.mean_id}`
    if (!byLine.has(key)) byLine.set(key, bus)
    if (byLine.size >= maxLines) break
  }
  return Array.from(byLine.values())
}

export function RealBusList({
  buses,
  selectedBusId,
  onSelectBus,
  onlyClosestLines = true,
  maxLines = 3,
  avgSpeedKmh = null,
  userHasLocation = false,
}: RealBusListProps) {
  if (!buses || buses.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-center text-xs text-muted-foreground">
        No hay buses emitiendo GPS en este momento para la empresa seleccionada.
      </div>
    )
  }

  const displayBuses = onlyClosestLines
    ? prepareClosestLineBuses(buses, maxLines)
    : Array.from(new Map(buses.map((b) => [b.mean_id, b])).values()).sort(
        (a, b) => {
          const ap = a.passedBoardingStop ? 1 : 0
          const bp = b.passedBoardingStop ? 1 : 0
          if (ap !== bp) return ap - bp
          return (a.distanceMeters || 0) - (b.distanceMeters || 0)
        }
      )

  const closest =
    displayBuses.find((b) => !b.passedBoardingStop) || displayBuses[0]
  const saneSpeeds = displayBuses
    .map((b) => {
      const n = Number(b.velocidad)
      if (!Number.isFinite(n) || n <= 0 || n > 120) return 0
      return Math.round(n)
    })
    .filter((v) => v > 0)
  const computedAvg =
    avgSpeedKmh != null
      ? avgSpeedKmh
      : saneSpeeds.length > 0
        ? Math.round(saneSpeeds.reduce((acc, v) => acc + v, 0) / saneSpeeds.length)
        : null

  return (
    <div className="flex flex-col gap-2">
      {(closest || computedAvg != null) && (
        <div className="rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-[11px] text-foreground">
          {closest && typeof closest.distanceMeters === "number" && (
            <p className="font-semibold">
              Línea más cercana:{" "}
              <span className="text-primary">
                {closest.route_id ? `L-${closest.route_id}` : `Bus #${closest.mean_id}`}
              </span>
              {" · "}
              {Math.round(closest.distanceMeters)} m
            </p>
          )}
          {computedAvg != null && (
            <p className="mt-0.5 flex items-center gap-1 text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              Velocidad promedio: <strong className="text-foreground">{computedAvg} km/h</strong>
            </p>
          )}
          {!userHasLocation && (
            <p className="mt-1 text-[10px] text-amber-700">
              Compartí tu ubicación para ordenar por cercanía.
            </p>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-2" aria-label="Buses más cercanos en tiempo real">
        {displayBuses.map((bus) => {
          const statusKey = getRealBusStatusKey(bus.velocidad)
          const label = STATUS_LABEL[statusKey]
          const colorVar = STATUS_COLOR_VAR[statusKey]
          const isSelected = bus.mean_id === selectedBusId
          const dist = bus.distanceMeters
          const passed = Boolean(bus.passedBoardingStop)
          const approaching =
            !passed && typeof dist === "number" && dist <= 1000
          const usefulIdx = displayBuses
            .filter((b) => !b.passedBoardingStop)
            .findIndex((b) => b.mean_id === bus.mean_id)

          return (
            <li key={bus.id || bus.mean_id}>
              <button
                type="button"
                onClick={() => onSelectBus(bus.mean_id)}
                aria-pressed={isSelected}
                className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : passed
                      ? "border-border/70 bg-muted/40 opacity-80"
                      : approaching
                        ? "border-orange-500/50 bg-orange-500/10"
                        : "border-border bg-card hover:bg-muted"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: passed ? "var(--muted-foreground)" : colorVar,
                    }}
                  >
                    <BusIcon className="h-5 w-5 text-card" aria-hidden="true" />
                    {usefulIdx === 0 && (
                      <span className="absolute -right-1 -top-1 rounded bg-primary px-1 text-[8px] font-bold text-primary-foreground">
                        1º
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-card-foreground">
                        {bus.linea_label || bus.linea || (bus.route_id ? `Línea ${bus.route_id}` : `Bus #${bus.mean_id}`)}
                        <span className="ml-1 font-normal text-muted-foreground">
                          · #{bus.mean_id}
                        </span>
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          passed ? "bg-slate-500 text-white" : "text-card"
                        }`}
                        style={passed ? undefined : { backgroundColor: colorVar }}
                      >
                        {passed
                          ? "Ya pasó tu parada"
                          : approaching && dist != null && dist > 400
                            ? "Acercándose"
                            : approaching && dist != null && dist <= 400
                              ? "Llegando"
                              : label}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {(bus as any).eot_nombre || `Agencia: ${bus.agency_id || "N/D"}`}
                      {bus.driver_id ? ` · Chofer: ${bus.driver_id}` : ""}
                      {" · "}
                      {passed ? (
                        <span className="font-semibold text-slate-600">
                          no te sirve para abordar
                        </span>
                      ) : (
                        <span className="font-semibold text-emerald-700">en movimiento</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
                    {(() => {
                      const n = Number(bus.velocidad) || 0
                      const shown = n > 0 && n <= 120 ? Math.round(n) : 0
                      return `${shown} km/h`
                    })()}
                  </span>
                  {typeof dist === "number" && (
                    <span
                      className={`flex items-center gap-1 font-semibold ${
                        dist <= 1000 ? "text-orange-600" : "text-foreground"
                      }`}
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      {Math.round(dist)} m
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {bus.fecha_hora ? new Date(bus.fecha_hora).toLocaleTimeString() : "Ahora"}
                  </span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
