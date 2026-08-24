"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Bus as BusIcon,
  CalendarClock,
  MapPin,
  MessageSquare,
  Radio,
  Route,
  Satellite,
  Volume2,
  VolumeX,
  Bell,
  UserCheck,
  User as UserIcon,
  AlertCircle,
  CheckCircle2,
} from "lucide-react"
import {
  type Bus,
  type BusStatus,
  INITIAL_BUSES,
  STATUS_LABEL,
  nearestStopInfo,
} from "@/lib/transit-data"
import { useVoiceAnnouncer } from "@/hooks/use-voice-announcer"
import { RouteMap } from "@/components/route-map"
import { BusList } from "@/components/bus-list"
import { RealBusList, getRealBusStatusKey, prepareClosestLineBuses, type RealBusWithDistance } from "@/components/real-bus-list"
import { evaluateBusVsBoardingStops, stopServesDestination } from "@/lib/bus-passed-stop"
import { StatusLegend } from "@/components/status-legend"
import { SchedulePanel } from "@/components/schedule-panel"
import { ItineraryPanel } from "@/components/itinerary-panel"
import { StopsPanel } from "@/components/stops-panel"
import { FeedbackPanel } from "@/components/feedback-panel"
import { GoogleAuthModal, type UserProfile } from "@/components/google-auth-modal"
import { AlertsModal } from "@/components/alerts-modal"
import { TripPlanner, type TripPlanPayload, type TripPlace } from "@/components/trip-planner"
import dynamic from "next/dynamic"
import { type RealBus, type RealItinerary, type RealStop, type NearbyStop } from "@/components/real-route-map"
import { apiUrl } from "@/lib/base-path"
import { estimateEtaMinutes } from "@/lib/bus-accesibilidad"
import { formatTripPlanSummary, type TripPlanResult } from "@/lib/trip-plan"

const RealRouteMap = dynamic(
  () => import("@/components/real-route-map").then((mod) => mod.RealRouteMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
        Cargando mapa interactivo real...
      </div>
    ),
  }
)

type Tab = "gps" | "programacion" | "itinerarios" | "paradas" | "contacto"

const TABS: { id: Tab; label: string; icon: typeof Satellite }[] = [
  { id: "gps", label: "Mapa", icon: Satellite },
  { id: "programacion", label: "Programación", icon: CalendarClock },
  { id: "itinerarios", label: "Itinerarios", icon: Route },
  { id: "paradas", label: "Paradas", icon: MapPin },
  { id: "contacto", label: "Reclamos", icon: MessageSquare },
]

function computeStatus(bus: Bus): { status: BusStatus; speedKmh: number } {
  if (bus.dwellTicks > 0) return { status: "stopped", speedKmh: 0 }
  const { distance } = nearestStopInfo(bus.progress)
  if (distance < 0.022) return { status: "arrival", speedKmh: 12 }
  if (distance < 0.06) return { status: "near", speedKmh: 20 }
  return { status: "moving", speedKmh: 30 + Math.round(bus.speedFactor * 4000) }
}

function sanitizeSpeedKmh(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  // Descarta lecturas GPS absurdas (picos del sensor)
  if (n > 120) return 0
  return Math.round(n)
}

// Función Haversine para calcular la distancia en metros entre dos coordenadas (Lat/Lng)
function getHaversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3 // Radio de la Tierra en metros
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

const AT_STOP_METERS = 50

function parseNearbyFeatures(features: any[]): NearbyStop[] {
  return features
    .map((f: any, idx: number) => {
      const coords = f?.geometry?.coordinates
      if (!Array.isArray(coords) || coords.length < 2) return null
      const [lngCoord, latCoord] = coords
      const bearingRaw = f?.properties?.bearing
      const bearingNum =
        bearingRaw != null && bearingRaw !== "" ? Number(bearingRaw) : null
      return {
        id: Number(f?.properties?.id),
        source_id: f?.properties?.source_id,
        source_name:
          f?.properties?.source_name || f?.properties?.source_id || "Parada",
        distancia_m: Number(f?.properties?.distancia_m) || 0,
        latitud: Number(latCoord),
        longitud: Number(lngCoord),
        bearing: Number.isFinite(bearingNum as number) ? bearingNum : null,
        rank: idx + 1,
      } as NearbyStop
    })
    .filter(Boolean) as NearbyStop[]
}

async function fetchOsrmFootRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<{ coords: [number, number][]; distanceM: number; durationMin: number } | null> {
  try {
    const osrmUrl =
      `https://router.project-osrm.org/route/v1/foot/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?overview=full&geometries=geojson`
    const osrmRes = await fetch(osrmUrl)
    const osrmData = await osrmRes.json()
    const route = osrmData?.routes?.[0]
    if (!route?.geometry?.coordinates) return null
    const coords: [number, number][] = route.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => [lat, lng]
    )
    return {
      coords,
      distanceM: Math.round(route.distance || 0),
      durationMin: Math.round((route.duration || 0) / 60),
    }
  } catch {
    return null
  }
}

export function BusTracker() {
  const [buses, setBuses] = useState<Bus[]>(INITIAL_BUSES)
  const [realBuses, setRealBuses] = useState<RealBus[]>([])
  const [realItineraries, setRealItineraries] = useState<RealItinerary[]>([])
  const [realStops, setRealStops] = useState<RealStop[]>([])
  const [useRealData, setUseRealData] = useState<boolean>(true)
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>("gps")
  const [clock, setClock] = useState<string>("")

  const [empresas, setEmpresas] = useState<any[]>([])
  const [selectedCodCatalogo, setSelectedCodCatalogo] = useState<string>("")

  // Estados de Usuario Google y Modales
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [isAlertsModalOpen, setIsAlertsModalOpen] = useState(false)

  // Viaje: origen → destino (formulario desplegable)
  const [tripFormOpen, setTripFormOpen] = useState(false)
  const [tripPlanning, setTripPlanning] = useState(false)
  const [mapPickMode, setMapPickMode] = useState<"origin" | "destination" | null>(
    null
  )
  const [mapPickedPoint, setMapPickedPoint] = useState<{
    mode: "origin" | "destination"
    place: TripPlace
  } | null>(null)
  const [draftOrigin, setDraftOrigin] = useState<TripPlace | null>(null)
  const [draftDestination, setDraftDestination] = useState<TripPlace | null>(null)
  const sameTripPlace = useCallback((a: TripPlace | null, b: TripPlace | null) => {
    if (a === b) return true
    if (!a || !b) return false
    return a.id === b.id && a.lat === b.lat && a.lng === b.lng && a.label === b.label
  }, [])
  const handleDraftPlacesChange = useCallback(
    (o: TripPlace | null, d: TripPlace | null) => {
      setDraftOrigin((prev) => (sameTripPlace(prev, o) ? prev : o))
      setDraftDestination((prev) => (sameTripPlace(prev, d) ? prev : d))
    },
    [sameTripPlace]
  )
  const [tripDestination, setTripDestination] = useState<{
    lat: number
    lng: number
    label: string
  } | null>(null)
  const [tripRouteCoords, setTripRouteCoords] = useState<[number, number][] | null>(null)
  const [tripSuggestions, setTripSuggestions] = useState<
    {
      cod_catalogo: number
      eot_nombre: string
      eot_linea: string
      paradas_origen: number
      paradas_destino: number
      cubre_destino: boolean | null
      lineas: string[]
    }[]
  >([])
  const [tripSummary, setTripSummary] = useState<string | null>(null)
  const [tripPlan, setTripPlan] = useState<TripPlanResult | null>(null)
  const [tripOptions, setTripOptions] = useState<TripPlanResult[]>([])
  const [destNearbyStops, setDestNearbyStops] = useState<NearbyStop[]>([])
  const [tripGuidance, setTripGuidance] = useState<{
    mode: "walk_to_stop" | "to_destination"
    atStop: boolean
    boardingRanks: number[]
    boardingNames: string[]
    targetStopName?: string
  } | null>(null)
  /** Filtro de viaje: solo buses en movimiento de líneas relevantes */
  const [tripBusFilter, setTripBusFilter] = useState<{
    catalogos: number[]
    lineas: string[]
  } | null>(null)
  const [needsAccessibility, setNeedsAccessibility] = useState(false)
  const [selectedBoardingStopId, setSelectedBoardingStopId] = useState<number | null>(null)
  const [boardingRouteLoading, setBoardingRouteLoading] = useState(false)

  const [proximityStatus, setProximityStatus] = useState<
    "llegando" | "cercano" | "normal" | "pasado" | null
  >(null)
  const [nearestDistanceMeters, setNearestDistanceMeters] = useState<number | null>(null)
  const [nearestBusLabel, setNearestBusLabel] = useState<string | null>(null)
  const [avgBusSpeedKmh, setAvgBusSpeedKmh] = useState<number | null>(null)
  const [closestBuses, setClosestBuses] = useState<RealBusWithDistance[]>([])
  const approachAlertRef = useRef<string | null>(null)

  // Paradas cercanas vía geo-itinerarios (proxy /api/paradas/cercanas)
  const [nearbyStops, setNearbyStops] = useState<NearbyStop[]>([])
  const [nearbyRadioM, setNearbyRadioM] = useState(1200)
  const [nearbyLimit, setNearbyLimit] = useState(5)
  /** Con destino: mostrar también paradas no filtradas (más opciones) */
  const [showMoreStops, setShowMoreStops] = useState(false)
  const showMoreStopsRef = useRef(false)
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [nearbyError, setNearbyError] = useState<string | null>(null)
  const [autoCenterNearby, setAutoCenterNearby] = useState(true)
  const [isTrackingLocation, setIsTrackingLocation] = useState(false)
  const [empresaPasaPorCercanas, setEmpresaPasaPorCercanas] = useState<boolean | null>(null)
  const [matchingItinerarioIds, setMatchingItinerarioIds] = useState<number[]>([])
  const [empresaCercanasChecking, setEmpresaCercanasChecking] = useState(false)
  const geoWatchIdRef = useRef<number | null>(null)
  const nearbyFetchAbortRef = useRef<AbortController | null>(null)
  const nearbyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const allItinerariesRef = useRef<RealItinerary[]>([])
  const lastEmpresaAnnounceRef = useRef<string>("")
  /** Paradas de abordaje del viaje activo (sobreviven al refresh GPS) */
  const tripBoardingIdsRef = useRef<Set<number>>(new Set())
  /** Paradas con sentido (bearing) correcto hacia el destino */
  const tripPreferredStopIdsRef = useRef<Set<number>>(new Set())
  /** Paradas de bajada cercanas al destino */
  const tripAlightingIdsRef = useRef<Set<number>>(new Set())
  const selectedBoardingStopIdRef = useRef<number | null>(null)

  // Cargar lista de empresas
  useEffect(() => {
    async function loadEmpresas() {
      try {
        const res = await fetch(apiUrl("/api/empresas"))
        const data = await res.json()
        if (data.success && data.data) {
          setEmpresas(data.data)
        }
      } catch (err) {
        console.error("Error loading empresas:", err)
      }
    }
    loadEmpresas()
  }, [])

  // Polling de Datos Reales de las BDs PostgreSQL
  useEffect(() => {
    async function fetchRealData() {
      try {
        const itinUrl = selectedCodCatalogo
          ? apiUrl(`/api/itinerarios?cod_catalogo=${selectedCodCatalogo}`)
          : apiUrl("/api/itinerarios")

        let busUrl = selectedCodCatalogo
          ? apiUrl(`/api/buses?cod_catalogo=${selectedCodCatalogo}`)
          : apiUrl("/api/buses")

        // Durante un viaje planificado: solo buses de la empresa/línea elegida
        if (tripBusFilter && (tripBusFilter.catalogos.length > 0 || tripBusFilter.lineas.length > 0)) {
          const params = new URLSearchParams()
          // Con empresa elegida: filtrar por catálogo (todas sus rutas GPS).
          // Las líneas se usan solo si no hay catálogo (evita AND demasiado estricto).
          if (tripBusFilter.catalogos.length) {
            params.set("cod_catalogos", tripBusFilter.catalogos.join(","))
          } else if (tripBusFilter.lineas.length) {
            params.set("lineas", tripBusFilter.lineas.join(","))
          }
          params.set("solo_en_movimiento", "true")
          params.set("min_velocidad", "1")
          // Incluir también unidades cercanas a la parada recomendada (aunque detenidas)
          params.set("incluir_cercanos_m", "3000")
          const refStop =
            selectedBoardingStopId != null
              ? nearbyStops.find((s) => s.id === selectedBoardingStopId)
              : nearbyStops.find((s) => s.isBoardingRecommended || s.isBoardingSelected)
          const refLat = refStop?.latitud ?? user?.lat
          const refLng = refStop?.longitud ?? user?.lng
          if (refLat != null && refLng != null) {
            params.set("lat", String(refLat))
            params.set("lng", String(refLng))
          }
          busUrl = apiUrl(`/api/viaje/buses-relevantes?${params.toString()}`)
        }

        const [resBuses, resItin] = await Promise.all([fetch(busUrl), fetch(itinUrl)])
        const dataBuses = await resBuses.json()
        const dataItin = await resItin.json()

        if (dataBuses.success && dataBuses.data) {
          setRealBuses(dataBuses.data)
        }
        if (dataItin.success && dataItin.data) {
          if (selectedCodCatalogo) {
            allItinerariesRef.current = dataItin.data
            // Con empresa elegida: mostrar TODAS sus líneas/itinerarios en el mapa
            setRealItineraries(dataItin.data)
          } else if (!tripPlan) {
            allItinerariesRef.current = []
            setRealItineraries([])
          }
        }
        setRealStops([])
      } catch (err) {
        console.error("Error fetching real DB data:", err)
      }
    }

    fetchRealData()
    const interval = setInterval(fetchRealData, 4000)
    return () => clearInterval(interval)
    // nearbyStops / selectedBoardingStopId: solo para coords de referencia en el filtro de viaje
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCodCatalogo,
    matchingItinerarioIds,
    empresaPasaPorCercanas,
    nearbyStops.length,
    selectedBoardingStopId,
    tripBusFilter,
    tripPlan,
    user?.lat,
    user?.lng,
  ])

  const { enabled: voiceEnabled, supported: voiceSupported, speak, toggle } = useVoiceAnnouncer()

  const lastStatusRef = useRef<Record<string, BusStatus>>({})

  const stopLocationWatch = useCallback(() => {
    if (geoWatchIdRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(geoWatchIdRef.current)
      geoWatchIdRef.current = null
    }
    setIsTrackingLocation(false)
  }, [])

  const applyUserLocation = useCallback(
    (lat: number, lng: number, announce = false) => {
      setUser((prev) =>
        prev
          ? { ...prev, lat, lng, locationShared: true }
          : {
              name: "Usuario Asunción",
              email: "ciudadano@asuncion.gov.py",
              lat,
              lng,
              locationShared: true,
            }
      )
      if (announce) {
        speak("Ubicación en vivo compartida correctamente", { force: true })
      }
    },
    [speak]
  )

  useEffect(() => {
    selectedBoardingStopIdRef.current = selectedBoardingStopId
  }, [selectedBoardingStopId])

  useEffect(() => {
    showMoreStopsRef.current = showMoreStops
  }, [showMoreStops])

  const fetchNearbyStops = useCallback(
    async (lat: number, lng: number) => {
      nearbyFetchAbortRef.current?.abort()
      const controller = new AbortController()
      nearbyFetchAbortRef.current = controller
      setNearbyLoading(true)
      setNearbyError(null)

      try {
        const url =
          apiUrl(
            `/api/paradas/cercanas?lat=${lat}&lng=${lng}` +
              `&radio_m=${nearbyRadioM}&limit=${nearbyLimit}&fuente=all`
          )
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" })
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }

        const features = Array.isArray(data?.features) ? data.features : []
        const tripActive = tripBoardingIdsRef.current.size > 0
        const selectedId = selectedBoardingStopIdRef.current

        let parsed: NearbyStop[] = features
          .map((f: any) => {
            const coords = f?.geometry?.coordinates
            if (!Array.isArray(coords) || coords.length < 2) return null
            const [lngCoord, latCoord] = coords
            const id = Number(f?.properties?.id)
            return {
              id,
              source_id: f?.properties?.source_id,
              source_name:
                f?.properties?.source_name ||
                f?.properties?.source_id ||
                "Parada cercana",
              distancia_m: Number(f?.properties?.distancia_m) || 0,
              latitud: Number(latCoord),
              longitud: Number(lngCoord),
              bearing: (() => {
                const b = Number(f?.properties?.bearing)
                return Number.isFinite(b) ? b : null
              })(),
              isBoardingRecommended: tripActive
                ? tripPreferredStopIdsRef.current.size > 0
                  ? tripPreferredStopIdsRef.current.has(id)
                  : tripBoardingIdsRef.current.has(id)
                : undefined,
              isBoardingSelected: selectedId != null ? id === selectedId : false,
            } as NearbyStop
          })
          .filter(Boolean) as NearbyStop[]

        // Con destino activo: por defecto solo paradas correctas (sentido OK)
        if (tripActive && !showMoreStopsRef.current) {
          const preferred = tripPreferredStopIdsRef.current
          if (preferred.size > 0) {
            parsed = parsed.filter((s) => preferred.has(s.id))
          } else {
            parsed = parsed.filter((s) => tripBoardingIdsRef.current.has(s.id))
          }
        }

        parsed = parsed
          .sort((a, b) => a.distancia_m - b.distancia_m)
          .map((s, idx) => ({ ...s, rank: idx + 1 }))

        // Sin "Más paradas": tope 5 correctas
        if (tripActive && !showMoreStopsRef.current) {
          parsed = parsed.slice(0, 5)
        }

        // Conservar líneas/empresas ya cargadas al elegir una parada
        setNearbyStops((prev) => {
          const prevById = new Map(prev.map((s) => [s.id, s]))
          return parsed.map((s) => {
            const old = prevById.get(s.id)
            if (!old) return s
            return {
              ...s,
              lineasEmpresa: old.lineasEmpresa,
              empresasAtStop: old.empresasAtStop,
              servedByEmpresa:
                old.lineasEmpresa && old.lineasEmpresa.length > 0
                  ? true
                  : s.servedByEmpresa ?? old.servedByEmpresa,
            }
          })
        })
      } catch (err: any) {
        if (err?.name === "AbortError") return
        console.error("Error cargando paradas cercanas:", err)
        setNearbyError(
          err?.message ||
            "No se pudieron cargar paradas cercanas. Verificá que geo-itinerarios esté en :8020."
        )
        setNearbyStops([])
      } finally {
        setNearbyLoading(false)
      }
    },
    [nearbyLimit, nearbyRadioM]
  )

  // Verificar si la empresa seleccionada pasa por alguna parada cercana
  useEffect(() => {
    async function checkEmpresaEnCercanas() {
      if (!selectedCodCatalogo) {
        setEmpresaPasaPorCercanas(null)
        setMatchingItinerarioIds([])
        setNearbyStops((prev) =>
          prev.map((s) => ({
            ...s,
            servedByEmpresa: undefined,
            lineasEmpresa: undefined,
          }))
        )
        return
      }

      if (nearbyStops.length === 0) {
        setEmpresaPasaPorCercanas(null)
        setMatchingItinerarioIds([])
        return
      }

      setEmpresaCercanasChecking(true)
      try {
        const ids = nearbyStops.map((s) => s.id).join(",")
        const res = await fetch(
          apiUrl(
            `/api/paradas/empresa-en-cercanas?cod_catalogo=${selectedCodCatalogo}&parada_ids=${ids}`
          ),
          { cache: "no-store" }
        )
        const data = await res.json()
        if (!res.ok || !data.success) {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }

        const servedSet = new Set<number>(
          (data.matching_stop_ids || []).map((id: number) => Number(id))
        )
        const lineasByStop: Record<number, string[]> = {}
        for (const m of data.matches || []) {
          lineasByStop[Number(m.id_parada)] = m.lineas || []
        }

        setEmpresaPasaPorCercanas(Boolean(data.passes))
        setMatchingItinerarioIds(
          (data.matching_itinerario_ids || []).map((id: number) => Number(id))
        )

        setNearbyStops((prev) =>
          prev.map((s) => ({
            ...s,
            servedByEmpresa: servedSet.has(s.id),
            lineasEmpresa: lineasByStop[s.id] || [],
            isBoardingSelected:
              selectedBoardingStopId != null
                ? s.id === selectedBoardingStopId
                : s.isBoardingSelected,
          }))
        )

        // Mantener visibles todos los itinerarios de la empresa (no filtrar por cercanas)
        if (allItinerariesRef.current.length > 0) {
          setRealItineraries(allItinerariesRef.current)
        }

        const emp = empresas.find(
          (item) => String(item.cod_catalogo) === selectedCodCatalogo
        )
        const empName = emp?.eot_nombre || "La empresa seleccionada"
        const announceKey = `${selectedCodCatalogo}|${ids}|${Boolean(data.passes)}`
        if (lastEmpresaAnnounceRef.current !== announceKey) {
          lastEmpresaAnnounceRef.current = announceKey
          if (!data.passes) {
            speak(
              `${empName} no pasa por ninguna de las paradas cercanas a tu ubicación.`,
              { force: true }
            )
          } else {
            const n = data.matching_stop_ids?.length || 0
            speak(
              `${empName} pasa por ${n} parada${n === 1 ? "" : "s"} cercana${n === 1 ? "" : "s"}.`,
              { force: true }
            )
          }
        }
      } catch (err) {
        console.error("Error cruzando empresa con paradas cercanas:", err)
        setEmpresaPasaPorCercanas(null)
      } finally {
        setEmpresaCercanasChecking(false)
      }
    }

    void checkEmpresaEnCercanas()
    // Solo reaccionar a IDs de cercanas + empresa (no a servedByEmpresa interno)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCodCatalogo,
    nearbyStops.map((s) => s.id).join(","),
    empresas,
    speak,
    selectedBoardingStopId,
  ])

  const fetchNearbyStopsDebounced = useCallback(
    (lat: number, lng: number, immediate = false) => {
      if (nearbyDebounceRef.current) {
        clearTimeout(nearbyDebounceRef.current)
        nearbyDebounceRef.current = null
      }
      if (immediate) {
        void fetchNearbyStops(lat, lng)
        return
      }
      nearbyDebounceRef.current = setTimeout(() => {
        void fetchNearbyStops(lat, lng)
      }, 900)
    },
    [fetchNearbyStops]
  )

  const handlePlanTrip = useCallback(
    async (plan: TripPlanPayload) => {
      setTripPlanning(true)
      setTripSuggestions([])
      setTripSummary(null)
      setTripPlan(null)
      setTripOptions([])
      setDestNearbyStops([])
      setTripGuidance(null)
      setTripRouteCoords(null)
      setTripBusFilter(null)
      setNeedsAccessibility(Boolean(plan.necesitaAccesibilidad))
      setSelectedBoardingStopId(null)
      setShowMoreStops(false)
      showMoreStopsRef.current = false
      tripBoardingIdsRef.current = new Set()
      tripPreferredStopIdsRef.current = new Set()
      tripAlightingIdsRef.current = new Set()
      try {
        setUser((prev) =>
          prev
            ? {
                ...prev,
                lat: plan.origin.lat,
                lng: plan.origin.lng,
                locationShared: true,
              }
            : {
                name: "Viajero",
                email: "viaje@local",
                lat: plan.origin.lat,
                lng: plan.origin.lng,
                locationShared: true,
              }
        )
        setTripDestination({
          lat: plan.destination.lat,
          lng: plan.destination.lng,
          label: plan.destination.label,
        })
        setSelectedCodCatalogo(plan.codCatalogo)

        const [originRes, destRes] = await Promise.all([
          fetch(
            apiUrl(
              `/api/paradas/cercanas?lat=${plan.origin.lat}&lng=${plan.origin.lng}` +
                `&radio_m=${nearbyRadioM}&limit=${nearbyLimit}&fuente=all`
            ),
            { cache: "no-store" }
          ),
          fetch(
            apiUrl(
              `/api/paradas/cercanas?lat=${plan.destination.lat}&lng=${plan.destination.lng}` +
                `&radio_m=${Math.max(nearbyRadioM, 1500)}&limit=${Math.max(nearbyLimit, 5)}&fuente=all`
            ),
            { cache: "no-store" }
          ),
        ])

        const originData = await originRes.json()
        const destData = await destRes.json()
        const originParsed = parseNearbyFeatures(
          Array.isArray(originData?.features) ? originData.features : []
        )
        const destParsed = parseNearbyFeatures(
          Array.isArray(destData?.features) ? destData.features : []
        )

        const originIds = originParsed.map((s) => s.id)
        const destIds = destParsed.map((s) => s.id)

        let computedPlan: TripPlanResult | null = null
        try {
          const planUrl = apiUrl(
            `/api/viaje/planificar?parada_ids_origen=${originIds.join(",")}` +
              `&parada_ids_destino=${destIds.join(",")}` +
              `&lat_origen=${plan.origin.lat}&lng_origen=${plan.origin.lng}` +
              `&lat_destino=${plan.destination.lat}&lng_destino=${plan.destination.lng}` +
              `&limit=3` +
              (plan.codCatalogo ? `&cod_catalogo=${plan.codCatalogo}` : "")
          )
          const planRes = await fetch(planUrl, { cache: "no-store" })
          const rawText = await planRes.text()
          let planData: any = null
          try {
            planData = JSON.parse(rawText)
          } catch {
            console.error(
              "Error planificando tramos: respuesta no JSON",
              planRes.status,
              rawText.slice(0, 120)
            )
            setTripPlan(null)
            setTripOptions([])
            setTripSummary(
              planRes.status === 504 || planRes.status === 502
                ? "La búsqueda de viaje tardó demasiado. Probá de nuevo o marcá otro destino."
                : "No se pudo planificar el viaje (error del servidor)."
            )
            planData = null
          }
          if (planData) {
            const opts: TripPlanResult[] = Array.isArray(planData?.options)
              ? planData.options
              : planData?.best
                ? [planData.best]
                : []
            setTripOptions(opts)
            if (planData?.success && opts.length > 0) {
              computedPlan = opts[0]
              setTripPlan(computedPlan)
              setTripSummary(formatTripPlanSummary(computedPlan))
              speak(formatTripPlanSummary(computedPlan), { force: true })
              const planItinIds = [
                ...new Set(
                  (computedPlan.legs || [])
                    .map((l) => Number(l.id_itinerario))
                    .filter((n) => Number.isFinite(n) && n > 0)
                ),
              ]
              if (planItinIds.length > 0) {
                try {
                  const itinPlanRes = await fetch(
                    apiUrl(`/api/itinerarios?ids=${planItinIds.join(",")}`),
                    { cache: "no-store" }
                  )
                  const itinPlanData = await itinPlanRes.json()
                  if (itinPlanData?.success && Array.isArray(itinPlanData.data)) {
                    setRealItineraries(itinPlanData.data)
                    allItinerariesRef.current = itinPlanData.data
                  }
                } catch (err) {
                  console.error("Error cargando shapes del plan:", err)
                }
              }
            } else {
              setTripPlan(null)
              setTripOptions([])
              if (planData?.error) {
                setTripSummary(String(planData.error))
              }
            }
          }
        } catch (err) {
          console.error("Error planificando tramos:", err)
          setTripPlan(null)
          setTripOptions([])
        }

        const sugUrl = apiUrl(
          `/api/viaje/sugerir-empresas?parada_ids_origen=${originIds.join(",")}` +
            `&parada_ids_destino=${destIds.join(",")}` +
            `&limit=12` +
            (plan.codCatalogo ? `&cod_catalogo=${plan.codCatalogo}` : "")
        )
        const sugRes = await fetch(sugUrl, { cache: "no-store" })
        const sugData = await sugRes.json()
        const suggestions = Array.isArray(sugData.suggestions) ? sugData.suggestions : []
        // Priorizar empresas que llegan al destino
        const connecting = suggestions.filter((s: any) => s.cubre_destino === true)
        let listForUi = (connecting.length > 0 ? connecting : suggestions).slice(0, 8)

        // Si el usuario eligió empresa (ej. La Limpeña L49): solo esa
        const selectedCat = plan.codCatalogo
          ? Number(plan.codCatalogo)
          : NaN
        if (Number.isFinite(selectedCat)) {
          const onlySelected = listForUi.filter(
            (s: any) => Number(s.cod_catalogo) === selectedCat
          )
          if (onlySelected.length > 0) {
            listForUi = onlySelected
          } else {
            const emp = empresas.find(
              (item) => Number(item.cod_catalogo) === selectedCat
            )
            listForUi = [
              {
                cod_catalogo: selectedCat,
                eot_nombre: plan.empresaNombre || emp?.eot_nombre || "",
                eot_linea: emp?.eot_linea || "",
                lineas: String(emp?.eot_linea || "")
                  .split(/[-,/]/)
                  .map((x: string) => x.trim())
                  .filter(Boolean),
                parada_ids_origen: sugData.boarding_stop_ids || [],
                parada_ids_destino: sugData.alighting_stop_ids || [],
                cubre_destino: null,
              },
            ]
          }
        }
        setTripSuggestions(listForUi)

        // Activar tracking GPS solo de la empresa/línea del viaje
        const catalogos = [
          ...new Set(
            (Number.isFinite(selectedCat)
              ? [selectedCat]
              : listForUi.map((s: any) => Number(s.cod_catalogo))
            ).filter(Number.isFinite)
          ),
        ] as number[]
        const lineasSet = new Set<string>()
        for (const s of listForUi) {
          for (const ln of s.lineas || []) {
            const t = String(ln).trim()
            if (t) lineasSet.add(t)
          }
        }
        // También partir eot_linea tipo "23-24-33" / "49"
        for (const s of listForUi) {
          const raw = String(s.eot_linea || "")
          for (const part of raw.split(/[-,/]/).map((x: string) => x.trim()).filter(Boolean)) {
            lineasSet.add(part)
          }
        }
        if (Number.isFinite(selectedCat)) {
          const emp = empresas.find(
            (item) => Number(item.cod_catalogo) === selectedCat
          )
          for (const part of String(emp?.eot_linea || "")
            .split(/[-,/]/)
            .map((x) => x.trim())
            .filter(Boolean)) {
            lineasSet.add(part)
          }
        }
        const lineas = [...lineasSet]
        if (catalogos.length > 0 || lineas.length > 0) {
          setTripBusFilter({ catalogos, lineas })
        }

        // No forzar empresa: si el usuario no eligió, dejar "Empresa (opcional)" vacío
        // (las sugerencias se muestran aparte para que elija)

        const boardingIdSet = new Set<number>(
          (sugData.boarding_stop_ids || []).map((id: number) => Number(id))
        )
        const alightingIdSet = new Set<number>(
          (sugData.alighting_stop_ids || []).map((id: number) => Number(id))
        )
        // Con empresa elegida: solo sus paradas. Si no, empresas que cubren destino.
        if (Number.isFinite(selectedCat) && listForUi[0]) {
          boardingIdSet.clear()
          alightingIdSet.clear()
          for (const id of listForUi[0].parada_ids_origen || []) {
            boardingIdSet.add(Number(id))
          }
          for (const id of listForUi[0].parada_ids_destino || []) {
            alightingIdSet.add(Number(id))
          }
        } else if (connecting.length > 0) {
          boardingIdSet.clear()
          alightingIdSet.clear()
          for (const s of connecting) {
            for (const id of s.parada_ids_origen || []) boardingIdSet.add(Number(id))
            for (const id of s.parada_ids_destino || []) alightingIdSet.add(Number(id))
          }
        }
        if (alightingIdSet.size === 0) {
          for (const id of destIds) alightingIdSet.add(Number(id))
        }

        if (computedPlan?.type === "transfer" && computedPlan.legs.length >= 2) {
          const leg1 = computedPlan.legs[0]
          const leg2 = computedPlan.legs[1]
          boardingIdSet.clear()
          alightingIdSet.clear()
          boardingIdSet.add(leg1.boarding.id)
          if (computedPlan.transfer?.id) boardingIdSet.add(computedPlan.transfer.id)
          alightingIdSet.add(leg2.alighting.id)
          setTripSummary(formatTripPlanSummary(computedPlan))
          speak(formatTripPlanSummary(computedPlan), { force: true })
          const transferCatalogos = [
            ...new Set(
              computedPlan.legs
                .map((l) => l.cod_catalogo)
                .filter((n) => Number.isFinite(n))
            ),
          ] as number[]
          const transferLineas = [
            ...new Set(
              computedPlan.legs
                .map((l) => String(l.linea || "").trim())
                .filter(Boolean)
            ),
          ] as string[]
          if (transferCatalogos.length > 0 || transferLineas.length > 0) {
            setTripBusFilter({
              catalogos: transferCatalogos,
              lineas: transferLineas,
            })
          }
        } else if (computedPlan?.type === "direct" && computedPlan.legs[0]) {
          const leg = computedPlan.legs[0]
          boardingIdSet.add(leg.boarding.id)
          alightingIdSet.add(leg.alighting.id)
        }

        tripBoardingIdsRef.current = new Set(boardingIdSet)
        tripAlightingIdsRef.current = new Set(alightingIdSet)

        // Solo paradas de bajada que sirven para el destino
        const markedDest = destParsed
          .filter((s) => alightingIdSet.size === 0 || alightingIdSet.has(s.id))
          .map((s) => ({ ...s, isAlightingRecommended: true }))
          .sort((a, b) => a.distancia_m - b.distancia_m)
          .map((s, idx) => ({ ...s, rank: idx + 1 }))

        const destWithLines = await Promise.all(
          markedDest.slice(0, 6).map(async (s) => {
            try {
              const res = await fetch(
                apiUrl(
                  `/api/paradas/${s.id}/lineas-vinculadas?limit=40&distinct_linea=true`
                ),
                { cache: "no-store" }
              )
              const data = await res.json()
              const rows = Array.isArray(data?.lineas) ? data.lineas : []
              const labels = [
                ...new Set(
                  rows
                    .map((l: any) => {
                      const a = String(l.linea ?? "").trim()
                      const b = String(l.ramal ?? "").trim()
                      return b ? `${a}-${b}` : a
                    })
                    .filter(Boolean)
                ),
              ] as string[]
              const empresasNames = [
                ...new Set(
                  rows
                    .map((l: any) => String(l.eot_nombre || "").trim())
                    .filter(Boolean)
                ),
              ] as string[]
              const catalogosAtStop = [
                ...new Set(
                  rows
                    .map((l: any) => Number(l.cod_catalogo))
                    .filter((n: number) => Number.isFinite(n))
                ),
              ] as number[]
              const lineasBase = [
                ...new Set(
                  rows
                    .map((l: any) => String(l.linea || "").trim())
                    .filter(Boolean)
                ),
              ] as string[]
              return {
                ...s,
                lineasEmpresa: labels,
                empresasAtStop: empresasNames,
                catalogosAtStop,
                lineasBase,
              }
            } catch {
              return s
            }
          })
        )
        setDestNearbyStops([...destWithLines, ...markedDest.slice(6)])

        // Bajada recomendada → sus líneas/empresas definen dónde abordar cerca tuyo
        const primaryAlighting = destWithLines.filter(
          (s: any) =>
            (s.lineasEmpresa && s.lineasEmpresa.length > 0) ||
            (s.catalogosAtStop && s.catalogosAtStop.length > 0)
        )
        const alightingRefs =
          primaryAlighting.length > 0
            ? primaryAlighting.slice(0, 3)
            : destWithLines.slice(0, 3)

        const destCatalogos = [
          ...new Set(
            alightingRefs.flatMap((s: any) => s.catalogosAtStop || [])
          ),
        ] as number[]
        const destLineasBase = [
          ...new Set(alightingRefs.flatMap((s: any) => s.lineasBase || [])),
        ] as string[]

        const catalogosAbordaje = Number.isFinite(selectedCat)
          ? [selectedCat]
          : destCatalogos.length > 0
            ? destCatalogos
            : catalogos
        const lineasAbordaje =
          destLineasBase.length > 0 ? destLineasBase : lineas

        let boardingFromDest: {
          id_parada: number
          lineas: string[]
          empresas: string[]
          catalogos: number[]
        }[] = []
        try {
          const abordajeParams = new URLSearchParams()
          abordajeParams.set("parada_ids_origen", originIds.join(","))
          if (alightingRefs.length > 0) {
            abordajeParams.set(
              "parada_ids_destino",
              alightingRefs.map((s) => s.id).join(",")
            )
          }
          if (catalogosAbordaje.length) {
            abordajeParams.set("cod_catalogos", catalogosAbordaje.join(","))
          }
          if (lineasAbordaje.length) {
            abordajeParams.set("lineas", lineasAbordaje.join(","))
          }
          const abRes = await fetch(
            apiUrl(`/api/viaje/paradas-abordaje?${abordajeParams.toString()}`),
            { cache: "no-store" }
          )
          const abData = await abRes.json()
          if (abData?.success && Array.isArray(abData.matches)) {
            boardingFromDest = abData.matches
          }
        } catch (err) {
          console.error("Error paradas-abordaje:", err)
        }

        const matchById = new Map(
          boardingFromDest.map((m) => [m.id_parada, m])
        )
        boardingIdSet.clear()
        for (const m of boardingFromDest) boardingIdSet.add(m.id_parada)

        if (catalogosAbordaje.length > 0 || lineasAbordaje.length > 0) {
          setTripBusFilter({
            catalogos: catalogosAbordaje,
            lineas: lineasAbordaje,
          })
        }

        let boardingStops = originParsed.filter((s) => matchById.has(s.id))
        if (
          computedPlan?.type === "transfer" &&
          computedPlan.legs[0]?.boarding.id
        ) {
          const leg1Id = computedPlan.legs[0].boarding.id
          const leg1Stop = originParsed.find((s) => s.id === leg1Id)
          if (leg1Stop) {
            boardingStops = [
              {
                ...leg1Stop,
                isBoardingRecommended: true,
                rank: 1,
                lineasEmpresa: computedPlan.legs[0].linea
                  ? [computedPlan.legs[0].linea]
                  : [],
                empresasAtStop: computedPlan.legs[0].eot_nombre
                  ? [computedPlan.legs[0].eot_nombre]
                  : [],
                servedByEmpresa: true,
              },
            ]
          }
        }
        if (boardingStops.length === 0) {
          boardingStops = originParsed.filter((s) =>
            (sugData.boarding_stop_ids || []).map(Number).includes(s.id)
          )
        }
        if (boardingStops.length === 0 && connecting.length === 0) {
          boardingStops = originParsed.slice(0, 3)
        }

        boardingStops = boardingStops.map((s) => {
          const m = matchById.get(s.id)
          if (!m) return s
          return {
            ...s,
            lineasEmpresa: m.lineas,
            empresasAtStop: m.empresas,
            servedByEmpresa: true,
          }
        })

        const alightHintName =
          alightingRefs[0]?.source_name || markedDest[0]?.source_name || ""
        const alightHintRank =
          alightingRefs[0]?.rank || markedDest[0]?.rank || 1
        const empresasHint = [
          ...new Set(alightingRefs.flatMap((s) => s.empresasAtStop || [])),
        ]
          .slice(0, 4)
          .join(", ")
        const lineasHint = [
          ...new Set(alightingRefs.flatMap((s) => s.lineasEmpresa || [])),
        ]
          .slice(0, 6)
          .join(", ")

        // Solo mostrar las paradas que llevan al destino (mapa + lista)
        // Filtrar por vínculo de líneas + bearing (sentido) hacia el destino
        const usefulOrigin = boardingStops
          .filter((s) => {
            const check = stopServesDestination({
              stopLat: s.latitud,
              stopLng: s.longitud,
              stopBearing: s.bearing,
              destination: {
                lat: plan.destination.lat,
                lng: plan.destination.lng,
              },
              isBoardingCandidate: true,
            })
            return check.ok
          })
          .slice()
          .sort((a, b) => a.distancia_m - b.distancia_m)
          .map((s, idx) => ({
            ...s,
            rank: idx + 1,
            isBoardingRecommended: true,
          }))

        tripBoardingIdsRef.current = new Set(
          boardingStops.map((s) => s.id).length > 0
            ? boardingStops.map((s) => s.id)
            : boardingIdSet
        )
        tripAlightingIdsRef.current = new Set(alightingIdSet)
        tripPreferredStopIdsRef.current = new Set(usefulOrigin.map((s) => s.id))

        // Por defecto: SOLO paradas correctas (ocultar sentido incorrecto)
        // Con "Más paradas" se pueden ver también las incorrectas
        const preferred = tripPreferredStopIdsRef.current
        const correctStops =
          preferred.size > 0
            ? usefulOrigin.slice(0, 5)
            : boardingStops
                .slice()
                .sort((a, b) => a.distancia_m - b.distancia_m)
                .slice(0, 5)
                .map((s, idx) => ({
                  ...s,
                  rank: idx + 1,
                  isBoardingRecommended: true,
                }))

        const incorrectStops = boardingStops
          .filter((s) => preferred.size > 0 && !preferred.has(s.id))
          .slice()
          .sort((a, b) => a.distancia_m - b.distancia_m)
          .map((s) => ({
            ...s,
            isBoardingRecommended: false,
          }))

        const displayStops = (
          showMoreStopsRef.current
            ? [
                ...correctStops,
                ...incorrectStops.map((s, idx) => ({
                  ...s,
                  rank: correctStops.length + idx + 1,
                })),
              ]
            : correctStops
        ).map((s, idx) => ({ ...s, rank: idx + 1 }))

        const nearestUseful =
          displayStops.find((s) => s.isBoardingRecommended) || displayStops[0]
        const atUsefulStop = Boolean(
          nearestUseful &&
            nearestUseful.distancia_m <= AT_STOP_METERS &&
            nearestUseful.isBoardingRecommended
        )
        const boardingRanks = displayStops
          .filter((s) => s.isBoardingRecommended)
          .map((s) => s.rank || 0)
          .filter(Boolean)
        const boardingNames = displayStops
          .filter((s) => s.isBoardingRecommended)
          .map((s) => s.source_name)

        const keepPlanSummary = Boolean(computedPlan)

        if (displayStops.length === 0) {
          setNearbyStops([])
          if (!keepPlanSummary) {
            setTripSummary(
              `No hay paradas cercanas a tu ubicación con las líneas/empresas de la bajada en ${plan.destination.label}` +
                (alightHintName ? ` (${alightHintName}).` : ".") +
                ` Probá ampliar el radio o cambiar el destino.`
            )
            speak(
              `No hay paradas cerca tuyo con las líneas que llegan a ${plan.destination.label}.`,
              { force: true }
            )
          }
        } else if (!atUsefulStop) {
          const target = nearestUseful
          const withSelected = displayStops.map((s) => ({
            ...s,
            isBoardingSelected: s.id === target.id,
          }))
          setNearbyStops(withSelected)
          setSelectedBoardingStopId(target.id)

          // No mostrar "cómo llegar" para evitar confusión (auto vs. a pie).
          setTripRouteCoords(null)

          const ranksLabel = boardingRanks.join(" o ")
          const alightingRanks = markedDest
            .map((s) => s.rank)
            .filter(Boolean)
            .slice(0, 4)
          const alightLabel =
            alightingRanks.length > 0
              ? ` Bajá cerca de ${plan.destination.label} en #${alightingRanks.join(", #")}` +
                (alightHintName ? ` (${alightHintName})` : "") +
                "."
              : ""
          const matchLabel =
            lineasHint || empresasHint
              ? ` Mismas líneas/empresas que la bajada` +
                (lineasHint ? `: L${lineasHint}` : "") +
                (empresasHint ? ` · ${empresasHint}` : "") +
                "."
              : ""
          setTripGuidance({
            mode: "walk_to_stop",
            atStop: false,
            boardingRanks,
            boardingNames,
            targetStopName: target.source_name,
          })
          if (!keepPlanSummary) {
            setTripSummary(
              `Paradas cerca tuyo que llegan a ${plan.destination.label} (vía bajada #${alightHintRank}). ` +
                `Parada recomendada: #${target.rank}` +
                (boardingRanks.length > 1 ? ` (también #${ranksLabel})` : "") +
                `: ${target.source_name}.` +
                matchLabel +
                alightLabel
            )
            speak(
              `Cerca tuyo hay paradas con las líneas de la bajada número ${alightHintRank}. Parada recomendada número ${target.rank}. ${target.source_name}.` +
                (alightingRanks.length > 0
                  ? ` En el destino bajá en la parada número ${alightingRanks[0]}.`
                  : ""),
              { force: true }
            )
          }
        } else {
          // Ya en parada correcta → trazar hacia destino
          const nearest = nearestUseful
          const withSelected = displayStops.map((s) => ({
            ...s,
            isBoardingSelected: nearest ? s.id === nearest.id : false,
          }))
          setNearbyStops(withSelected)
          if (nearest) setSelectedBoardingStopId(nearest.id)

          const destTarget = markedDest[0] || destParsed[0]
          const routeTo = destTarget
            ? { lat: destTarget.latitud, lng: destTarget.longitud }
            : { lat: plan.destination.lat, lng: plan.destination.lng }

          const walk = await fetchOsrmFootRoute(
            { lat: plan.origin.lat, lng: plan.origin.lng },
            routeTo
          )
          const toDest = await fetchOsrmFootRoute(
            { lat: plan.origin.lat, lng: plan.origin.lng },
            { lat: plan.destination.lat, lng: plan.destination.lng }
          )
          if (toDest) setTripRouteCoords(toDest.coords)
          else if (walk) setTripRouteCoords(walk.coords)

          setTripGuidance({
            mode: "to_destination",
            atStop: true,
            boardingRanks: nearest?.rank ? [nearest.rank] : [],
            boardingNames: nearest ? [nearest.source_name] : [],
            targetStopName: nearest?.source_name,
          })

          const empCount = listForUi.length
          const alightingRanks = markedDest
            .map((s) => s.rank)
            .filter(Boolean)
            .slice(0, 4)
          const alightTxt =
            alightingRanks.length > 0
              ? ` Bajá cerca de ${plan.destination.label} en #${alightingRanks.join(", #")}.`
              : destTarget
                ? ` Bajá en #${destTarget.rank} (${destTarget.source_name}).`
                : ""
          if (!keepPlanSummary) {
            setTripSummary(
              `Estás en la parada correcta (#${nearest?.rank}). ` +
                (toDest
                  ? `Ruta de referencia al destino: ~${(toDest.distanceM / 1000).toFixed(1)} km / ${toDest.durationMin} min. `
                  : "") +
                (lineasHint
                  ? `Líneas de la bajada: ${lineasHint}. `
                  : empCount > 0
                    ? `${empCount} empresa(s) te llevan a ${plan.destination.label}.`
                    : "No se encontraron empresas que conecten origen y destino.") +
                alightTxt
            )
            speak(
              `Estás en la parada correcta. Las líneas de la bajada te llevan hacia ${plan.destination.label}.` +
                (alightingRanks[0] ? ` Bajá en la parada número ${alightingRanks[0]}.` : ""),
              { force: true }
            )
          }
        }

        setActiveTab("gps")
        setTripFormOpen(false)
        setAutoCenterNearby(true)
      } catch (err: any) {
        console.error("Error planificando viaje:", err)
        setTripSummary(err?.message || "No se pudo planificar el viaje.")
        speak("No se pudo planificar el viaje", { force: true })
      } finally {
        setTripPlanning(false)
      }
    },
    [nearbyLimit, nearbyRadioM, speak, empresas]
  )

  /** Elegir parada de abordaje (#1, #2…) y filtrar buses relevantes */
  const handleSelectBoardingStop = useCallback(
    async (stop: NearbyStop) => {
      if (!stop?.latitud || !stop?.longitud) return

      // Con destino: validar si la parada sirve (vínculo + bearing)
      if (tripDestination) {
        const isCandidate =
          tripBoardingIdsRef.current.size === 0 ||
          tripBoardingIdsRef.current.has(stop.id) ||
          Boolean(stop.isBoardingRecommended)

        const check = stopServesDestination({
          stopLat: stop.latitud,
          stopLng: stop.longitud,
          stopBearing: stop.bearing,
          destination: {
            lat: tripDestination.lat,
            lng: tripDestination.lng,
          },
          isBoardingCandidate: isCandidate,
        })

        const preferredOk =
          tripPreferredStopIdsRef.current.size === 0 ||
          tripPreferredStopIdsRef.current.has(stop.id)

        if (!check.ok || !preferredOk) {
          const msg =
            !isCandidate
              ? `La parada #${stop.rank || "?"} (${stop.source_name}) no te lleva a ${tripDestination.label}. Elegí la parada indicada.`
              : `La parada #${stop.rank || "?"} no es la indicada para ${tripDestination.label}: ${check.reason}`
          setTripSummary(msg)
          speak(msg, { force: true })
          if (typeof window !== "undefined") {
            window.alert(msg)
          }
          return
        }
      }

      setSelectedBoardingStopId(stop.id)
      setNearbyStops((prev) =>
        prev.map((s) => ({
          ...s,
          isBoardingSelected: s.id === stop.id,
        }))
      )

      // Cargar líneas que pasan por esta parada → solo buses en movimiento de esas líneas
      setBoardingRouteLoading(true)
      try {
        const lineasRes = await fetch(
          apiUrl(
            `/api/paradas/${stop.id}/lineas-vinculadas?limit=50&distinct_linea=true`
          ),
          { cache: "no-store" }
        )
        const lineasData = await lineasRes.json()
        const lineasRowsAll = Array.isArray(lineasData?.lineas) ? lineasData.lineas : []
        const selectedCat = selectedCodCatalogo
          ? Number(selectedCodCatalogo)
          : NaN
        // Con empresa elegida: solo sus líneas (ej. La Limpeña / 49)
        const lineasRows =
          Number.isFinite(selectedCat)
            ? lineasRowsAll.filter(
                (l: any) => Number(l.cod_catalogo) === selectedCat
              )
            : lineasRowsAll
        const catalogos = [
          ...new Set(
            (Number.isFinite(selectedCat)
              ? [selectedCat]
              : lineasRows
                  .map((l: any) => Number(l.cod_catalogo))
                  .filter((n: number) => Number.isFinite(n))
            ).filter(Number.isFinite)
          ),
        ] as number[]
        const lineasLabels = [
          ...new Set(
            lineasRows
              .map((l: any) => {
                const a = String(l.linea ?? "").trim()
                const b = String(l.ramal ?? "").trim()
                if (!a && !b) return ""
                return b ? `${a}-${b}` : a
              })
              .filter(Boolean)
          ),
        ] as string[]
        const lineasNum = [
          ...new Set(
            lineasRows
              .map((l: any) => String(l.linea || "").trim())
              .filter(Boolean)
          ),
        ] as string[]
        // Fallback: líneas de la empresa en catálogo
        if (lineasNum.length === 0 && Number.isFinite(selectedCat)) {
          const emp = empresas.find(
            (item) => Number(item.cod_catalogo) === selectedCat
          )
          for (const part of String(emp?.eot_linea || "")
            .split(/[-,/]/)
            .map((x) => x.trim())
            .filter(Boolean)) {
            lineasNum.push(part)
            lineasLabels.push(part)
          }
        }
        const empresasNames = [
          ...new Set(
            lineasRows
              .map((l: any) => String(l.eot_nombre || "").trim())
              .filter(Boolean)
          ),
        ] as string[]
        if (empresasNames.length === 0 && Number.isFinite(selectedCat)) {
          const emp = empresas.find(
            (item) => Number(item.cod_catalogo) === selectedCat
          )
          if (emp?.eot_nombre) empresasNames.push(emp.eot_nombre)
        }

        // Actualizar popup/lista con líneas y empresas de esta parada
        setNearbyStops((prev) =>
          prev.map((s) =>
            s.id === stop.id
              ? {
                  ...s,
                  isBoardingSelected: true,
                  servedByEmpresa: lineasLabels.length > 0 ? true : s.servedByEmpresa,
                  lineasEmpresa: lineasLabels,
                  empresasAtStop: empresasNames,
                }
              : { ...s, isBoardingSelected: false }
          )
        )

        if (catalogos.length > 0 || lineasNum.length > 0) {
          setTripBusFilter({ catalogos, lineas: lineasNum })
        } else if (!lineasRes.ok) {
          setTripSummary(
            `Parada #${stop.rank}: no se pudieron cargar líneas (¿geo-itinerarios en :8020?).`
          )
        }

        const originLat = user?.lat
        const originLng = user?.lng
        if (originLat == null || originLng == null) {
          setTripSummary(
            `Parada #${stop.rank} OK.` +
              (lineasLabels.length
                ? ` Líneas: ${lineasLabels.slice(0, 8).join(", ")}.`
                : "") +
              (empresasNames.length
                ? ` Empresas: ${empresasNames.slice(0, 3).join(", ")}.`
                : "") +
              ` Filtrando buses en movimiento.`
          )
          speak(
            `Parada ${stop.rank} seleccionada. ${lineasLabels.length} líneas en movimiento filtradas.`,
            { force: true }
          )
          return
        }

        const atThisStop = (stop.distancia_m || 0) <= AT_STOP_METERS
        const busesHint =
          lineasLabels.length > 0
            ? ` En ruta / movimiento: ${lineasLabels.slice(0, 8).join(", ")}` +
              (empresasNames.length
                ? ` · ${empresasNames.slice(0, 3).join(", ")}.`
                : ".")
            : " Sin líneas vinculadas en BD para esta parada."

        if (atThisStop && tripDestination) {
          const toDest = await fetchOsrmFootRoute(
            { lat: originLat, lng: originLng },
            { lat: tripDestination.lat, lng: tripDestination.lng }
          )
          if (toDest) setTripRouteCoords(toDest.coords)
          setTripGuidance({
            mode: "to_destination",
            atStop: true,
            boardingRanks: stop.rank ? [stop.rank] : [],
            boardingNames: [stop.source_name],
            targetStopName: stop.source_name,
          })
          setTripSummary(
            `Parada #${stop.rank} · ${stop.source_name} (correcta para ${tripDestination.label}).` +
              busesHint
          )
          speak(
            `Parada ${stop.rank} correcta. Mostrando buses en movimiento que pasan por esta parada.`,
            { force: true }
          )
        } else {
          // No trazar "cómo llegar" para evitar confusión con navegación vial.
          setTripRouteCoords(null)

          setTripGuidance({
            mode: "walk_to_stop",
            atStop: false,
            boardingRanks: stop.rank ? [stop.rank] : [],
            boardingNames: [stop.source_name],
            targetStopName: stop.source_name,
          })
          setTripSummary(
            `Parada elegida: #${stop.rank} · ${stop.source_name}. ` +
              `Parada recomendada para abordar.` +
              busesHint
          )
          speak(
            `Parada ${stop.rank} seleccionada. Mostrando buses en movimiento de esa parada.`,
            { force: true }
          )
        }
      } catch (err) {
        console.error("Error al seleccionar parada:", err)
        setTripSummary("No se pudieron cargar las líneas de esta parada.")
        speak("No se pudieron cargar las líneas de esta parada", { force: true })
      } finally {
        setBoardingRouteLoading(false)
      }
    },
    [user?.lat, user?.lng, tripDestination, speak, selectedCodCatalogo, empresas]
  )

  // Solicitar compartir ubicación + seguimiento continuo
  const handleShareLocation = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      speak("Geolocalización no disponible en este dispositivo", { force: true })
      return
    }

    // Chrome solo permite GPS en HTTPS o localhost (no en http://IP)
    if (!window.isSecureContext) {
      const httpsUrl = `https://sistemas.mopc.gov.py/prototipo_vmt/`
      speak(
        "El GPS requiere HTTPS. Abrí sistemas.mopc.gov.py/prototipo_vmt o marcá el origen en el mapa.",
        { force: true }
      )
      setTripFormOpen(true)
      if (typeof window !== "undefined") {
        window.alert(
          `El navegador bloquea el GPS en HTTP.\n\nAbrí:\n${httpsUrl}\n\nTambién podés marcar el origen en el mapa.`
        )
      }
      return
    }

    stopLocationWatch()

    const geoOptions: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 5000,
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        applyUserLocation(lat, lng, true)
        fetchNearbyStopsDebounced(lat, lng, true)
      },
      (err) => {
        console.warn("Geolocalización denegada o no disponible:", err.message)
        // Fallback Asunción (Mcal. López) para pruebas
        const lat = -25.2865
        const lng = -57.608
        applyUserLocation(lat, lng, false)
        speak("Ubicación aproximada compartida", { force: true })
        fetchNearbyStopsDebounced(lat, lng, true)
      },
      geoOptions
    )

    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        applyUserLocation(lat, lng, false)
        fetchNearbyStopsDebounced(lat, lng, false)
      },
      (err) => {
        console.warn("Error en seguimiento de ubicación:", err.message)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 7000 }
    )
    setIsTrackingLocation(true)
  }, [applyUserLocation, fetchNearbyStopsDebounced, speak, stopLocationWatch])

  // Reconsultar cercanas si cambian radio/top N y ya hay ubicación
  useEffect(() => {
    if (user?.locationShared && user.lat != null && user.lng != null) {
      fetchNearbyStopsDebounced(user.lat, user.lng, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar filtros
  }, [nearbyRadioM, nearbyLimit])

  useEffect(() => {
    return () => {
      stopLocationWatch()
      nearbyFetchAbortRef.current?.abort()
      if (nearbyDebounceRef.current) clearTimeout(nearbyDebounceRef.current)
    }
  }, [stopLocationWatch])

  // Recalcular buses más cercanos, promedio de velocidad y alerta ≤1000 m
  useEffect(() => {
    if (!user || !user.locationShared || !user.lat || !user.lng) {
      setNearestDistanceMeters(null)
      setProximityStatus(null)
      setNearestBusLabel(null)
      setAvgBusSpeedKmh(null)
      setClosestBuses([])
      approachAlertRef.current = null
      return
    }

    if (useRealData && realBuses.length > 0) {
      const boardingStops =
        selectedBoardingStopId != null
          ? nearbyStops
              .filter((s) => s.id === selectedBoardingStopId)
              .map((s) => ({ lat: s.latitud, lng: s.longitud }))
          : nearbyStops
              .filter((s) => s.isBoardingRecommended || s.isBoardingSelected)
              .map((s) => ({ lat: s.latitud, lng: s.longitud }))

      const destRef =
        tripDestination?.lat != null && tripDestination?.lng != null
          ? { lat: tripDestination.lat, lng: tripDestination.lng }
          : null

      const enriched: RealBusWithDistance[] = realBuses.map((rb) => {
        const busLat = Number((rb as any).latitude ?? (rb as any).latitud)
        const busLng = Number((rb as any).longitude ?? (rb as any).longitud)
        // Distancia a la parada oficial recomendada (o al usuario)
        const refLat = boardingStops[0]?.lat ?? user.lat!
        const refLng = boardingStops[0]?.lng ?? user.lng!
        const distanceMeters =
          Number.isFinite(busLat) && Number.isFinite(busLng)
            ? getHaversineDistanceMeters(refLat, refLng, busLat, busLng)
            : Number.POSITIVE_INFINITY
        const passedBoardingStop =
          boardingStops.length > 0 &&
          Number.isFinite(busLat) &&
          Number.isFinite(busLng)
            ? evaluateBusVsBoardingStops({
                busLat,
                busLng,
                rumbo: (rb as any).rumbo,
                boardingStops,
                destination: destRef,
              })
            : false
        return {
          ...rb,
          distanceMeters,
          velocidad: sanitizeSpeedKmh(rb.velocidad),
          passedBoardingStop,
          eta_minutos:
            (rb as RealBusWithDistance).eta_minutos ??
            estimateEtaMinutes(distanceMeters, sanitizeSpeedKmh(rb.velocidad)),
        }
      })

      // Con viaje: todas las unidades de la línea elegida (no una por línea distinta)
      const closest = tripBusFilter
        ? Array.from(new Map(enriched.map((b) => [b.mean_id, b])).values())
            .filter(
              (b) =>
                typeof b.distanceMeters === "number" &&
                Number.isFinite(b.distanceMeters)
            )
            .sort((a, b) => {
              const ap = a.passedBoardingStop ? 1 : 0
              const bp = b.passedBoardingStop ? 1 : 0
              if (ap !== bp) return ap - bp
              if (needsAccessibility) {
                const ar = a.tiene_rampa === true ? 0 : a.tiene_rampa === false ? 1 : 2
                const br = b.tiene_rampa === true ? 0 : b.tiene_rampa === false ? 1 : 2
                if (ar !== br) return ar - br
              }
              return (a.distanceMeters || 0) - (b.distanceMeters || 0)
            })
            .slice(0, 12)
        : prepareClosestLineBuses(enriched, 3, needsAccessibility)
      setClosestBuses(closest)

      if (closest.length > 0) {
        const useful = closest.filter((b) => !b.passedBoardingStop)
        const focus = useful[0] || closest[0]
        const speeds = (useful.length > 0 ? useful : closest)
          .map((b) => sanitizeSpeedKmh(b.velocidad))
          .filter((v) => v > 0)
        const avg =
          speeds.length > 0
            ? Math.round(speeds.reduce((acc, v) => acc + v, 0) / speeds.length)
            : 0
        setAvgBusSpeedKmh(avg)

        const meters = Math.round(focus.distanceMeters || 0)
        setNearestDistanceMeters(meters)
        const label = focus.route_id
          ? `Línea ${focus.route_id} · Bus #${focus.mean_id}`
          : `Bus #${focus.mean_id}`
        setNearestBusLabel(label)

        if (focus.passedBoardingStop) {
          setProximityStatus("pasado")
        } else if (meters <= 400) {
          setProximityStatus("llegando")
        } else if (meters <= 1000) {
          setProximityStatus("cercano")
        } else {
          setProximityStatus("normal")
        }

        // Alertar solo si el bus aún sirve para abordar
        if (
          !focus.passedBoardingStop &&
          meters <= 1000 &&
          approachAlertRef.current !== `${focus.mean_id}:in`
        ) {
          approachAlertRef.current = `${focus.mean_id}:in`
          speak(
            meters <= 400
              ? `${label} llegando, a ${meters} metros.`
              : `${label} acercándose, a ${meters} metros.`,
            { force: true }
          )
        } else if (focus.passedBoardingStop) {
          approachAlertRef.current = `${focus.mean_id}:passed`
        } else if (meters > 1000) {
          approachAlertRef.current = `${focus.mean_id}:out`
        }
      }
      return
    }

    if (buses.length > 0) {
      setNearestDistanceMeters(350)
      setProximityStatus("llegando")
      setNearestBusLabel(null)
      setAvgBusSpeedKmh(null)
      setClosestBuses([])
    }
  }, [
    user,
    realBuses,
    buses,
    useRealData,
    speak,
    nearbyStops,
    selectedBoardingStopId,
    tripDestination,
    tripBusFilter,
    needsAccessibility,
  ])

  // Reloj en vivo
  useEffect(() => {
    const update = () =>
      setClock(
        new Date().toLocaleTimeString("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      )
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])

  // Bucle de simulación GPS en tiempo real
  useEffect(() => {
    const interval = setInterval(() => {
      setBuses((prev) =>
        prev.map((bus) => {
          const next: Bus = { ...bus }

          if (next.dwellTicks > 0) {
            next.dwellTicks -= 1
          } else {
            next.progress += next.speedFactor
            if (next.progress >= 1) {
              next.progress = 0
              next.lastStopId = null
            }
            const { stop, distance } = nearestStopInfo(next.progress)
            if (distance < 0.012 && next.lastStopId !== stop.id) {
              next.dwellTicks = 2 + Math.floor(Math.random() * 3)
              next.lastStopId = stop.id
            }
          }

          const { status, speedKmh } = computeStatus(next)
          next.status = status
          next.speedKmh = speedKmh
          return next
        }),
      )
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Anuncios por voz para el bus seleccionado
  useEffect(() => {
    if (!selectedBusId) return

    if (useRealData) {
      const realBus = realBuses.find((rb) => rb.mean_id === selectedBusId || rb.id === selectedBusId)
      if (!realBus) return
      const statusKey = getRealBusStatusKey(realBus.velocidad)
      const prevStatus = lastStatusRef.current[realBus.mean_id]
      if (prevStatus !== statusKey) {
        lastStatusRef.current[realBus.mean_id] = statusKey
        const lineStr = realBus.route_id ? `, línea ${realBus.route_id}` : ""
        const message = `Bus ${realBus.mean_id}${lineStr}: ${STATUS_LABEL[statusKey]}.`
        speak(message)
      }
    } else {
      const bus = buses.find((b) => b.id === selectedBusId)
      if (!bus) return
      const prevStatus = lastStatusRef.current[bus.id]
      if (prevStatus !== bus.status) {
        lastStatusRef.current[bus.id] = bus.status
        const { stop } = nearestStopInfo(bus.progress)
        let message = `Bus ${bus.plate}, línea ${bus.line}: ${STATUS_LABEL[bus.status]}.`
        if (bus.status === "arrival") message = `Bus ${bus.plate} llegando a la parada ${stop.name}.`
        else if (bus.status === "near") message = `Bus ${bus.plate} se aproxima a ${stop.name}.`
        else if (bus.status === "stopped") message = `Bus ${bus.plate} detenido en ${stop.name}.`
        speak(message)
      }
    }
  }, [useRealData, realBuses, buses, selectedBusId, speak])

  const handleSelectBus = useCallback(
    (id: string) => {
      setSelectedBusId(id)

      if (useRealData) {
        const realBus = realBuses.find((rb) => rb.mean_id === id || rb.id === id)
        if (realBus) {
          const statusKey = getRealBusStatusKey(realBus.velocidad)
          const statusLabel = STATUS_LABEL[statusKey]
          const lineStr = realBus.route_id ? `, línea ${realBus.route_id}` : ""
          const speedStr = realBus.velocidad > 0 ? `${Math.round(realBus.velocidad)} kilómetros por hora` : "detenido"
          const message = `Seleccionado bus ${realBus.mean_id}${lineStr}. Estado: ${statusLabel}, velocidad ${speedStr}.`
          speak(message, { force: true })
          return
        }
      }

      const bus = buses.find((b) => b.id === id)
      if (bus) {
        const { stop } = nearestStopInfo(bus.progress)
        speak(
          `Seleccionado bus ${bus.plate}, línea ${bus.line}. Estado: ${STATUS_LABEL[bus.status]}. Próxima parada ${stop.name}.`,
          { force: true },
        )
      }
    },
    [useRealData, realBuses, buses, speak],
  )

  const handleTab = useCallback(
    (id: Tab) => {
      setActiveTab(id)
      if (voiceEnabled) {
        const label = TABS.find((t) => t.id === id)?.label ?? ""
        speak(label, { force: true })
      }
    },
    [voiceEnabled, speak],
  )

  const totalCount = useRealData ? realBuses.length : buses.length
  const activeMovingCount = useRealData
    ? realBuses.filter((b) => (b.velocidad || 0) > 0).length
    : buses.filter((b) => b.status !== "stopped").length

  const boardingForRoute =
    selectedBoardingStopId != null
      ? nearbyStops.find((x) => x.id === selectedBoardingStopId)
      : nearbyStops.find((s) => s.isBoardingRecommended) ||
        nearbyStops.find((s) => s.isBoardingSelected)
  const routeStartPoint = boardingForRoute
    ? { lat: boardingForRoute.latitud, lng: boardingForRoute.longitud }
    : user?.locationShared && user.lat != null && user.lng != null
      ? { lat: user.lat, lng: user.lng }
      : null

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-0 sm:p-6">
      {/* Marco tipo teléfono */}
      <div className="flex h-dvh w-full max-w-[420px] flex-col overflow-hidden bg-background sm:h-[860px] sm:rounded-[2.25rem] sm:border-8 sm:border-foreground/90 sm:shadow-2xl">
        {/* Encabezado */}
        <header className="shrink-0 border-b border-border bg-card px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                <BusIcon className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
              </span>
              <div>
                <h1 className="text-sm font-bold leading-tight text-card-foreground">GeoBus</h1>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Radio className="h-3 w-3 text-status-moving" aria-hidden="true" />
                  {activeMovingCount}/{totalCount} activos {useRealData ? "(BD Real)" : ""} · {clock}
                </p>
              </div>
            </div>

            {/* Controles de la barra superior: Voz, Alertas (Campanita) y Google Auth */}
            <div className="flex items-center gap-1.5">
              {/* Campanita de Alertas */}
              <button
                type="button"
                onClick={() => setIsAlertsModalOpen(true)}
                className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Alertas operativas (desvíos, retrasos, lluvia, feriados)"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white shadow">
                  3
                </span>
              </button>

              {/* Control de accesibilidad: emisión de sonidos por voz */}
              <button
                type="button"
                onClick={toggle}
                disabled={!voiceSupported}
                aria-pressed={voiceEnabled}
                aria-label={voiceEnabled ? "Desactivar anuncios por voz" : "Activar anuncios por voz"}
                className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                  voiceEnabled
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-muted"
                }`}
                title={
                  voiceSupported
                    ? "Anuncios por voz para personas con discapacidad visual"
                    : "Tu navegador no admite anuncios por voz"
                }
              >
                {voiceEnabled ? (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              {/* Botón Google Login / Perfil */}
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className={`flex h-9 w-9 items-center justify-center rounded-full border transition-all ${
                  user
                    ? "border-status-moving bg-status-moving/10 text-status-moving font-bold shadow-sm"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
                title={user ? `Conectado como ${user.name}` : "Iniciar sesión con Google"}
              >
                {user ? (
                  <UserCheck className="h-4 w-4" />
                ) : (
                  <UserIcon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Banner de Proximidad al Usuario (Google Auth & Ubicación) */}
          {user && user.locationShared && (
            <div className="mt-2.5 flex items-center justify-between rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-all animate-in fade-in">
              {proximityStatus === "llegando" ? (
                <div className="flex w-full items-center justify-between rounded-md bg-orange-500/15 border border-orange-500/40 px-2.5 py-1 text-orange-600">
                  <span className="flex items-center gap-1.5">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75"></span>
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500"></span>
                    </span>
                    {nearestBusLabel || "Bus"} a {nearestDistanceMeters}m:
                  </span>
                  <span className="rounded bg-orange-500 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white shadow-xs">
                    LLEGANDO
                  </span>
                </div>
              ) : proximityStatus === "cercano" ? (
                <div className="flex w-full items-center justify-between rounded-md bg-yellow-500/15 border border-yellow-500/40 px-2.5 py-1 text-yellow-700">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500"></span>
                    {nearestBusLabel || "Bus"} a {nearestDistanceMeters}m:
                  </span>
                  <span className="rounded bg-yellow-500 px-2 py-0.5 text-[10px] font-extrabold uppercase text-black shadow-xs">
                    ACERCÁNDOSE (≤1 km)
                  </span>
                </div>
              ) : proximityStatus === "pasado" ? (
                <div className="flex w-full items-center justify-between rounded-md bg-slate-500/10 border border-slate-400/40 px-2.5 py-1 text-slate-700">
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {nearestBusLabel || "Bus"} cercano, pero ya pasó tu parada
                  </span>
                  <span className="rounded bg-slate-500 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white shadow-xs">
                    NO SIRVE
                  </span>
                </div>
              ) : (
                <div className="flex w-full items-center justify-between rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 text-emerald-700">
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <MapPin className="h-3.5 w-3.5" />
                    GPS · {nearestBusLabel ? `${nearestBusLabel} a ` : "Bus a "}
                    {nearestDistanceMeters ? `${nearestDistanceMeters}m` : "—"}
                    {avgBusSpeedKmh != null ? ` · prom. ${avgBusSpeedKmh} km/h` : ""}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-600">NORMAL</span>
                </div>
              )}
            </div>
          )}
        </header>

        {/* Contenido */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeTab === "gps" && (
            <div className="flex flex-col gap-3 p-3">
              {/* ¿A dónde vas? — desplegable */}
              <TripPlanner
                empresas={empresas}
                selectedCodCatalogo={selectedCodCatalogo}
                setSelectedCodCatalogo={setSelectedCodCatalogo}
                userLocation={
                  user?.locationShared && user.lat != null && user.lng != null
                    ? { lat: user.lat, lng: user.lng }
                    : null
                }
                onUseGpsOrigin={handleShareLocation}
                onPlan={handlePlanTrip}
                planning={tripPlanning}
                expanded={tripFormOpen}
                onToggle={() => setTripFormOpen((v) => !v)}
                destinationSummary={tripDestination?.label || null}
                mapPickMode={mapPickMode}
                onRequestMapPick={(mode) => {
                  setMapPickMode(mode)
                  setTripFormOpen(true)
                  setAutoCenterNearby(false)
                  speak(
                    mode === "origin"
                      ? "Tocá el mapa para marcar el origen"
                      : "Tocá el mapa para marcar el destino",
                    { force: true }
                  )
                }}
                onCancelMapPick={() => setMapPickMode(null)}
                mapPickedPoint={mapPickedPoint}
                onMapPickedPointConsumed={() => setMapPickedPoint(null)}
                onDraftPlacesChange={handleDraftPlacesChange}
              />

              {/* Mapa siempre visible */}
              <div className="relative h-[min(42vh,360px)] min-h-[260px] shrink-0">
                {mapPickMode && (
                  <div className="absolute left-2 right-2 top-2 z-[600] flex items-center justify-between gap-2 rounded-lg border border-sky-500/50 bg-sky-500/95 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-md">
                    <span>
                      {mapPickMode === "origin"
                        ? "Marcá el origen en el mapa"
                        : "Marcá el destino en el mapa"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMapPickMode(null)}
                      className="rounded bg-white/20 px-2 py-0.5 font-bold hover:bg-white/30"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
                {useRealData ? (
                  <RealRouteMap
                    buses={closestBuses.length > 0 ? closestBuses : realBuses}
                    itineraries={realItineraries}
                    stops={realStops}
                    nearbyStops={nearbyStops}
                    destinationStops={destNearbyStops}
                    hideCompanyStops
                    destination={tripDestination}
                    routeStart={routeStartPoint}
                    tripRouteCoords={tripRouteCoords}
                    userLocation={
                      user?.locationShared && user.lat != null && user.lng != null
                        ? { lat: user.lat, lng: user.lng }
                        : null
                    }
                    autoCenterNearby={autoCenterNearby}
                    selectedBusId={selectedBusId}
                    onSelectBus={handleSelectBus}
                    onSelectNearbyStop={handleSelectBoardingStop}
                    onUserMapInteract={() => setAutoCenterNearby(false)}
                    mapPickMode={mapPickMode}
                    draftOrigin={draftOrigin}
                    draftDestination={draftDestination}
                    onMapPointPick={(lat, lng) => {
                      if (!mapPickMode) return
                      const place: TripPlace = {
                        id: `map:${lat.toFixed(5)},${lng.toFixed(5)}`,
                        label:
                          mapPickMode === "origin"
                            ? `Origen en mapa (${lat.toFixed(5)}, ${lng.toFixed(5)})`
                            : `Destino en mapa (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
                        lat,
                        lng,
                        tipo: "map_point",
                        fuente: "map",
                      }
                      setMapPickedPoint({ mode: mapPickMode, place })
                      if (mapPickMode === "origin") setDraftOrigin(place)
                      else setDraftDestination(place)
                      setMapPickMode(null)
                      setTripFormOpen(true)
                      speak(
                        mapPickMode === "origin"
                          ? "Origen marcado en el mapa"
                          : "Destino marcado en el mapa",
                        { force: true }
                      )
                    }}
                  />
                ) : (
                  <RouteMap
                    buses={buses}
                    selectedBusId={selectedBusId}
                    onSelectBus={handleSelectBus}
                  />
                )}

                {!autoCenterNearby && useRealData && (
                  <button
                    type="button"
                    onClick={() => setAutoCenterNearby(true)}
                    className="absolute bottom-3 right-3 z-[500] rounded-lg border border-border bg-background/95 px-2.5 py-1.5 text-[11px] font-semibold text-foreground shadow-md backdrop-blur hover:bg-muted"
                  >
                    Recentrar
                  </button>
                )}

                <div className="absolute bottom-2 left-2 z-[400] flex flex-col gap-1 rounded-md bg-background/85 p-1.5 text-[10px] pointer-events-none shadow-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-status-moving" aria-hidden="true" />
                    <span className="font-medium text-foreground">En movimiento</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
                    <span className="font-medium text-foreground">Parada recomendada</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-teal-700" aria-hidden="true" />
                    <span className="font-medium text-foreground">Parada elegida</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-600" aria-hidden="true" />
                    <span className="font-medium text-foreground">Bajada (destino)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-1 w-4 rounded-sm bg-blue-600" aria-hidden="true" />
                    <span className="font-medium text-foreground">Itinerario al destino</span>
                  </div>
                </div>
              </div>

              {/* Buses en movimiento — justo debajo del mapa */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    {tripBusFilter
                      ? `Buses de tu línea (${closestBuses.length || realBuses.length})`
                      : useRealData
                        ? `Líneas más cercanas (${closestBuses.length || 0})`
                        : "Buses en tiempo real"}
                  </h2>
                  {tripBusFilter && (
                    <button
                      type="button"
                      onClick={() => {
                        setTripBusFilter(null)
                        speak("Filtro de viaje desactivado", { force: true })
                      }}
                      className="text-[10px] font-semibold text-primary hover:underline"
                    >
                      Ver todos
                    </button>
                  )}
                </div>
                {tripBusFilter && (
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Solo la empresa/línea elegida, en movimiento o cerca de la parada recomendada
                    {tripBusFilter.lineas.length > 0 && (
                      <>
                        :{" "}
                        <span className="font-medium text-foreground">
                          L
                          {tripBusFilter.lineas
                            .filter((l) => /^[\d\-]+$/i.test(l) || /^[A-Z]?\d/i.test(l))
                            .slice(0, 6)
                            .join(", L") || tripBusFilter.lineas.slice(0, 4).join(", ")}
                        </span>
                      </>
                    )}
                  </p>
                )}
                {useRealData ? (
                  <RealBusList
                    buses={
                      closestBuses.length > 0
                        ? closestBuses
                        : realBuses.map((b) => ({ ...b }))
                    }
                    selectedBusId={selectedBusId}
                    onSelectBus={handleSelectBus}
                    onlyClosestLines={!tripBusFilter}
                    maxLines={tripBusFilter ? 8 : 3}
                    avgSpeedKmh={avgBusSpeedKmh}
                    userHasLocation={Boolean(user?.locationShared && user.lat && user.lng)}
                    preferAccessible={needsAccessibility}
                  />
                ) : (
                  <BusList buses={buses} selectedBusId={selectedBusId} onSelectBus={handleSelectBus} />
                )}
              </div>

              {/* Espacio publicitario */}
              <div className="flex h-20 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/50 text-muted-foreground">
                <span className="text-sm font-medium">Espacio publicitario</span>
              </div>

              {tripGuidance && (
                <div
                  className={`rounded-xl border px-3 py-2.5 text-xs shadow-sm ${
                    tripGuidance.mode === "walk_to_stop"
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-950"
                      : "border-emerald-500/50 bg-emerald-500/10 text-emerald-950"
                  }`}
                >
                        {tripGuidance.mode === "walk_to_stop" ? (
                    <>
                      <p className="font-bold">
                        {selectedBoardingStopId
                          ? `Parada recomendada #${
                              nearbyStops.find((s) => s.id === selectedBoardingStopId)?.rank ||
                              tripGuidance.boardingRanks[0] ||
                              "?"
                            }`
                          : "Elegí una parada oficial recomendada"}
                        {!selectedBoardingStopId && tripGuidance.boardingRanks.length > 0
                          ? `: #${tripGuidance.boardingRanks.join(" o #")}`
                          : ""}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug opacity-90">
                        {tripGuidance.targetStopName
                          ? `${tripGuidance.targetStopName}. `
                          : ""}
                        Tocá otra parada (#) en el mapa o en la lista para cambiar la recomendación.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-bold">Estás en la parada correcta</p>
                      <p className="mt-1 text-[11px] leading-snug opacity-90">
                        {tripGuidance.targetStopName
                          ? `#${tripGuidance.boardingRanks[0] || "?"} · ${tripGuidance.targetStopName}. `
                          : ""}
                        Ruta trazada hacia tu destino. Abajo están las empresas que pasan por esta parada.
                      </p>
                    </>
                  )}
                </div>
              )}

              {tripOptions.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                  <h3 className="mb-1 text-sm font-semibold text-foreground">
                    Opciones de viaje (hasta 3)
                  </h3>
                  <p className="mb-2 text-[10px] text-muted-foreground">
                    Primero directos (1 itinerario A→B). Luego transbordos más cortos.
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {tripOptions.map((opt) => {
                      const selected =
                        tripPlan?.rank === opt.rank &&
                        tripPlan?.type === opt.type &&
                        tripPlan?.legs[0]?.id_itinerario ===
                          opt.legs[0]?.id_itinerario
                      const title =
                        opt.type === "direct"
                          ? `Directo · ${
                              opt.legs[0]?.linea
                                ? `L${opt.legs[0].linea}`
                                : opt.legs[0]?.eot_nombre || "Itinerario"
                            }`
                          : `Transbordo · ${
                              opt.legs[0]?.linea
                                ? `L${opt.legs[0].linea}`
                                : opt.legs[0]?.eot_nombre || "?"
                            } → ${
                              opt.legs[1]?.linea
                                ? `L${opt.legs[1].linea}`
                                : opt.legs[1]?.eot_nombre || "?"
                            }`
                      const detail =
                        opt.type === "direct"
                          ? `${opt.legs[0]?.boarding.name} → ${opt.legs[0]?.alighting.name}`
                          : `Cambio en ${opt.transfer?.name || "punto C"}` +
                            (opt.transfer?.total_m != null
                              ? ` · ${Math.round(opt.transfer.total_m)} m (A→C→B)`
                              : "")
                      return (
                        <li key={`opt-${opt.rank}-${opt.type}-${opt.legs[0]?.id_itinerario}`}>
                          <button
                            type="button"
                            onClick={async () => {
                              setTripPlan(opt)
                              setTripSummary(formatTripPlanSummary(opt))
                              speak(formatTripPlanSummary(opt), { force: true })
                              const ids = [
                                ...new Set(
                                  opt.legs
                                    .map((l) => Number(l.id_itinerario))
                                    .filter((n) => Number.isFinite(n) && n > 0)
                                ),
                              ]
                              if (ids.length) {
                                try {
                                  const res = await fetch(
                                    apiUrl(`/api/itinerarios?ids=${ids.join(",")}`),
                                    { cache: "no-store" }
                                  )
                                  const data = await res.json()
                                  if (data?.success && Array.isArray(data.data)) {
                                    setRealItineraries(data.data)
                                    allItinerariesRef.current = data.data
                                  }
                                } catch {
                                  /* ignore */
                                }
                              }
                              const cats = [
                                ...new Set(
                                  opt.legs
                                    .map((l) => l.cod_catalogo)
                                    .filter((n) => Number.isFinite(n))
                                ),
                              ] as number[]
                              const lineas = [
                                ...new Set(
                                  opt.legs
                                    .map((l) => String(l.linea || "").trim())
                                    .filter(Boolean)
                                ),
                              ] as string[]
                              if (cats.length || lineas.length) {
                                setTripBusFilter({ catalogos: cats, lineas })
                              }
                            }}
                            className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                              selected
                                ? opt.type === "direct"
                                  ? "border-emerald-500/60 bg-emerald-500/15"
                                  : "border-violet-500/60 bg-violet-500/15"
                                : "border-border/70 bg-muted/40 hover:bg-muted"
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                                opt.type === "direct"
                                  ? "bg-emerald-600"
                                  : "bg-violet-600"
                              }`}
                            >
                              {opt.rank || "?"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="font-semibold text-foreground">
                                {title}
                              </span>
                              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                {detail}
                              </span>
                              <span className="mt-0.5 block text-[10px] font-medium text-muted-foreground">
                                {opt.type === "direct"
                                  ? "1 itinerario · sentido A→B"
                                  : "2 itinerarios · sentido A→C→B"}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {tripSummary && (
                <p className="rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-[11px] text-foreground">
                  {tripSummary}
                </p>
              )}

              {tripSuggestions.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">
                    {tripGuidance?.mode === "to_destination"
                      ? "Empresas que pasan por tu parada y llegan al destino"
                      : "Empresas que pasan por esas paradas y llegan cerca del destino"}
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {tripSuggestions.map((s: any) => (
                      <li key={s.cod_catalogo}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCodCatalogo(String(s.cod_catalogo))
                            speak(`Empresa ${s.eot_nombre} seleccionada`, { force: true })
                          }}
                          className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2 text-left text-xs hover:bg-muted"
                        >
                          <span className="min-w-0">
                            <span className="font-semibold text-foreground">{s.eot_nombre}</span>
                            <span className="mt-0.5 block text-[10px] text-muted-foreground">
                              Líneas: {(s.lineas || []).slice(0, 5).join(", ") || s.eot_linea || "—"}
                              {s.parada_ids_origen?.length
                                ? ` · Abordaje en ${s.parada_ids_origen.length} parada(s)`
                                : ""}
                            </span>
                          </span>
                          <span
                            className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              s.cubre_destino
                                ? "bg-emerald-500/20 text-emerald-800"
                                : "bg-amber-500/20 text-amber-800"
                            }`}
                          >
                            {s.cubre_destino ? "Llega al destino" : "Solo origen"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {destNearbyStops.length > 0 && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-3 shadow-sm">
                  <h3 className="mb-1 text-sm font-semibold text-foreground">
                    Paradas de bajada · {tripDestination?.label || "destino"}
                  </h3>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Marcadas en rojo (BAJADA). Sus líneas/empresas se usan para
                    filtrar las paradas de abordaje cerca de tu ubicación.
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {destNearbyStops.map((stop, idx) => (
                      <li
                        key={`dest-${stop.id}-${idx}`}
                        className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs ${
                          stop.isAlightingRecommended
                            ? "border-rose-500/50 bg-rose-500/10"
                            : "border-border/70 bg-muted/40"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white">
                            {stop.rank || idx + 1}
                          </span>
                          <span className="font-medium text-foreground">{stop.source_name}</span>
                          {stop.isAlightingRecommended && (
                            <span className="ml-1 text-[10px] font-bold text-rose-800">
                              · Bajá aquí
                            </span>
                          )}
                          {stop.lineasEmpresa && stop.lineasEmpresa.length > 0 && (
                            <span className="mt-0.5 block text-[10px] text-rose-800/90">
                              L{stop.lineasEmpresa.slice(0, 6).join(", L")}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-semibold text-rose-700">
                          {Math.round(stop.distancia_m)} m
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Selector de modo / empresa */}
              <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    Modo: {useRealData ? "🟢 BD Real (PostgreSQL)" : "🔵 Simulación"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setUseRealData(!useRealData)}
                    className="rounded bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Cambiar a {useRealData ? "Simulador" : "BD Real"}
                  </button>
                </div>

                {useRealData && (
                  <select
                    value={selectedCodCatalogo}
                    onChange={(e) => {
                      const val = e.target.value
                      setSelectedCodCatalogo(val)
                      setSelectedBusId(null)
                      setEmpresaPasaPorCercanas(null)
                      setMatchingItinerarioIds([])
                      const emp = empresas.find((item) => String(item.cod_catalogo) === val)
                      if (emp) {
                        speak(`Empresa ${emp.eot_nombre} seleccionada, Línea: ${emp.eot_linea}`, { force: true })
                      } else {
                        speak("Por favor, selecciona una empresa", { force: true })
                      }
                    }}
                    className="w-full rounded border border-input bg-background p-1.5 text-xs font-medium text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">-- Seleccionar empresa --</option>
                    {empresas.map((emp) => (
                      <option key={emp.eot_id} value={emp.cod_catalogo}>
                        {emp.eot_nombre} (Líneas: {emp.eot_linea})
                      </option>
                    ))}
                  </select>
                )}

                {useRealData && selectedCodCatalogo && (
                  <div className="mt-1">
                    {nearbyStops.length === 0 ? (
                      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800">
                        Iniciá el GPS o buscá un viaje para verificar paradas cercanas.
                      </p>
                    ) : empresaCercanasChecking ? (
                      <p className="text-[11px] text-muted-foreground">
                        Verificando si la empresa pasa por paradas cercanas…
                      </p>
                    ) : empresaPasaPorCercanas === false ? (
                      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          <strong>
                            {empresas.find((e) => String(e.cod_catalogo) === selectedCodCatalogo)?.eot_nombre ||
                              "Esta empresa"}
                          </strong>{" "}
                          no pasa por ninguna de las paradas oficiales cercanas a tu ubicación.
                          Probá otra empresa o ampliá el radio.
                        </span>
                      </div>
                    ) : empresaPasaPorCercanas === true ? (
                      <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-800">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          La empresa pasa por{" "}
                          <strong>
                            {nearbyStops.filter((s) => s.servedByEmpresa).length}
                          </strong>{" "}
                          parada(s) cercana(s).
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Paradas cercanas (geo-itinerarios) */}
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <MapPin className="h-4 w-4 text-amber-600" />
                    {tripDestination
                      ? showMoreStops
                        ? `Paradas cerca · ${tripDestination.label}`
                        : `Abordaje cerca tuyo → ${tripDestination.label}`
                      : "Paradas cerca de mí"}
                  </h2>
                  <span className="text-[10px] text-muted-foreground">
                    {boardingRouteLoading
                      ? "Actualizando recomendación…"
                      : tripDestination
                        ? showMoreStops
                          ? "Correctas + otras cercanas"
                          : "Solo paradas correctas (hasta 5)"
                        : isTrackingLocation
                          ? "GPS en vivo · tocá una parada"
                          : "Tocá una parada para elegir"}
                  </span>
                </div>

                <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="flex flex-col gap-1 text-[10px] font-medium text-muted-foreground">
                    Radio
                    <select
                      value={nearbyRadioM}
                      onChange={(e) => setNearbyRadioM(Number(e.target.value))}
                      className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                    >
                      <option value={300}>300 m</option>
                      <option value={800}>800 m</option>
                      <option value={1200}>1200 m</option>
                      <option value={2000}>2000 m</option>
                      <option value={3000}>3000 m</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] font-medium text-muted-foreground">
                    Top
                    <select
                      value={nearbyLimit}
                      onChange={(e) => setNearbyLimit(Number(e.target.value))}
                      className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                    >
                      <option value={1}>Top 1</option>
                      <option value={3}>Top 3</option>
                      <option value={5}>Top 5</option>
                      <option value={8}>Top 8</option>
                      <option value={12}>Top 12</option>
                    </select>
                  </label>
                  <label className="flex items-end gap-1.5 pb-1.5 text-[11px] text-foreground">
                    <input
                      type="checkbox"
                      checked={autoCenterNearby}
                      onChange={(e) => setAutoCenterNearby(e.target.checked)}
                      className="rounded border-input"
                    />
                    Auto-centrar
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (isTrackingLocation) {
                        stopLocationWatch()
                        speak("Seguimiento GPS detenido", { force: true })
                      } else {
                        handleShareLocation()
                      }
                    }}
                    className="rounded-lg bg-primary px-2 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
                  >
                    {isTrackingLocation ? "Detener GPS" : "Iniciar GPS"}
                  </button>
                </div>

                {tripDestination && (
                  <label className="mb-2 flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2 text-[11px] text-foreground">
                    <input
                      type="checkbox"
                      checked={showMoreStops}
                      onChange={(e) => {
                        const on = e.target.checked
                        setShowMoreStops(on)
                        showMoreStopsRef.current = on
                        if (on && nearbyLimit < 8) setNearbyLimit(8)
                        speak(
                          on
                            ? "Mostrando más paradas cercanas"
                            : "Solo paradas hacia el destino",
                          { force: true }
                        )
                        if (user?.lat != null && user?.lng != null) {
                          fetchNearbyStopsDebounced(user.lat, user.lng, true)
                        }
                      }}
                      className="mt-0.5 rounded border-input"
                    />
                    <span>
                      <span className="font-semibold">Más paradas</span>
                      <span className="block text-muted-foreground">
                        Incluir también las de sentido incorrecto u otras cercanas.
                        Por defecto solo se ven las correctas (hasta 5).
                      </span>
                    </span>
                  </label>
                )}

                {!user?.locationShared ? (
                  <p className="text-xs text-muted-foreground">
                    Iniciá sesión / compartí ubicación para ver paradas cercanas vía geo-itinerarios.
                  </p>
                ) : nearbyLoading && nearbyStops.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Buscando paradas cercanas…</p>
                ) : nearbyError ? (
                  <p className="text-xs text-destructive">{nearbyError}</p>
                ) : nearbyStops.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No hay paradas en el radio seleccionado.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {nearbyStops.map((stop, idx) => (
                      <li key={`${stop.id}-${idx}`}>
                        <button
                          type="button"
                          onClick={() => void handleSelectBoardingStop(stop)}
                          className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                            stop.isBoardingSelected
                              ? "border-teal-600/60 bg-teal-600/15 ring-1 ring-teal-600/40"
                              : stop.isBoardingRecommended
                                ? "border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25"
                                : stop.servedByEmpresa === true
                                  ? "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20"
                                  : stop.servedByEmpresa === false
                                    ? "border-border/70 bg-muted/30 opacity-80 hover:opacity-100"
                                    : "border-border/70 bg-muted/40 hover:bg-muted"
                          }`}
                        >
                          <span className="min-w-0">
                            <span
                              className={`mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                                stop.isBoardingSelected
                                  ? "bg-teal-700 text-white"
                                  : stop.isBoardingRecommended
                                    ? "bg-amber-500 text-gray-900"
                                    : stop.servedByEmpresa === true
                                      ? "bg-emerald-500 text-white"
                                      : stop.servedByEmpresa === false
                                        ? "bg-slate-400 text-white"
                                        : "bg-amber-500 text-gray-900"
                              }`}
                            >
                              {stop.rank || idx + 1}
                            </span>
                            <span className="font-medium text-foreground">{stop.source_name}</span>
                            {stop.isBoardingSelected && (
                              <span className="ml-1 text-[10px] font-bold text-teal-800">
                                · Elegida
                              </span>
                            )}
                            {!stop.isBoardingSelected && stop.isBoardingRecommended && (
                              <span className="ml-1 text-[10px] font-bold text-amber-800">
                                · Abordá aquí
                              </span>
                            )}
                            {tripDestination &&
                              !stop.isBoardingSelected &&
                              stop.isBoardingRecommended === false && (
                              <span className="ml-1 text-[10px] font-bold text-rose-700">
                                · Sentido incorrecto
                              </span>
                            )}
                            {stop.lineasEmpresa && stop.lineasEmpresa.length > 0 && (
                              <span className="ml-1 text-[10px] text-emerald-700">
                                · L{stop.lineasEmpresa.slice(0, 5).join(", L")}
                              </span>
                            )}
                            {stop.empresasAtStop && stop.empresasAtStop.length > 0 && (
                              <span className="ml-1 block text-[10px] text-muted-foreground">
                                {stop.empresasAtStop.slice(0, 2).join(" · ")}
                              </span>
                            )}
                          </span>
                          <span
                            className={`shrink-0 font-semibold ${
                              stop.isBoardingSelected
                                ? "text-teal-800"
                                : stop.isBoardingRecommended
                                  ? "text-amber-800"
                                  : stop.servedByEmpresa === true
                                    ? "text-emerald-700"
                                    : "text-amber-700"
                            }`}
                          >
                            {Math.round(stop.distancia_m)} m
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

            </div>
          )}
          {activeTab === "programacion" && (
            <div className="p-3">
              <SchedulePanel />
            </div>
          )}
          {activeTab === "itinerarios" && (
            <div className="p-3">
              <ItineraryPanel 
                onAnnounce={(msg) => speak(msg, { force: true })} 
                empresas={empresas}
                selectedCodCatalogo={selectedCodCatalogo}
                setSelectedCodCatalogo={setSelectedCodCatalogo}
              />
            </div>
          )}
          {activeTab === "paradas" && (
            <div className="p-3">
              <StopsPanel
                buses={buses}
                onAnnounceStop={(text) => speak(text, { force: true })}
                voiceEnabled={voiceEnabled}
                onAnnounce={(msg) => speak(msg, { force: true })}
                empresas={empresas}
                selectedCodCatalogo={selectedCodCatalogo}
                setSelectedCodCatalogo={setSelectedCodCatalogo}
              />
            </div>
          )}
          {activeTab === "contacto" && (
            <div className="p-3">
              <FeedbackPanel 
                userEmail={user?.email}
                userName={user?.name}
              />
            </div>
          )}
        </div>

        {/* Navegación inferior */}
        <nav
          role="tablist"
          aria-label="Secciones"
          className="grid shrink-0 grid-cols-5 border-t border-border bg-card"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                onClick={() => handleTab(tab.id)}
                className={`flex flex-col items-center gap-1 px-1 py-2.5 text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`flex h-8 w-12 items-center justify-center rounded-full transition-colors ${
                    active ? "bg-primary/10" : ""
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Modales de Autenticación Google y Alertas */}
      <GoogleAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        user={user}
        onLogin={(u) => {
          setUser(u)
          setIsAuthModalOpen(false)
          handleShareLocation()
        }}
        onLogout={() => {
          stopLocationWatch()
          setNearbyStops([])
          setNearbyError(null)
          setEmpresaPasaPorCercanas(null)
          setMatchingItinerarioIds([])
          setUser(null)
          setNearestDistanceMeters(null)
          setProximityStatus(null)
          setIsAuthModalOpen(false)
        }}
        onShareLocation={handleShareLocation}
      />

      <AlertsModal
        isOpen={isAlertsModalOpen}
        onClose={() => setIsAlertsModalOpen(false)}
      />

      {/* Región viva para lectores de pantalla */}
      <p className="sr-only" role="status" aria-live="polite">
        {selectedBusId
          ? (() => {
              const b = buses.find((x) => x.id === selectedBusId)
              if (!b) return ""
              const { stop } = nearestStopInfo(b.progress)
              return `Bus ${b.plate}: ${STATUS_LABEL[b.status]}. Próxima parada ${stop.name}.`
            })()
          : ""}
      </p>
    </main>
  )
}
