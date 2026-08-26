"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowUpDown,
  Building2,
  ChevronDown,
  Crosshair,
  Loader2,
  MapPinned,
  Navigation,
  Search,
  X,
} from "lucide-react"
import { type Empresa } from "@/components/itinerary-panel"
import { apiUrl } from "@/lib/base-path"

export type TripPlace = {
  id: string
  label: string
  lat: number
  lng: number
  tipo?: string
  fuente?: string
}

export type TripPlanPayload = {
  origin: TripPlace
  destination: TripPlace
  codCatalogo: string
  empresaNombre?: string
  /** Preferir / priorizar unidades con rampa */
  necesitaAccesibilidad?: boolean
}

type SearchHit = {
  id: string
  label: string
  lat: number | null
  lng: number | null
  tipo: string
  fuente?: string
  meta?: Record<string, unknown>
}

type TripPlannerProps = {
  empresas: Empresa[]
  selectedCodCatalogo: string
  setSelectedCodCatalogo: (val: string) => void
  userLocation?: { lat: number; lng: number } | null
  onUseGpsOrigin: () => void
  onPlan: (plan: TripPlanPayload) => void | Promise<void>
  planning?: boolean
  expanded: boolean
  onToggle: () => void
  destinationSummary?: string | null
  mapPickMode?: "origin" | "destination" | null
  onRequestMapPick?: (mode: "origin" | "destination") => void
  onCancelMapPick?: () => void
  mapPickedPoint?: {
    mode: "origin" | "destination"
    place: TripPlace
  } | null
  onMapPickedPointConsumed?: () => void
  onDraftPlacesChange?: (
    origin: TripPlace | null,
    destination: TripPlace | null
  ) => void
  onClearTrip?: () => void
}

function PlaceSearchField({
  variant,
  valueLabel,
  placeholder,
  active,
  mapPickActive,
  onClear,
  onSelect,
  onMapPick,
  autoFocus,
  focusTrigger,
}: {
  variant: "origin" | "destination"
  valueLabel?: string
  placeholder: string
  active?: boolean
  mapPickActive?: boolean
  onClear: () => void
  onSelect: (hit: SearchHit) => void
  onMapPick: () => void
  autoFocus?: boolean
  focusTrigger?: number
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setFocused(false)
      }
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  // Si se activa focusTrigger para editar y ya tenía valor fijo, pasarlo a query editable
  useEffect(() => {
    if (focusTrigger && focusTrigger > 0 && variant === "destination" && valueLabel) {
      setQuery(valueLabel)
      onClear()
    }
  }, [focusTrigger, variant, valueLabel, onClear])

  useEffect(() => {
    if ((focusTrigger && focusTrigger > 0) || (autoFocus && !valueLabel)) {
      if (!valueLabel) {
        const t1 = setTimeout(() => {
          inputRef.current?.focus()
        }, 80)
        const t2 = setTimeout(() => {
          inputRef.current?.focus()
        }, 220)
        return () => {
          clearTimeout(t1)
          clearTimeout(t2)
        }
      }
    }
  }, [focusTrigger, autoFocus, valueLabel])

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [localRes, geoRes] = await Promise.all([
        fetch(apiUrl(`/api/lugares/buscar?q=${encodeURIComponent(q)}&limit=8`), {
          cache: "no-store",
        }),
        fetch(apiUrl(`/api/geocode?q=${encodeURIComponent(q)}&limit=5`), {
          cache: "no-store",
        }).catch(() => null),
      ])
      const localData = await localRes.json().catch(() => ({ results: [] }))
      const geoData =
        geoRes && geoRes.ok
          ? await geoRes.json().catch(() => ({ results: [] }))
          : { results: [] }

      const localHits: SearchHit[] = Array.isArray(localData.results)
        ? localData.results
        : []
      const geoHits: SearchHit[] = Array.isArray(geoData.results)
        ? geoData.results
        : []

      const merged = [...localHits, ...geoHits].filter(
        (h, idx, arr) => arr.findIndex((x) => x.id === h.id) === idx
      )
      setHits(merged)
      setOpen(true)
      if (localHits.length === 0 && geoHits.length === 0 && geoData?.warning) {
        setError(null)
      }
    } catch (err: any) {
      setError(err?.message || "No se pudo buscar")
      setHits([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runSearch(query)
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch])

  async function resolveAndSelect(hit: SearchHit) {
    if (
      hit.lat != null &&
      hit.lng != null &&
      Number.isFinite(hit.lat) &&
      Number.isFinite(hit.lng)
    ) {
      onSelect(hit)
      setQuery("")
      setOpen(false)
      setHits([])
      return
    }

    setLoading(true)
    try {
      const res = await fetch(
        apiUrl(`/api/geocode?q=${encodeURIComponent(hit.label)}&limit=1`),
        { cache: "no-store" }
      )
      const data = res.ok
        ? await res.json().catch(() => ({ results: [] }))
        : { results: [] }
      const first = data.results?.[0]
      if (!first?.lat || !first?.lng) {
        setError(
          "No se encontró en Asunción / Área Metropolitana. Probá otra búsqueda o marcá en el mapa."
        )
        return
      }
      onSelect({
        ...hit,
        lat: first.lat,
        lng: first.lng,
        label: hit.label,
      })
      setQuery("")
      setOpen(false)
      setHits([])
    } catch {
      setError("No se pudo geocodificar el lugar seleccionado.")
    } finally {
      setLoading(false)
    }
  }

  const tipoLabel = (tipo: string) => {
    switch (tipo) {
      case "parada":
        return "Parada"
      case "origen_ruta":
        return "Origen ruta"
      case "destino_ruta":
        return "Destino ruta"
      case "linea":
        return "Línea"
      case "empresa":
        return "Empresa"
      case "geocode":
        return "Dirección"
      default:
        return tipo
    }
  }

  const isActive = Boolean(active || focused || mapPickActive)
  const ringClass = isActive
    ? variant === "destination"
      ? "ring-2 ring-emerald-600 border-emerald-600"
      : "ring-2 ring-sky-500 border-sky-500"
    : "border-transparent"

  return (
    <div ref={wrapRef} className="relative">
      {valueLabel ? (
        <div
          onClick={() => {
            setQuery(valueLabel)
            onClear()
            setTimeout(() => {
              inputRef.current?.focus()
              inputRef.current?.select()
            }, 50)
          }}
          title="Tocá para editar"
          className={`flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2 ${ringClass} border cursor-pointer hover:bg-muted/80`}
        >
          {variant === "origin" ? (
            <MapPinned className="h-4 w-4 shrink-0 text-sky-500" />
          ) : (
            <MapPinned className="h-4 w-4 shrink-0 text-emerald-700" />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight text-foreground">
            {valueLabel}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
              setQuery("")
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Borrar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          className={`flex items-center gap-1.5 rounded-lg bg-background px-2 py-1.5 ${ringClass} border`}
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setFocused(true)
              if (hits.length > 0) setOpen(true)
            }}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            autoComplete="off"
          />
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <button
              type="button"
              onClick={onMapPick}
              title="Marcar en el mapa"
              aria-label="Marcar en el mapa"
              className={`rounded-md p-1 transition-colors ${
                mapPickActive
                  ? "bg-emerald-600/15 text-emerald-800"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <MapPinned className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-1 px-1 text-[10px] text-destructive">{error}</p>
      )}

      {open && hits.length > 0 && !valueLabel && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => void resolveAndSelect(hit)}
                className="flex w-full flex-col gap-0.5 border-b border-border/50 px-3 py-2 text-left last:border-0 hover:bg-muted/70"
              >
                <span className="text-[12px] font-medium leading-snug text-foreground">
                  {hit.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {tipoLabel(hit.tipo)}
                  {hit.lat == null ? " · se ubicará por nombre" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function TripPlanner({
  empresas,
  selectedCodCatalogo,
  setSelectedCodCatalogo,
  userLocation,
  onUseGpsOrigin,
  onPlan,
  planning = false,
  expanded,
  onToggle,
  destinationSummary = null,
  mapPickMode = null,
  onRequestMapPick,
  onCancelMapPick,
  mapPickedPoint = null,
  onMapPickedPointConsumed,
  onDraftPlacesChange,
  onClearTrip,
}: TripPlannerProps) {
  const [origin, setOrigin] = useState<TripPlace | null>(null)
  const [destination, setDestination] = useState<TripPlace | null>(null)
  const [necesitaAccesibilidad, setNecesitaAccesibilidad] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [focusField, setFocusField] = useState<"origin" | "destination">(
    "destination"
  )
  const [destFocusTrigger, setDestFocusTrigger] = useState(0)
  const [secureContext, setSecureContext] = useState(true)
  const httpsGpsUrl =
    typeof window !== "undefined"
      ? window.location.protocol === "https:"
        ? window.location.href
        : `https://${window.location.hostname}:3443/prototipo_vmt/`
      : "https://sistemas.mopc.gov.py/prototipo_vmt/"

  useEffect(() => {
    setSecureContext(window.isSecureContext)
  }, [])

  const lastDraftKeyRef = useRef<string>("")

  // Al descolapsar: origen por defecto ubicación actual y cursor en destino listo para editar
  useEffect(() => {
    if (!expanded) return

    // 1. Origen por defecto: ubicación actual (GPS)
    if (!origin || origin.id === "gps:live") {
      if (userLocation) {
        setOrigin({
          id: "gps:live",
          label: "Mi ubicación actual",
          lat: userLocation.lat,
          lng: userLocation.lng,
          tipo: "gps",
          fuente: "geolocation",
        })
      } else {
        onUseGpsOrigin()
      }
    }

    // 2. Foco inmediato en destino para editar
    setFocusField("destination")
    setDestFocusTrigger(Date.now())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  useEffect(() => {
    const key = `${origin?.id ?? ""}:${origin?.lat ?? ""}:${origin?.lng ?? ""}|${destination?.id ?? ""}:${destination?.lat ?? ""}:${destination?.lng ?? ""}`
    if (key === lastDraftKeyRef.current) return
    lastDraftKeyRef.current = key
    onDraftPlacesChange?.(origin, destination)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination])

  useEffect(() => {
    if (!mapPickedPoint) return
    if (mapPickedPoint.mode === "origin") {
      setOrigin(mapPickedPoint.place)
    } else {
      setDestination(mapPickedPoint.place)
    }
    setFormError(null)
    onMapPickedPointConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapPickedPoint])

  useEffect(() => {
    if (userLocation && !origin) {
      setOrigin({
        id: "gps:live",
        label: "Mi ubicación actual",
        lat: userLocation.lat,
        lng: userLocation.lng,
        tipo: "gps",
        fuente: "geolocation",
      })
    }
  }, [userLocation?.lat, userLocation?.lng, origin])

  useEffect(() => {
    if (!userLocation || !origin || origin.id !== "gps:live") return
    const { lat, lng } = userLocation
    setOrigin((prev) => {
      if (!prev) return prev
      if (prev.lat === lat && prev.lng === lng) return prev
      return { ...prev, lat, lng }
    })
  }, [userLocation?.lat, userLocation?.lng, origin?.id])

  function selectOrigin(hit: SearchHit) {
    if (hit.lat == null || hit.lng == null) return
    setOrigin({
      id: hit.id,
      label: hit.label,
      lat: hit.lat,
      lng: hit.lng,
      tipo: hit.tipo,
      fuente: hit.fuente,
    })
    setFocusField("destination")
    setFormError(null)
  }

  function selectDestination(hit: SearchHit) {
    if (hit.lat == null || hit.lng == null) return
    setDestination({
      id: hit.id,
      label: hit.label,
      lat: hit.lat,
      lng: hit.lng,
      tipo: hit.tipo,
      fuente: hit.fuente,
    })
    if (hit.tipo === "empresa" && hit.meta?.cod_catalogo != null) {
      setSelectedCodCatalogo(String(hit.meta.cod_catalogo))
    }
    setFormError(null)
  }

  function swapPlaces() {
    setOrigin(destination)
    setDestination(origin)
    setFormError(null)
  }

  function requestMapPick(mode: "origin" | "destination") {
    setFocusField(mode)
    if (!expanded) onToggle()
    onRequestMapPick?.(mode)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!origin) {
      setFormError("Indicá el origen (GPS, búsqueda o mapa).")
      setFocusField("origin")
      return
    }
    if (!destination) {
      setFormError("Indicá el destino (búsqueda o mapa).")
      setFocusField("destination")
      return
    }

    const emp = empresas.find(
      (item) => String(item.cod_catalogo) === selectedCodCatalogo
    )

    await onPlan({
      origin,
      destination,
      codCatalogo: selectedCodCatalogo,
      empresaNombre: emp?.eot_nombre,
      necesitaAccesibilidad,
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Navigation className="h-4 w-4 shrink-0 text-primary" />
            Ruta
          </span>
          {!expanded && (
            <span className="mt-0.5 block truncate pl-6 text-[11px] text-muted-foreground">
              {destinationSummary
                ? destinationSummary
                : origin
                  ? "Elegí el destino"
                  : "Origen y destino"}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {(destinationSummary || destination) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setDestination(null)
                setFormError(null)
                onClearTrip?.()
              }}
              title="Limpiar viaje planificado"
              aria-label="Limpiar viaje"
              className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              <span>Limpiar</span>
            </button>
          )}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-2 border-t border-border px-2.5 pb-2.5 pt-2"
          >
            {!secureContext && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-950">
                <p className="font-semibold">
                  El GPS no funciona en HTTP. Abrí la versión segura:
                </p>
                <a
                  href={httpsGpsUrl}
                  className="mt-1 inline-block font-bold text-sky-800 underline"
                >
                  {httpsGpsUrl}
                </a>
                <p className="mt-1 text-muted-foreground">
                  Aceptá el aviso del certificado y permití la ubicación. O
                  marcá el origen en el mapa.
                </p>
              </div>
            )}

            {mapPickMode && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-900">
                <span className="font-semibold">
                  {mapPickMode === "origin"
                    ? "Tocá el mapa · origen"
                    : "Tocá el mapa · destino"}
                </span>
                <button
                  type="button"
                  onClick={() => onCancelMapPick?.()}
                  className="shrink-0 rounded px-1.5 py-0.5 font-bold hover:bg-sky-500/20"
                >
                  Cancelar
                </button>
              </div>
            )}

            {/* Bloque compacto origen / destino (estilo mapas) */}
            <div className="flex items-stretch gap-1.5">
              <div className="min-w-0 flex-1 rounded-xl bg-muted/50 p-1">
                <PlaceSearchField
                  variant="origin"
                  valueLabel={origin?.label}
                  placeholder="Ubicación de origen"
                  active={focusField === "origin"}
                  mapPickActive={mapPickMode === "origin"}
                  autoFocus={focusField === "origin" && !origin}
                  onClear={() => {
                    setOrigin(null)
                    setFocusField("origin")
                  }}
                  onSelect={selectOrigin}
                  onMapPick={() => requestMapPick("origin")}
                />
                <div className="mx-2 border-t border-border/60" />
                <PlaceSearchField
                  variant="destination"
                  valueLabel={destination?.label}
                  placeholder="Ubicación de destino"
                  active={focusField === "destination" || !destination}
                  mapPickActive={mapPickMode === "destination"}
                  autoFocus={focusField === "destination" && !destination}
                  focusTrigger={destFocusTrigger}
                  onClear={() => {
                    setDestination(null)
                    setFocusField("destination")
                  }}
                  onSelect={selectDestination}
                  onMapPick={() => requestMapPick("destination")}
                />
              </div>

              <div className="flex flex-col justify-between py-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (!secureContext) {
                      setFormError(
                        "El GPS requiere HTTPS. Abrí https://" +
                          (typeof window !== "undefined"
                            ? window.location.hostname
                            : "172.16.222.222") +
                          ":3443 o marcá el origen en el mapa."
                      )
                      return
                    }
                    onUseGpsOrigin()
                    if (userLocation) {
                      setOrigin({
                        id: "gps:live",
                        label: "Mi ubicación actual",
                        lat: userLocation.lat,
                        lng: userLocation.lng,
                        tipo: "gps",
                        fuente: "geolocation",
                      })
                    }
                  }}
                  title="Usar mi GPS"
                  aria-label="Usar mi GPS"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Crosshair className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={swapPlaces}
                  title="Intercambiar origen y destino"
                  aria-label="Intercambiar"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArrowUpDown className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <select
                value={selectedCodCatalogo}
                onChange={(e) => setSelectedCodCatalogo(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border-0 bg-muted/50 px-2 py-1.5 text-[11px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="Empresa (opcional)"
              >
                <option value="">Empresa (opcional)</option>
                {empresas.map((emp) => (
                  <option key={emp.eot_id} value={emp.cod_catalogo}>
                    {emp.eot_nombre} (L{emp.eot_linea})
                  </option>
                ))}
              </select>
            </div>

            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 text-[11px] text-foreground">
              <input
                type="checkbox"
                checked={necesitaAccesibilidad}
                onChange={(e) => setNecesitaAccesibilidad(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-primary"
              />
              <span>
                <span className="font-semibold">♿ Necesito accesibilidad</span>
                <span className="mt-0.5 block text-muted-foreground">
                  Priorizar buses con rampa (movilidad reducida).
                </span>
              </span>
            </label>

            {formError && (
              <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={planning}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {planning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Buscar viaje
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
