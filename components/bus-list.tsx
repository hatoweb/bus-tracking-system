"use client"

import { Bus as BusIcon, Gauge, Users } from "lucide-react"
import {
  type Bus,
  STATUS_COLOR_VAR,
  STATUS_LABEL,
  nearestStopInfo,
} from "@/lib/transit-data"

type BusListProps = {
  buses: Bus[]
  selectedBusId: string | null
  onSelectBus: (id: string) => void
}

export function BusList({ buses, selectedBusId, onSelectBus }: BusListProps) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Buses en tiempo real">
      {buses.map((bus) => {
        const color = STATUS_COLOR_VAR[bus.status]
        const isSelected = bus.id === selectedBusId
        const { stop } = nearestStopInfo(bus.progress)
        return (
          <li key={bus.id}>
            <button
              type="button"
              onClick={() => onSelectBus(bus.id)}
              aria-pressed={isSelected}
              className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isSelected ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: color }}
                >
                  <BusIcon className="h-5 w-5 text-card" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-card-foreground">
                      {bus.plate}
                    </p>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-card"
                      style={{ backgroundColor: color }}
                    >
                      {STATUS_LABEL[bus.status]}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    Línea {bus.line} · Próxima: {stop.name}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
                  {bus.speedKmh} km/h
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {bus.passengers}/{bus.capacity}
                </span>
                <span className="ml-auto">{Math.round(bus.progress * 100)}% ruta</span>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
