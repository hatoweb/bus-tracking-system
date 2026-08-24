import { NextRequest, NextResponse } from 'next/server'
import { poolGPS, poolCID } from '@/lib/db'
import { estimateEtaMinutes } from '@/lib/bus-accesibilidad'
import { enrichBusesWithAccesibilidad } from '@/lib/bus-accesibilidad-server'

// Helper para distancia Haversine (en metros)
function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3 // Radio terrestre en metros
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Helper para Dirección de Movimiento / Bearing (0-360 grados)
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const φ1 = lat1 * rad
  const φ2 = lat2 * rad
  const Δλ = (lon2 - lon1) * rad

  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = Math.atan2(y, x)
  return Math.round(((θ * 180) / Math.PI + 360) % 360)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    let agencyId = searchParams.get('agency_id')
    const eotId = searchParams.get('eot_id')
    const codCatalogo = searchParams.get('cod_catalogo')
    const limitPerBus = parseInt(searchParams.get('limit_per_bus') || '2')

    const soloAccesibles = searchParams.get('solo_accesibles') === 'true'
    const userLat = searchParams.get('lat') ? Number(searchParams.get('lat')) : null
    const userLng = searchParams.get('lng') ? Number(searchParams.get('lng')) : null

    // Si se pasa eot_id o cod_catalogo, obtener id_eot_vmt_hex desde public.eots en BBDD_CID
    if (!agencyId && (eotId || codCatalogo)) {
      try {
        let eotQuery = `SELECT id_eot_vmt_hex FROM public.eots WHERE `
        const eotValues: any[] = []
        if (codCatalogo) {
          eotValues.push(parseInt(codCatalogo))
          eotQuery += `cod_catalogo = $1`
        } else if (eotId) {
          eotValues.push(parseInt(eotId))
          eotQuery += `eot_id = $1`
        }
        const eotRes = await poolCID.query(eotQuery, eotValues)
        if (eotRes.rows.length > 0 && eotRes.rows[0].id_eot_vmt_hex) {
          agencyId = eotRes.rows[0].id_eot_vmt_hex.trim()
        }
      } catch (eotErr) {
        console.error("Error buscando agency_id desde eots:", eotErr)
      }
    }

    // Si no hay empresa seleccionada, retornar lista vacía
    if (!agencyId) {
      return NextResponse.json({
        success: true,
        count: 0,
        agency_id: null,
        data: []
      })
    }

    const values: any[] = [agencyId.trim(), limitPerBus]

    const query = `
      WITH top_messages AS (
        SELECT 
          id,
          agency_id,
          mean_id,
          route_id,
          driver_id,
          latitude,
          longitude,
          velocidad,
          rumbo,
          fecha_hora
        FROM public.app_monitoreo_mensajeoperativo
        WHERE fecha_hora >= (NOW() - INTERVAL '30 minutes')
          AND fecha_hora <= NOW()
          AND latitude BETWEEN -28 AND -20
          AND longitude BETWEEN -62 AND -54
        ORDER BY id DESC
        LIMIT 1500
      ),
      filtered_messages AS (
        SELECT *
        FROM top_messages
        WHERE TRIM(agency_id) = TRIM($1)
      ),
      ranked_gps AS (
        SELECT 
          *,
          ROW_NUMBER() OVER (PARTITION BY mean_id ORDER BY fecha_hora DESC) as rn
        FROM filtered_messages
      )
      SELECT 
        id,
        agency_id,
        mean_id,
        route_id,
        driver_id,
        latitude,
        longitude,
        velocidad,
        rumbo,
        fecha_hora,
        rn
      FROM ranked_gps
      WHERE rn <= $2
      ORDER BY mean_id, rn ASC;
    `

    const result = await poolGPS.query(query, values)

    // Agrupar los últimos 2 puntos por bus (mean_id) para calcular distancia/tiempo y rumbo
    const groupedByBus = new Map<string, any[]>()
    result.rows.forEach((row) => {
      if (!groupedByBus.has(row.mean_id)) {
        groupedByBus.set(row.mean_id, [])
      }
      groupedByBus.get(row.mean_id)!.push(row)
    })

    const processedBuses = Array.from(groupedByBus.values()).map((rows) => {
      // Ordenar cronológicamente (anterior primero, más reciente al final)
      rows.sort((a, b) => new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime())

      const latest = { ...rows[rows.length - 1] }

      if (rows.length >= 2) {
        const prev = rows[0]
        const curr = latest

        const timePrev = new Date(prev.fecha_hora).getTime()
        const timeCurr = new Date(curr.fecha_hora).getTime()
        const dtSeconds = (timeCurr - timePrev) / 1000

        const distMeters = calculateDistanceMeters(
          parseFloat(prev.latitude),
          parseFloat(prev.longitude),
          parseFloat(curr.latitude),
          parseFloat(curr.longitude)
        )

        // Cálculo de velocidad = Distancia (km) / Tiempo (horas) -> (m/s) * 3.6
        let velocidadCalculada = 0
        if (dtSeconds > 0) {
          velocidadCalculada = Math.round((distMeters / dtSeconds) * 3.6)
        }

        // Cálculo de dirección de movimiento (bearing en grados 0-360)
        const rumboCalculado = calculateBearing(
          parseFloat(prev.latitude),
          parseFloat(prev.longitude),
          parseFloat(curr.latitude),
          parseFloat(curr.longitude)
        )

        latest.velocidad_calculada = velocidadCalculada
        latest.rumbo_calculado = rumboCalculado
        latest.distancia_entre_puntos_m = Math.round(distMeters)
        latest.tiempo_entre_puntos_s = Math.round(dtSeconds)
        latest.punto_anterior = {
          latitude: prev.latitude,
          longitude: prev.longitude,
          fecha_hora: prev.fecha_hora
        }

        // Si el sensor no registraba velocidad o velocidad = 0 pero hubo desplazamiento positivo
        if ((!latest.velocidad || latest.velocidad === 0) && velocidadCalculada > 0) {
          latest.velocidad = velocidadCalculada
        }
        if ((!latest.rumbo || latest.rumbo === 0) && rumboCalculado > 0) {
          latest.rumbo = rumboCalculado
        }
      } else {
        latest.velocidad_calculada = latest.velocidad || 0
        latest.rumbo_calculado = latest.rumbo || 0
      }

      return latest
    })

    let withAccess = await enrichBusesWithAccesibilidad(processedBuses)

    if (
      userLat != null &&
      userLng != null &&
      Number.isFinite(userLat) &&
      Number.isFinite(userLng)
    ) {
      withAccess = withAccess.map((b) => {
        const distanceMeters = Math.round(
          calculateDistanceMeters(
            userLat,
            userLng,
            parseFloat(String(b.latitude)),
            parseFloat(String(b.longitude))
          )
        )
        return {
          ...b,
          distanceMeters,
          eta_minutos: estimateEtaMinutes(distanceMeters, Number(b.velocidad)),
        }
      })
    }

    if (soloAccesibles) {
      withAccess = withAccess.filter((b) => b.tiene_rampa === true)
    }

    return NextResponse.json({ 
      success: true, 
      count: withAccess.length,
      agency_id: agencyId, 
      data: withAccess 
    })
  } catch (error: any) {
    console.error('Error fetching GPS buses:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
