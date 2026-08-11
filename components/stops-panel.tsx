"use client"

import { useEffect, useState } from "react"
import { Building2, MapPin, Volume2 } from "lucide-react"
import { type Bus, STOPS, nearestStopInfo } from "@/lib/transit-data"
import { type RealStop } from "@/components/real-route-map"

import { type Empresa } from "@/components/itinerary-panel"

type StopsPanelProps = {
  buses: Bus[]
  onAnnounceStop: (text: string) => void
  voiceEnabled: boolean
  onAnnounce?: (text: string) => void
  empresas: Empresa[]
  selectedCodCatalogo: string
  setSelectedCodCatalogo: (val: string) => void
}

export function StopsPanel({ buses, onAnnounceStop, voiceEnabled, onAnnounce, empresas, selectedCodCatalogo, setSelectedCodCatalogo }: StopsPanelProps) {
  const [realStops, setRealStops] = useState<RealStop[]>([])
  const [loading, setLoading] = useState<boolean>(false)

  // Cargar paradas oficiales reales cuando cambia la empresa seleccionada
  useEffect(() => {
    async function fetchParadas() {
      if (!selectedCodCatalogo) {
        setRealStops([])
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const res = await fetch(`/api/paradas?cod_catalogo=${selectedCodCatalogo}`)
        const data = await res.json()
        if (data.success && data.data) {
          setRealStops(data.data)
        }
      } catch (err) {
        console.error("Error cargando paradas oficiales:", err)
      } finally {
        setLoading(false)
      }
    }
    fetchParadas()
  }, [selectedCodCatalogo])

  // Calcula ETA simulado
  function etaForStop(order: number): string {
    const target = order === 1 ? 0 : (order - 1) / (STOPS.length - 1)
    let bestMin = Number.POSITIVE_INFINITY
    for (const bus of buses) {
      const delta = target - bus.progress
      if (delta >= -0.02) {
        const minutes = Math.max(0, Math.round(Math.abs(delta) * 45))
        if (minutes < bestMin) bestMin = minutes
      }
    }
    if (bestMin === Number.POSITIVE_INFINITY) return "—"
    return bestMin === 0 ? "Llegando" : `${bestMin} min`
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Selector de Empresa para Paradas Oficiales */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-card-foreground">
          <Building2 className="h-4 w-4 text-primary" />
          Filtrar Paradas Oficiales por Empresa Operadora
        </label>
        <select
          value={selectedCodCatalogo}
          onChange={(e) => {
            const val = e.target.value
            setSelectedCodCatalogo(val)
            const emp = empresas.find((item) => String(item.cod_catalogo) === val)
            if (emp) {
              onAnnounce?.(`Empresa ${emp.eot_nombre} seleccionada, Línea: ${emp.eot_linea}`)
            } else {
              onAnnounce?.("Por favor, selecciona una empresa")
            }
          }}
          className="w-full rounded-lg border border-input bg-background p-2 text-xs font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">-- Seleccionar empresa --</option>
          {empresas.map((emp) => (
            <option key={emp.eot_id} value={emp.cod_catalogo}>
              {emp.eot_nombre} (Líneas: {emp.eot_linea})
            </option>
          ))}
        </select>
      </div>

      {/* Lista de Paradas */}
      <div className="flex flex-col gap-2">
        {!selectedCodCatalogo ? (
          <div className="rounded-lg border border-border bg-card p-4 text-center text-xs text-muted-foreground">
            Por favor, selecciona una empresa operadora para cargar sus paradas oficiales desde la base de datos.
          </div>
        ) : loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Cargando paradas oficiales de la base de datos...
          </p>
        ) : realStops.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No se encontraron paradas oficiales registradas para esta empresa.
          </p>
        ) : (
          realStops.map((stop) => (
            <div
              key={`${stop.id}-${stop.orden}`}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm transition-all hover:border-primary/50"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary">
                #{stop.orden}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-card-foreground">
                  {stop.nombre}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {stop.eot_nombre} · Ruta/Línea: {stop.ruta_linea || stop.ruta_hex} · ID Parada: #{stop.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  onAnnounceStop(
                    `Parada número ${stop.orden}, ${stop.nombre}, empresa ${stop.eot_nombre}.`
                  )
                }
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-primary transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Escuchar información de la parada ${stop.nombre}`}
                title="Escuchar información de la parada"
              >
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
