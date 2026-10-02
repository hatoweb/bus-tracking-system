"use client"

import { useState } from "react"
import { X, ExternalLink, MapPin, RefreshCw, Car } from "lucide-react"

interface WazeLiveModalProps {
  isOpen: boolean
  onClose: () => void
  userLocation?: { lat: number; lng: number } | null
  defaultMunicipio?: string
}

const MUNICIPIOS_CENTROS: Record<string, { lat: number; lng: number; label: string }> = {
  "Asunción": { lat: -25.2867, lng: -57.635, label: "Asunción" },
  "San Lorenzo": { lat: -25.342, lng: -57.505, label: "San Lorenzo" },
  "Fernando de la Mora": { lat: -25.333, lng: -57.535, label: "Fdo. de la Mora" },
  "Luque": { lat: -25.265, lng: -57.515, label: "Luque" },
  "Lambaré": { lat: -25.34, lng: -57.615, label: "Lambaré" },
}

export function WazeLiveModal({
  isOpen,
  onClose,
  userLocation,
  defaultMunicipio = "Asunción",
}: WazeLiveModalProps) {
  const [selectedCity, setSelectedCity] = useState<string>(defaultMunicipio)
  const [customCoords, setCustomCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [iframeKey, setIframeKey] = useState<number>(1)

  if (!isOpen) return null

  const activeCenter = customCoords || MUNICIPIOS_CENTROS[selectedCity] || MUNICIPIOS_CENTROS["Asunción"]
  const iframeSrc = `https://embed.waze.com/iframe?zoom=13&lat=${activeCenter.lat}&lon=${activeCenter.lng}&ct=livemap`
  const externalWazeUrl = `https://www.waze.com/live-map/directions?lat=${activeCenter.lat}&lng=${activeCenter.lng}`

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-xs animate-in fade-in">
      <div className="relative flex h-[90vh] max-h-[700px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500">
              <Car className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-card-foreground">
                  Waze Live Map
                </h3>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                  En Vivo
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Monitoreo vial oficial de Asunción y Gran Asunción (Waze for Cities CCP)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cerrar visor Waze"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Selector rápido de zonas y municipios */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/20 px-3 py-2 text-xs">
          <span className="text-[11px] font-semibold text-muted-foreground">Zona:</span>
          {Object.entries(MUNICIPIOS_CENTROS).map(([name, data]) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setSelectedCity(name)
                setCustomCoords(null)
                setIframeKey((k: number) => k + 1)
              }}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                !customCoords && selectedCity === name
                  ? "bg-sky-600 text-white shadow-xs"
                  : "bg-background text-foreground hover:bg-muted border border-border"
              }`}
            >
              {data.label}
            </button>
          ))}

          {userLocation?.lat != null && userLocation?.lng != null && (
            <button
              type="button"
              onClick={() => {
                setCustomCoords({ lat: userLocation.lat, lng: userLocation.lng })
                setIframeKey((k: number) => k + 1)
              }}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                customCoords
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-background text-foreground hover:bg-muted border border-border"
              }`}
            >
              <MapPin className="h-3 w-3" />
              <span>Mi Ubicación</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIframeKey((k: number) => k + 1)}
            className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Recargar visor Waze"
          >
            <RefreshCw className="h-3 w-3" />
            <span className="hidden sm:inline">Recargar</span>
          </button>
        </div>

        {/* Contenedor del Iframe Waze */}
        <div className="relative flex-1 bg-slate-950">
          <iframe
            key={iframeKey}
            src={iframeSrc}
            width="100%"
            height="100%"
            title="Visor Waze Live Map"
            className="h-full w-full border-0"
            allow="geolocation"
          />
        </div>

        {/* Pie con enlace directo a Waze */}
        <div className="flex items-center justify-between border-t border-border bg-muted/40 px-4 py-2.5 text-xs">
          <span className="text-[11px] text-muted-foreground">
            Feed oficial provisto por el programa Waze for Cities (CCP)
          </span>
          <a
            href={externalWazeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400 text-xs"
          >
            <span>Abrir en Waze Web</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  )
}
