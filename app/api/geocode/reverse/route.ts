import { NextRequest, NextResponse } from "next/server"
import { cidConfigError, poolCID } from "@/lib/db"

const NOMINATIM_TIMEOUT_MS = 4500

async function fetchNominatimReverse(lat: number, lng: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS)
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse")
    url.searchParams.set("lat", String(lat))
    url.searchParams.set("lon", String(lng))
    url.searchParams.set("format", "json")
    url.searchParams.set("addressdetails", "1")
    url.searchParams.set("zoom", "18")

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "GeoBus-MOPC/1.0 (prototipo_vmt; https://sistemas.mopc.gov.py/prototipo_vmt)",
      },
      cache: "no-store",
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch (err) {
    console.warn("Error en Nominatim Reverse:", err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Geocodificación inversa orientativa (Modo "¿Dónde estoy?" / Lazarillo).
 * Combina OpenStreetMap Nominatim con paradas oficiales de la BD CID.
 * GET /api/geocode/reverse?lat=-25.2865&lng=-57.608
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const lat = searchParams.get("lat")
    const lng = searchParams.get("lng")

    if (!lat || !lng) {
      return NextResponse.json(
        { success: false, error: "Parámetros lat y lng son obligatorios" },
        { status: 400 }
      )
    }

    const latNum = Number(lat)
    const lngNum = Number(lng)
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return NextResponse.json(
        { success: false, error: "Coordenadas inválidas" },
        { status: 400 }
      )
    }

    // 1. Obtener calle, barrio y ciudad vía Nominatim Reverse
    const geoData = await fetchNominatimReverse(latNum, lngNum)
    const addr = geoData?.address || {}
    const road = addr.road || addr.pedestrian || addr.street || null
    const neighbourhood = addr.neighbourhood || addr.suburb || addr.quarter || null
    const city = addr.city || addr.town || addr.municipality || "Asunción"

    // 2. Consultar parada oficial más cercana en PostGIS CID (radio 400m)
    let nearestStop: { id: number; nombre: string; distancia_m: number } | null = null
    const cfg = cidConfigError()
    if (!cfg) {
      try {
        const stopRes = await poolCID.query(
          `
          SELECT
            id,
            COALESCE(NULLIF(BTRIM(CAST(source_name AS text)), ''), CAST(source_id AS text), 'Parada Oficial') AS nombre,
            ROUND(
              ST_Distance(
                ST_Transform(geom, 4326)::geography,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
              )::numeric, 0
            ) AS distancia_m
          FROM geometria.paradas_oficiales
          WHERE geom IS NOT NULL
            AND ST_DWithin(
              ST_Transform(geom, 4326)::geography,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              400
            )
          ORDER BY distancia_m ASC
          LIMIT 1
          `,
          [lngNum, latNum]
        )

        if (stopRes.rows.length > 0) {
          nearestStop = {
            id: Number(stopRes.rows[0].id),
            nombre: String(stopRes.rows[0].nombre),
            distancia_m: Number(stopRes.rows[0].distancia_m),
          }
        }
      } catch (dbErr) {
        console.warn("Error consultando paradas para reverse geocode:", dbErr)
      }
    }

    // 3. Formatear descripción verbal para el lector de pantalla
    let fraseDescriptiva = ""
    if (road) {
      fraseDescriptiva = `Te encuentras sobre ${road}`
      if (neighbourhood) {
        fraseDescriptiva += `, barrio ${neighbourhood}`
      }
      if (city) {
        fraseDescriptiva += `, ${city}`
      }
      fraseDescriptiva += "."
    } else {
      fraseDescriptiva = `Te encuentras en ${city}.`
    }

    if (nearestStop) {
      if (nearestStop.distancia_m <= 40) {
        fraseDescriptiva += ` Estás justo en la parada oficial ${nearestStop.nombre}.`
      } else {
        fraseDescriptiva += ` Parada oficial más cercana: ${nearestStop.nombre}, a ${nearestStop.distancia_m} metros.`
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        frase: fraseDescriptiva,
        calle: road,
        barrio: neighbourhood,
        ciudad: city,
        display_name: geoData?.display_name || null,
        paradaCercana: nearestStop,
        coordenadas: { lat: latNum, lng: lngNum },
      },
    })
  } catch (err: any) {
    console.error("Error en reverse geocoding:", err)
    return NextResponse.json(
      { success: false, error: err.message || "Error al geolocalizar" },
      { status: 500 }
    )
  }
}
