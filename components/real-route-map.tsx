"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { clipItineraryGeoJSON, pickTripEndPoint } from "@/lib/clip-itinerary"

export type RealBus = {
  id: string
  mean_id: string
  route_id: string
  agency_id: string
  driver_id: string
  latitude: number
  longitude: number
  velocidad: number
  rumbo: number
  fecha_hora: string
}

export type RealItinerary = {
  id_itinerario: number
  ruta_hex: string
  observacion: string
  geojson: any
}

export type RealStop = {
  id: number
  id_itinerario: number
  orden: number
  nombre: string
  latitud: number
  longitud: number
  eot_nombre: string
  ruta_linea: string
  ruta_hex: string
}

export type NearbyStop = {
  id: number
  source_id?: string
  source_name: string
  distancia_m: number
  latitud: number
  longitud: number
  /** La empresa seleccionada tiene itinerario vinculado a esta parada */
  servedByEmpresa?: boolean
  lineasEmpresa?: string[]
  /** Empresas (EOT) que pasan por la parada */
  empresasAtStop?: string[]
  /** Parada recomendada para abordar hacia el destino */
  isBoardingRecommended?: boolean
  /** Parada elegida por el usuario para abordar */
  isBoardingSelected?: boolean
  /** Rumbo / sentido de la parada respecto al itinerario (0–360) */
  bearing?: number | null
  /** Parada recomendada para bajar cerca del destino */
  isAlightingRecommended?: boolean
  /** Índice visual 1..N en la lista de cercanas */
  rank?: number
}

type RealRouteMapProps = {
  buses: RealBus[]
  itineraries: RealItinerary[]
  stops?: RealStop[]
  nearbyStops?: NearbyStop[]
  /** Paradas oficiales cercanas al destino del viaje */
  destinationStops?: NearbyStop[]
  userLocation?: { lat: number; lng: number } | null
  destination?: { lat: number; lng: number; label?: string } | null
  /** Punto de abordaje (inicio del trazo azul) */
  routeStart?: { lat: number; lng: number } | null
  tripRouteCoords?: [number, number][] | null
  autoCenterNearby?: boolean
  /** Si true, no dibuja la capa de todas las paradas oficiales de la empresa */
  hideCompanyStops?: boolean
  selectedBusId: string | null
  onSelectBus: (id: string) => void
  onSelectNearbyStop?: (stop: NearbyStop) => void
  /** Usuario arrastró/zoomeó el mapa → pausar auto-centrado */
  onUserMapInteract?: () => void
  /** Modo marcar punto origen/destino */
  mapPickMode?: "origin" | "destination" | null
  onMapPointPick?: (lat: number, lng: number) => void
  /** Borradores de origen/destino antes de planificar */
  draftOrigin?: { lat: number; lng: number; label?: string } | null
  draftDestination?: { lat: number; lng: number; label?: string } | null
}

function getBusStatusColor(velocidad: number): { statusKey: string; statusLabel: string; color: string } {
  if (!velocidad || velocidad === 0) {
    return { statusKey: "stopped", statusLabel: "Detenido", color: "#ef4444" } // Rojo
  }
  if (velocidad <= 8) {
    return { statusKey: "arrival", statusLabel: "Llegando a parada", color: "#f97316" } // Naranja
  }
  if (velocidad <= 20) {
    return { statusKey: "near", statusLabel: "Cercano a parada", color: "#eab308" } // Amarillo
  }
  return { statusKey: "moving", statusLabel: "En movimiento", color: "#10b981" } // Verde
}

const createCustomIcon = (bus: RealBus, isSelected: boolean) => {
  const { color } = getBusStatusColor(bus.velocidad)
  const busLabel = bus.route_id ? `L-${bus.route_id}` : `BUS #${bus.mean_id}`
  const ring = isSelected
    ? "0 0 0 4px rgba(37,99,235,0.55), 0 4px 10px rgba(0,0,0,0.4)"
    : "0 4px 6px -1px rgba(0,0,0,0.3)"

  return L.divIcon({
    className: "custom-bus-real-icon",
    html: `
      <div style="
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transform: translate(-50%, -50%);
        cursor: pointer;
      ">
        <div style="
          position: absolute;
          width: ${isSelected ? "46px" : "28px"};
          height: ${isSelected ? "46px" : "28px"};
          border-radius: 9999px;
          background-color: ${isSelected ? "#2563eb" : color};
          opacity: ${isSelected ? "0.35" : "0.6"};
          animation: pulse 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
        "></div>

        <div style="
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          border: ${isSelected ? "3px solid #2563eb" : "2px solid #ffffff"};
          box-shadow: ${ring};
          background-color: ${color};
          width: ${isSelected ? "34px" : "24px"};
          height: ${isSelected ? "34px" : "24px"};
          z-index: 10;
        ">
          <svg xmlns="http://www.w3.org/2000/svg" width="${isSelected ? 17 : 13}" height="${isSelected ? 17 : 13}" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 6v6"/>
            <path d="M15 6v6"/>
            <path d="M2 12h19.6"/>
            <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/>
            <circle cx="7" cy="18" r="2"/>
            <path d="M9 18h5"/>
            <circle cx="16" cy="18" r="2"/>
          </svg>
        </div>

        <span style="
          margin-top: 2px;
          white-space: nowrap;
          border-radius: 4px;
          background: ${isSelected ? "#2563eb" : "rgba(15, 23, 42, 0.85)"};
          color: white;
          padding: 1px 5px;
          font-size: ${isSelected ? "10px" : "9px"};
          font-weight: 800;
          font-family: system-ui, -apple-system, sans-serif;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.25);
        ">
          ${isSelected ? "★ " : ""}${busLabel}
        </span>
        ${
          isSelected
            ? `<span style="
                margin-top: 2px;
                white-space: nowrap;
                border-radius: 9999px;
                background: #1d4ed8;
                color: #fff;
                padding: 1px 6px;
                font-size: 8px;
                font-weight: 800;
                letter-spacing: 0.02em;
                font-family: system-ui, -apple-system, sans-serif;
              ">SELECCIONADO</span>`
            : ""
        }
      </div>
    `,
    iconSize: [isSelected ? 56 : 36, isSelected ? 64 : 48],
    iconAnchor: [isSelected ? 28 : 18, isSelected ? 32 : 24],
  })
}

const createStopIcon = (orden: number) => {
  return L.divIcon({
    className: "custom-stop-real-icon",
    html: `
      <div style="
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform: translate(-50%, -50%);
      ">
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 9999px;
          background-color: #ffffff;
          border: 2.5px solid #2563eb;
          box-shadow: 0 2px 4px rgba(0,0,0,0.25);
          color: #2563eb;
          font-size: 10px;
          font-weight: 800;
          font-family: sans-serif;
        ">
          ${orden || 'P'}
        </div>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
}

const createNearbyStopIcon = (
  rank: number,
  served?: boolean | null,
  boarding?: boolean,
  selected?: boolean
) => {
  let bg = "#f59e0b"
  let fg = "#111827"
  let ring = "box-shadow: 0 2px 6px rgba(0,0,0,0.35);"
  let size = 24

  if (selected) {
    bg = "#0f766e"
    fg = "#ffffff"
    ring =
      "box-shadow: 0 0 0 4px rgba(15,118,110,0.45), 0 2px 8px rgba(0,0,0,0.4);"
    size = 30
  } else if (boarding) {
    bg = "#f59e0b"
    fg = "#111827"
    ring =
      "box-shadow: 0 0 0 3px rgba(245,158,11,0.55), 0 2px 6px rgba(0,0,0,0.35);"
    size = 28
  } else if (served === true) {
    bg = "#10b981"
    fg = "#ffffff"
  } else if (served === false) {
    bg = "#94a3b8"
    fg = "#ffffff"
  }

  return L.divIcon({
    className: "custom-nearby-stop-icon",
    html: `
      <div style="
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform: translate(-50%, -50%);
        cursor: pointer;
      ">
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          width: ${size}px;
          height: ${size}px;
          border-radius: 9999px;
          background-color: ${bg};
          border: 2px solid #ffffff;
          ${ring}
          color: ${fg};
          font-size: ${selected ? 13 : boarding ? 12 : 11}px;
          font-weight: 800;
          font-family: sans-serif;
        ">
          ${rank}
        </div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

const createDestinationStopIcon = (rank: number, recommended?: boolean) => {
  const bg = recommended ? "#e11d48" : "#fb7185"
  const ring = recommended
    ? "0 0 0 4px rgba(225,29,72,0.4), 0 2px 8px rgba(0,0,0,0.4)"
    : "0 0 0 2px rgba(225,29,72,0.25), 0 2px 6px rgba(0,0,0,0.3)"
  const size = recommended ? 30 : 26
  return L.divIcon({
    className: "custom-dest-stop-icon",
    html: `
      <div style="
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform: translate(-50%, -50%);
      ">
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          width: ${size}px;
          height: ${size}px;
          border-radius: 9999px;
          background-color: ${bg};
          border: 2px solid #ffffff;
          box-shadow: ${ring};
          color: #ffffff;
          font-size: 11px;
          font-weight: 800;
          font-family: sans-serif;
        ">
          ${rank}
        </div>
        <span style="
          margin-top: 2px;
          white-space: nowrap;
          border-radius: 4px;
          background: rgba(190,18,60,0.95);
          color: #fff;
          padding: 1px 4px;
          font-size: 8px;
          font-weight: 800;
          font-family: sans-serif;
        ">BAJADA</span>
      </div>
    `,
    iconSize: [size, size + 14],
    iconAnchor: [size / 2, size / 2],
  })
}

const createUserLocationIcon = () => {
  return L.divIcon({
    className: "custom-user-location-icon",
    html: `
      <div style="
        position: relative;
        width: 18px;
        height: 18px;
        transform: translate(-50%, -50%);
      ">
        <div style="
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: #3b82f6;
          opacity: 0.35;
          animation: pulse 1.6s ease-out infinite;
        "></div>
        <div style="
          position: absolute;
          top: 3px;
          left: 3px;
          width: 12px;
          height: 12px;
          border-radius: 9999px;
          background: #2563eb;
          border: 2px solid #ffffff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.35);
        "></div>
      </div>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

const createDestinationIcon = () => {
  return L.divIcon({
    className: "custom-destination-icon",
    html: `
      <div style="
        position: relative;
        transform: translate(-50%, -100%);
      ">
        <div style="
          width: 22px;
          height: 22px;
          border-radius: 9999px 9999px 9999px 4px;
          transform: rotate(-45deg);
          background: #dc2626;
          border: 2px solid #fff;
          box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        "></div>
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  })
}

export function RealRouteMap({
  buses,
  itineraries,
  stops,
  nearbyStops,
  destinationStops,
  userLocation,
  destination,
  routeStart,
  tripRouteCoords,
  autoCenterNearby = true,
  hideCompanyStops = true,
  selectedBusId,
  onSelectBus,
  onSelectNearbyStop,
  onUserMapInteract,
  mapPickMode = null,
  onMapPointPick,
  draftOrigin = null,
  draftDestination = null,
}: RealRouteMapProps) {
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<Record<string, L.Marker>>({})
  const stopsLayerRef = useRef<L.LayerGroup | null>(null)
  const nearbyLayerRef = useRef<L.LayerGroup | null>(null)
  const destStopsLayerRef = useRef<L.LayerGroup | null>(null)
  const userMarkerRef = useRef<L.Marker | null>(null)
  const destinationMarkerRef = useRef<L.Marker | null>(null)
  const draftOriginMarkerRef = useRef<L.Marker | null>(null)
  const draftDestMarkerRef = useRef<L.Marker | null>(null)
  const tripRouteLayerRef = useRef<L.Polyline | null>(null)
  const geojsonLayerRef = useRef<L.GeoJSON | null>(null)
  const lastNearbyFitKeyRef = useRef<string>("")
  const programmaticMoveRef = useRef(false)
  const lastFocusedBusRef = useRef<string | null>(null)
  const onUserMapInteractRef = useRef(onUserMapInteract)
  const onSelectNearbyStopRef = useRef(onSelectNearbyStop)
  const onMapPointPickRef = useRef(onMapPointPick)
  const mapPickModeRef = useRef(mapPickMode)

  useEffect(() => {
    onUserMapInteractRef.current = onUserMapInteract
  }, [onUserMapInteract])

  useEffect(() => {
    onSelectNearbyStopRef.current = onSelectNearbyStop
  }, [onSelectNearbyStop])

  useEffect(() => {
    onMapPointPickRef.current = onMapPointPick
  }, [onMapPointPick])

  useEffect(() => {
    mapPickModeRef.current = mapPickMode
    if (mapRef.current) {
      const el = mapRef.current.getContainer()
      el.style.cursor = mapPickMode ? "crosshair" : ""
    }
  }, [mapPickMode])

  // Inicializar mapa
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    // Coordenadas por defecto (Asunción / Paraguay)
    const map = L.map(mapContainerRef.current).setView([-25.3, -57.63], 12)

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)

    const notifyUserInteract = () => {
      if (programmaticMoveRef.current) return
      onUserMapInteractRef.current?.()
    }
    map.on("dragstart", notifyUserInteract)
    map.on("zoomstart", notifyUserInteract)
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (!mapPickModeRef.current) return
      onMapPointPickRef.current?.(e.latlng.lat, e.latlng.lng)
    })

    mapRef.current = map

    return () => {
      map.off("dragstart", notifyUserInteract)
      map.off("zoomstart", notifyUserInteract)
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Marcadores de borrador origen/destino (antes de planificar)
  useEffect(() => {
    if (!mapRef.current) return

    if (draftOriginMarkerRef.current) {
      mapRef.current.removeLayer(draftOriginMarkerRef.current)
      draftOriginMarkerRef.current = null
    }
    if (draftDestMarkerRef.current) {
      mapRef.current.removeLayer(draftDestMarkerRef.current)
      draftDestMarkerRef.current = null
    }

    if (draftOrigin?.lat != null && draftOrigin?.lng != null) {
      draftOriginMarkerRef.current = L.marker([draftOrigin.lat, draftOrigin.lng], {
        icon: L.divIcon({
          className: "draft-origin-icon",
          html: `<div style="width:14px;height:14px;border-radius:9999px;background:#0284c7;border:2px solid #fff;box-shadow:0 0 0 3px rgba(2,132,199,0.35)"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
        zIndexOffset: 1300,
      })
        .bindPopup(`<b>Origen</b><br/>${draftOrigin.label || "Punto en mapa"}`)
        .addTo(mapRef.current)
    }

    if (draftDestination?.lat != null && draftDestination?.lng != null) {
      draftDestMarkerRef.current = L.marker(
        [draftDestination.lat, draftDestination.lng],
        {
          icon: L.divIcon({
            className: "draft-dest-icon",
            html: `<div style="width:14px;height:14px;border-radius:9999px;background:#e11d48;border:2px solid #fff;box-shadow:0 0 0 3px rgba(225,29,72,0.35)"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
          zIndexOffset: 1300,
        }
      )
        .bindPopup(`<b>Destino</b><br/>${draftDestination.label || "Punto en mapa"}`)
        .addTo(mapRef.current)
    }
  }, [
    draftOrigin?.lat,
    draftOrigin?.lng,
    draftOrigin?.label,
    draftDestination?.lat,
    draftDestination?.lng,
    draftDestination?.label,
  ])

  const fitBoundsSafe = (bounds: L.LatLngBounds) => {
    if (!mapRef.current || !bounds.isValid()) return
    programmaticMoveRef.current = true
    mapRef.current.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 })
    mapRef.current.once("moveend", () => {
      programmaticMoveRef.current = false
    })
    // Fallback por si moveend no dispara
    window.setTimeout(() => {
      programmaticMoveRef.current = false
    }, 500)
  }

  // Renderizar geometrías de itinerarios (recortadas hasta destino si hay viaje)
  useEffect(() => {
    if (!mapRef.current) return

    if (geojsonLayerRef.current) {
      mapRef.current.removeLayer(geojsonLayerRef.current)
      geojsonLayerRef.current = null
    }

    if (itineraries && itineraries.length > 0) {
      const endPoint =
        destination?.lat != null && destination?.lng != null
          ? pickTripEndPoint(destination, destinationStops)
          : null
      const startPoint =
        routeStart?.lat != null && routeStart?.lng != null
          ? routeStart
          : userLocation?.lat != null && userLocation?.lng != null
            ? userLocation
            : null

      const geojsonFeatures = itineraries
        .filter((it) => it.geojson)
        .map((it) => {
          const geometry =
            endPoint != null
              ? clipItineraryGeoJSON(it.geojson, startPoint, endPoint)
              : it.geojson
          return {
            type: "Feature" as const,
            properties: {
              id: it.id_itinerario,
              ruta: it.ruta_hex,
              obs: it.observacion,
              clipped: Boolean(endPoint),
            },
            geometry,
          }
        })
        .filter((f) => f.geometry)

      const layer = L.geoJSON(geojsonFeatures as any, {
        style: {
          color: "#2563eb",
          weight: 4,
          opacity: 0.85,
        },
        onEachFeature: (feature, featureLayer) => {
          if (feature.properties) {
            const clippedNote = feature.properties.clipped
              ? "<br/><i>Tramo hasta parada/destino</i>"
              : ""
            featureLayer.bindPopup(
              `<b>Itinerario Hex: ${feature.properties.ruta}</b><br/>${feature.properties.obs || ""}${clippedNote}`
            )
          }
        },
      }).addTo(mapRef.current)

      geojsonLayerRef.current = layer

      // Sin viaje activo, encuadrar itinerarios completos
      if (!endPoint && !userLocation && !(nearbyStops && nearbyStops.length > 0)) {
        try {
          const bounds = layer.getBounds()
          if (bounds.isValid()) {
            fitBoundsSafe(bounds)
          }
        } catch (e) {
          console.error("Error ajustando limites del mapa:", e)
        }
      }
    }
  }, [
    itineraries,
    destination?.lat,
    destination?.lng,
    routeStart?.lat,
    routeStart?.lng,
    userLocation?.lat,
    userLocation?.lng,
    destinationStops
      ?.map((s) => `${s.id}:${s.latitud?.toFixed(5)}:${s.longitud?.toFixed(5)}`)
      .join("|") ?? "",
  ])

  // Renderizar paradas oficiales de la empresa (opcional; por defecto ocultas)
  useEffect(() => {
    if (!mapRef.current) return

    if (stopsLayerRef.current) {
      mapRef.current.removeLayer(stopsLayerRef.current)
      stopsLayerRef.current = null
    }

    if (hideCompanyStops) return

    if (stops && stops.length > 0) {
      const group = L.layerGroup()
      stops.forEach((stop) => {
        if (!stop.latitud || !stop.longitud) return
        const icon = createStopIcon(stop.orden)
        const marker = L.marker([stop.latitud, stop.longitud], { icon })
          .bindPopup(`
            <div style="font-family: sans-serif; font-size: 12px; padding: 2px;">
              <b style="color: #2563eb; font-size: 13px;">Parada ${stop.orden}: ${stop.nombre}</b><br/>
              <b>Empresa:</b> ${stop.eot_nombre || 'N/D'}<br/>
              <b>Línea/Ruta:</b> ${stop.ruta_linea || stop.ruta_hex || 'N/D'}<br/>
              <b>ID Parada:</b> #${stop.id}<br/>
            </div>
          `)
        group.addLayer(marker)
      })

      group.addTo(mapRef.current)
      stopsLayerRef.current = group
    }
  }, [stops, hideCompanyStops])

  // Marcador de ubicación del usuario (solo mueve pin; no recentra el mapa)
  useEffect(() => {
    if (!mapRef.current) return

    if (!userLocation?.lat || !userLocation?.lng) {
      if (userMarkerRef.current) {
        mapRef.current.removeLayer(userMarkerRef.current)
        userMarkerRef.current = null
      }
      return
    }

    const latlng: L.LatLngExpression = [userLocation.lat, userLocation.lng]
    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng(latlng)
    } else {
      userMarkerRef.current = L.marker(latlng, {
        icon: createUserLocationIcon(),
        zIndexOffset: 1000,
      })
        .bindPopup("<b>Mi ubicación</b>")
        .addTo(mapRef.current)
    }
  }, [userLocation?.lat, userLocation?.lng])

  // Paradas cercanas + auto-centrado solo cuando cambia el contexto del viaje
  const nearbyIdentityKey =
    nearbyStops
      ?.map(
        (s) =>
          `${s.id}:${s.rank || 0}:${s.isBoardingSelected ? 1 : 0}:${s.isBoardingRecommended ? 1 : 0}:${s.servedByEmpresa === true ? 1 : s.servedByEmpresa === false ? 0 : "x"}:${(s.lineasEmpresa || []).slice(0, 8).join("/")}:${s.latitud?.toFixed(5)}:${s.longitud?.toFixed(5)}`
      )
      .join("|") ?? ""
  const tripRouteKey = tripRouteCoords?.length
    ? `${tripRouteCoords.length}:${tripRouteCoords[0]?.[0]?.toFixed(4)}:${tripRouteCoords[tripRouteCoords.length - 1]?.[1]?.toFixed(4)}`
    : "0"
  const destStopsIdentity =
    destinationStops
      ?.map(
        (s) =>
          `${s.id}:${s.rank || 0}:${s.isAlightingRecommended ? 1 : 0}:${(s.lineasEmpresa || []).slice(0, 6).join("/")}:${s.latitud?.toFixed(5)}:${s.longitud?.toFixed(5)}`
      )
      .join("|") ?? ""

  useEffect(() => {
    if (!mapRef.current) return

    if (nearbyLayerRef.current) {
      mapRef.current.removeLayer(nearbyLayerRef.current)
      nearbyLayerRef.current = null
    }

    const bounds = L.latLngBounds([])

    if (userLocation?.lat && userLocation?.lng) {
      bounds.extend([userLocation.lat, userLocation.lng])
    }

    if (destination?.lat && destination?.lng) {
      bounds.extend([destination.lat, destination.lng])
    }

    if (destinationStops && destinationStops.length > 0) {
      destinationStops.forEach((s) => {
        if (s.latitud && s.longitud) bounds.extend([s.latitud, s.longitud])
      })
    }

    if (tripRouteCoords && tripRouteCoords.length > 1) {
      tripRouteCoords.forEach((c) => bounds.extend(c))
    }

    if (nearbyStops && nearbyStops.length > 0) {
      const group = L.layerGroup()
      nearbyStops.forEach((stop, idx) => {
        if (!stop.latitud || !stop.longitud) return
        const rank = stop.rank || idx + 1
        const served =
          typeof stop.servedByEmpresa === "boolean" ? stop.servedByEmpresa : null
        const boarding = Boolean(stop.isBoardingRecommended)
        const selected = Boolean(stop.isBoardingSelected)
        const servedLabel = selected
          ? "Parada elegida para abordar"
          : boarding
            ? "Parada recomendada para abordar"
            : served === true
              ? "Esta empresa SÍ pasa por aquí"
              : served === false
                ? "Esta empresa NO pasa por aquí"
                : "Tocá para elegir esta parada"
        const lineas =
          stop.lineasEmpresa && stop.lineasEmpresa.length > 0
            ? stop.lineasEmpresa.join(", ")
            : "—"
        const empresas =
          stop.empresasAtStop && stop.empresasAtStop.length > 0
            ? stop.empresasAtStop.slice(0, 4).join(", ")
            : ""
        const marker = L.marker([stop.latitud, stop.longitud], {
          icon: createNearbyStopIcon(rank, served, boarding, selected),
          zIndexOffset: selected ? 1200 : boarding ? 900 : served === true ? 800 : 500,
        }).bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px; padding: 2px; min-width: 160px;">
            <b style="color: ${selected ? "#0f766e" : boarding ? "#b45309" : served === true ? "#059669" : "#b45309"};">
              Parada #${rank}${selected ? " · Elegida" : boarding ? " · Recomendada" : ""}
            </b><br/>
            <b>Nombre:</b> ${stop.source_name}<br/>
            <b>Distancia:</b> ${Math.round(stop.distancia_m)} m<br/>
            <b>ID:</b> #${stop.id}<br/>
            <b>Estado:</b> ${servedLabel}<br/>
            <b>Líneas:</b> ${lineas}<br/>
            ${empresas ? `<b>Empresas:</b> ${empresas}<br/>` : ""}
            <button type="button" data-stop-id="${stop.id}" style="
              margin-top: 8px;
              width: 100%;
              padding: 6px 8px;
              border: none;
              border-radius: 8px;
              background: ${selected ? "#0f766e" : "#2563eb"};
              color: #fff;
              font-weight: 700;
              font-size: 11px;
              cursor: pointer;
            ">${selected ? "Parada seleccionada ✓" : "Elegir esta parada"}</button>
          </div>
        `)

        marker.on("click", () => {
          onSelectNearbyStopRef.current?.(stop)
        })
        marker.on("popupopen", () => {
          const btn = document.querySelector(
            `button[data-stop-id="${stop.id}"]`
          ) as HTMLButtonElement | null
          if (!btn) return
          btn.onclick = (e) => {
            e.preventDefault()
            e.stopPropagation()
            onSelectNearbyStopRef.current?.(stop)
          }
        })

        group.addLayer(marker)
        bounds.extend([stop.latitud, stop.longitud])
      })
      group.addTo(mapRef.current)
      nearbyLayerRef.current = group
    }

    // Solo recentrar ante cambios de viaje/paradas, NO ante cada tick del GPS
    if (autoCenterNearby && bounds.isValid()) {
      const fitKey = [
        destination?.lat?.toFixed(4) ?? "",
        destination?.lng?.toFixed(4) ?? "",
        nearbyIdentityKey,
        destStopsIdentity,
        tripRouteKey,
        userLocation?.lat != null ? "gps" : "nogps",
      ].join("|")

      if (fitKey !== lastNearbyFitKeyRef.current) {
        lastNearbyFitKeyRef.current = fitKey
        fitBoundsSafe(bounds)
      }
    }
  }, [
    nearbyIdentityKey,
    tripRouteKey,
    destStopsIdentity,
    autoCenterNearby,
    destination?.lat,
    destination?.lng,
    userLocation?.lat != null && userLocation?.lng != null,
  ])

  // Si el usuario reactiva "Auto-centrar", forzar un recenter
  useEffect(() => {
    if (!autoCenterNearby) {
      lastNearbyFitKeyRef.current = ""
    }
  }, [autoCenterNearby])

  // Destino del viaje + trazo OSRM (si hay) + paradas oficiales cerca del destino
  useEffect(() => {
    if (!mapRef.current) return

    if (destinationMarkerRef.current) {
      mapRef.current.removeLayer(destinationMarkerRef.current)
      destinationMarkerRef.current = null
    }
    if (tripRouteLayerRef.current) {
      mapRef.current.removeLayer(tripRouteLayerRef.current)
      tripRouteLayerRef.current = null
    }
    if (destStopsLayerRef.current) {
      mapRef.current.removeLayer(destStopsLayerRef.current)
      destStopsLayerRef.current = null
    }

    if (destination?.lat && destination?.lng) {
      destinationMarkerRef.current = L.marker([destination.lat, destination.lng], {
        icon: createDestinationIcon(),
        zIndexOffset: 1100,
      })
        .bindPopup(`<b>Destino</b><br/>${destination.label || "Seleccionado"}`)
        .addTo(mapRef.current)
    }

    if (destinationStops && destinationStops.length > 0) {
      const group = L.layerGroup()
      destinationStops.forEach((stop, idx) => {
        if (!stop.latitud || !stop.longitud) return
        const rank = stop.rank || idx + 1
        const recommended = Boolean(stop.isAlightingRecommended)
        const lineas =
          stop.lineasEmpresa && stop.lineasEmpresa.length > 0
            ? stop.lineasEmpresa.join(", ")
            : "—"
        const empresas =
          stop.empresasAtStop && stop.empresasAtStop.length > 0
            ? stop.empresasAtStop.slice(0, 4).join(", ")
            : ""
        const marker = L.marker([stop.latitud, stop.longitud], {
          icon: createDestinationStopIcon(rank, recommended),
          zIndexOffset: recommended ? 1050 : 950,
        }).bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px; padding: 2px; min-width: 160px;">
            <b style="color:#e11d48;">Parada de bajada #${rank}</b>
            ${recommended ? ' · <span style="color:#be123c;font-weight:800;">Recomendada</span>' : ""}<br/>
            <b>Nombre:</b> ${stop.source_name}<br/>
            <b>Líneas:</b> ${lineas}<br/>
            ${empresas ? `<b>Empresas:</b> ${empresas}<br/>` : ""}
            <b>Distancia al destino:</b> ${Math.round(stop.distancia_m)} m<br/>
            <b>ID:</b> #${stop.id}<br/>
            <i>Cerca de ${destination?.label || "tu destino"}</i>
          </div>
        `)
        group.addLayer(marker)
      })
      group.addTo(mapRef.current)
      destStopsLayerRef.current = group
    }

    if (tripRouteCoords && tripRouteCoords.length > 1) {
      tripRouteLayerRef.current = L.polyline(tripRouteCoords, {
        color: "#0f766e",
        weight: 5,
        opacity: 0.9,
      }).addTo(mapRef.current)
    }
  }, [
    destination?.lat,
    destination?.lng,
    destination?.label,
    tripRouteKey,
    destStopsIdentity,
  ])

  // Actualizar marcadores de buses GPS reales
  useEffect(() => {
    if (!mapRef.current) return

    // Identificar los IDs de los buses en el nuevo array de buses
    const currentBusIds = new Set(buses.map((b) => b.mean_id))

    // Remover del mapa todos los marcadores que pertenecen a la empresa anterior o ya no existen
    Object.keys(markersRef.current).forEach((busId) => {
      if (!currentBusIds.has(busId)) {
        markersRef.current[busId].remove()
        delete markersRef.current[busId]
      }
    })

    buses.forEach((bus) => {
      if (!bus.latitude || !bus.longitude) return

      const isSelected = bus.mean_id === selectedBusId
      const icon = createCustomIcon(bus, isSelected)
      const { statusLabel, color } = getBusStatusColor(bus.velocidad)
      const lineaLabel = (bus as any).linea_label || bus.route_id || "N/A"
      const popupHtml = `
            <div style="font-family: sans-serif; font-size: 12px; padding: 2px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <b style="font-size: 14px; color: ${isSelected ? "#2563eb" : color};">
                  ${isSelected ? "★ " : ""}Bus #${bus.mean_id}
                </b>
                <span style="background-color: ${isSelected ? "#2563eb" : color}; color: white; border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: bold;">
                  ${isSelected ? "Seleccionado" : statusLabel}
                </span>
              </div>
              <b>Línea:</b> ${lineaLabel}<br/>
              <b>Agencia:</b> ${(bus as any).eot_nombre || bus.agency_id || "N/A"}<br/>
              <b>Chofer:</b> ${bus.driver_id || "N/A"}<br/>
              <b>Velocidad:</b> ${bus.velocidad || 0} km/h<br/>
              <b>Última actualización:</b> ${new Date(bus.fecha_hora).toLocaleTimeString()}<br/>
            </div>
          `

      if (markersRef.current[bus.mean_id]) {
        const marker = markersRef.current[bus.mean_id]
        marker.setLatLng([bus.latitude, bus.longitude])
        marker.setIcon(icon)
        marker.setPopupContent(popupHtml)
        marker.setZIndexOffset(isSelected ? 2000 : 600)
      } else {
        const marker = L.marker([bus.latitude, bus.longitude], {
          icon,
          zIndexOffset: isSelected ? 2000 : 600,
        })
          .addTo(mapRef.current!)
          .bindPopup(popupHtml)
          .on("click", () => onSelectBus(bus.mean_id))

        markersRef.current[bus.mean_id] = marker
      }
    })

    // Solo enfocar al cambiar la selección (no en cada refresh GPS)
    if (selectedBusId && selectedBusId !== lastFocusedBusRef.current) {
      const selectedMarker = markersRef.current[selectedBusId]
      if (selectedMarker && mapRef.current) {
        lastFocusedBusRef.current = selectedBusId
        programmaticMoveRef.current = true
        const target = selectedMarker.getLatLng()
        const currentZoom = mapRef.current.getZoom()
        mapRef.current.flyTo(target, Math.max(currentZoom, 15), { duration: 0.6 })
        selectedMarker.openPopup()
        mapRef.current.once("moveend", () => {
          programmaticMoveRef.current = false
        })
        window.setTimeout(() => {
          programmaticMoveRef.current = false
        }, 700)
      }
    } else if (!selectedBusId) {
      lastFocusedBusRef.current = null
    }
  }, [buses, selectedBusId, onSelectBus])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-card">
      <div ref={mapContainerRef} className="h-full w-full z-0" />
    </div>
  )
}
