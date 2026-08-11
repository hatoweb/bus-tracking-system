"use client"

import { Bus as BusIcon, MapPin } from "lucide-react"
import {
  type Bus,
  ROUTE_PATH,
  STATUS_COLOR_VAR,
  STATUS_LABEL,
  STOPS,
  positionOnRoute,
} from "@/lib/transit-data"

type RouteMapProps = {
  buses: Bus[]
  selectedBusId: string | null
  onSelectBus: (id: string) => void
}

export function RouteMap({ buses, selectedBusId, onSelectBus }: RouteMapProps) {
  const routePoints = ROUTE_PATH.map((p) => `${p.x},${p.y}`).join(" ")

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-card">
      {/* Fondo tipo mapa con retícula */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Mapa de la línea L1 con la ruta y las paradas"
      >
        <defs>
          <pattern id="grid" width="8" height="8" patternUnits="userSpaceOnUse">
            <path
              d="M 8 0 L 0 0 0 8"
              fill="none"
              stroke="var(--border)"
              strokeWidth="0.2"
              opacity="0.6"
            />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#grid)" />

        {/* Manzanas decorativas del mapa */}
        {[
          { x: 12, y: 20, w: 14, h: 10 },
          { x: 60, y: 60, w: 18, h: 14 },
          { x: 30, y: 78, w: 16, h: 10 },
          { x: 72, y: 44, w: 12, h: 12 },
        ].map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            fill="var(--muted)"
            opacity="0.5"
            rx="1"
          />
        ))}

        {/* Trazado de la ruta */}
        <polyline
          points={routePoints}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
        <polyline
          points={routePoints}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="0.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1.5 1.5"
          opacity="0.4"
        />
      </svg>

      {/* Paradas */}
      {STOPS.map((stop) => (
        <div
          key={stop.id}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${stop.x}%`, top: `${stop.y}%` }}
        >
          <div className="flex flex-col items-center">
            <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-primary bg-card shadow-sm">
              <MapPin className="h-3 w-3 text-primary" aria-hidden="true" />
            </div>
            <span className="mt-1 max-w-24 whitespace-nowrap rounded bg-card/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-card-foreground shadow-sm">
              {stop.name}
            </span>
          </div>
        </div>
      ))}

      {/* Buses en tiempo real */}
      {buses.map((bus) => {
        const pos = positionOnRoute(bus.progress)
        const isSelected = bus.id === selectedBusId
        const color = STATUS_COLOR_VAR[bus.status]
        return (
          <button
            key={bus.id}
            type="button"
            onClick={() => onSelectBus(bus.id)}
            aria-label={`Bus ${bus.plate}, línea ${bus.line}, ${STATUS_LABEL[bus.status]}`}
            aria-pressed={isSelected}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-1000 ease-linear focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            <span
              className="absolute inset-0 -z-10 animate-ping rounded-full opacity-60"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <span
              className="flex items-center justify-center rounded-full border-2 border-card shadow-md"
              style={{
                backgroundColor: color,
                width: isSelected ? 30 : 24,
                height: isSelected ? 30 : 24,
              }}
            >
              <BusIcon
                className="text-card"
                style={{ width: isSelected ? 16 : 13, height: isSelected ? 16 : 13 }}
                aria-hidden="true"
              />
            </span>
            <span
              className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1 text-[9px] font-bold"
              style={{ color }}
            >
              {bus.plate}
            </span>
          </button>
        )
      })}
    </div>
  )
}
