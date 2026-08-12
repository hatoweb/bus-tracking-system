"use client"

import { useEffect, useState } from "react"
import { Building2, Route, CheckCircle2 } from "lucide-react"
import { apiUrl } from "@/lib/base-path"

export type Empresa = {
  eot_id: number
  eot_nombre: string
  eot_linea: string
  cod_catalogo: number
  id_eot_vmt_hex: string
}

type RealItineraryFull = {
  id_itinerario: number
  ruta_hex: string
  fecha_inicio_vigencia: string
  vigente: boolean
  observacion: string | null
  eot_id: number
  eot_nombre: string
  eot_linea: string
  ruta_linea: string
  sentido: string
  origen: string
  destino: string
  geojson: any
}

type ItineraryPanelProps = {
  onAnnounce?: (msg: string) => void
  empresas: Empresa[]
  selectedCodCatalogo: string
  setSelectedCodCatalogo: (val: string) => void
}

export function ItineraryPanel({ onAnnounce, empresas, selectedCodCatalogo, setSelectedCodCatalogo }: ItineraryPanelProps) {
  const [itinerarios, setItinerarios] = useState<RealItineraryFull[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  // Cargar itinerarios de la empresa seleccionada
  useEffect(() => {
    async function fetchItinerarios() {
      if (!selectedCodCatalogo) {
        setItinerarios([])
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const url = apiUrl(`/api/itinerarios?cod_catalogo=${selectedCodCatalogo}`)
        const res = await fetch(url)
        const data = await res.json()
        if (data.success && data.data) {
          setItinerarios(data.data)
        }
      } catch (err) {
        console.error("Error cargando itinerarios:", err)
      } finally {
        setLoading(false)
      }
    }
    fetchItinerarios()
  }, [selectedCodCatalogo])

  return (
    <div className="flex flex-col gap-4">
      {/* Selector de Empresa */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-card-foreground">
          <Building2 className="h-4 w-4 text-primary" />
          Filtrar por Empresa Operadora (public.eots)
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

      {/* Lista de Itinerarios Reales */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Itinerarios de la BD ({itinerarios.length})
          </h3>
          <span className="flex items-center gap-1 text-[11px] font-semibold text-status-moving">
            <CheckCircle2 className="h-3 w-3" />
            Vigentes
          </span>
        </div>

        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Cargando itinerarios de la base de datos...
          </p>
        ) : itinerarios.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No se encontraron itinerarios vigentes para esta empresa.
          </p>
        ) : (
          itinerarios.map((itin) => (
            <div
              key={itin.id_itinerario}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm transition-all hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="inline-block rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    Hex: {itin.ruta_hex}
                  </span>
                  <p className="mt-1 text-xs font-bold text-card-foreground">
                    {itin.eot_nombre}
                  </p>
                  <p className="text-[11px] font-medium text-muted-foreground">
                    Ruta: {itin.ruta_linea || itin.eot_linea} · Sentido: {itin.sentido || 'N/D'}
                  </p>
                </div>
                <div className="text-right">
                  <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                    ID #{itin.id_itinerario}
                  </span>
                </div>
              </div>

              {(itin.origen || itin.destino) && (
                <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-foreground">
                  <Route className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">
                    {itin.origen || 'Origen'} ➔ {itin.destino || 'Destino'}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
