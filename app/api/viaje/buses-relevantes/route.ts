import { NextRequest, NextResponse } from 'next/server'
import { poolCID, poolGPS } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'
import {
  enrichBusesWithAccesibilidad,
  estimateEtaMinutes,
} from '@/lib/bus-accesibilidad'

function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Buses GPS en movimiento de las líneas/empresas relevantes al viaje.
 * GET ?cod_catalogos=14,18&lineas=23,23-24,30&solo_en_movimiento=true&lat=..&lng=..
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const catalogosRaw = searchParams.get('cod_catalogos') || ''
    const lineasRaw = searchParams.get('lineas') || ''
    const soloMovimiento = searchParams.get('solo_en_movimiento') !== 'false'
    const soloAccesibles = searchParams.get('solo_accesibles') === 'true'
    const userLat = searchParams.get('lat') ? Number(searchParams.get('lat')) : null
    const userLng = searchParams.get('lng') ? Number(searchParams.get('lng')) : null
    const minSpeed = Math.max(0, Number(searchParams.get('min_velocidad') || '1'))
    // Incluir buses detenidos si están a ≤ esta distancia (parada recomendada / usuario)
    const radioCercaniaM = Math.max(
      0,
      Number(searchParams.get('incluir_cercanos_m') || '0') || 0
    )

    const codCatalogos = catalogosRaw
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n))

    const lineas = lineasRaw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)

    if (codCatalogos.length === 0 && lineas.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        data: [],
        message: 'Indicá cod_catalogos y/o lineas',
      })
    }

    // Resolver agency_id + ruta_hex (+ etiqueta de línea) desde CID
    const filters: string[] = ['e.permisionario = true']
    const params: any[] = []

    if (codCatalogos.length > 0) {
      params.push(codCatalogos)
      filters.push(`e.cod_catalogo = ANY($${params.length}::int[])`)
    }
    if (lineas.length > 0) {
      params.push(lineas)
      filters.push(`${sqlNumeroLinea('ln')} = ANY($${params.length}::text[])`)
    }

    const mapRes = await poolCID.query(
      `
      SELECT DISTINCT
        e.cod_catalogo,
        e.eot_nombre,
        TRIM(e.id_eot_vmt_hex) AS agency_id,
        ${sqlNumeroLinea('ln')} AS linea,
        CAST(cr.ramal AS text) AS ramal,
        LOWER(TRIM(cr.ruta_hex)) AS ruta_hex
      FROM public.catalogo_rutas cr
      JOIN public.eots e ON e.cod_catalogo = cr.id_eot_catalogo
      ${sqlJoinLineaVigente('cr', 'lrc', 'ln')}
      WHERE ${filters.join(' AND ')}
        AND cr.ruta_hex IS NOT NULL
        AND TRIM(cr.ruta_hex) <> ''
        AND e.id_eot_vmt_hex IS NOT NULL
      `,
      params
    )

    if (mapRes.rows.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        data: [],
        message: 'No se encontraron rutas para esos filtros',
      })
    }

    const agencyIds = [
      ...new Set(mapRes.rows.map((r: any) => String(r.agency_id || '').trim()).filter(Boolean)),
    ]
    const rutaHexSet = new Set(
      mapRes.rows.map((r: any) => String(r.ruta_hex || '').toLowerCase().trim())
    )
    const lineaByRuta = new Map<string, { linea: string; ramal: string; eot_nombre: string; cod_catalogo: number }>()
    for (const r of mapRes.rows) {
      const key = String(r.ruta_hex).toLowerCase().trim()
      if (!lineaByRuta.has(key)) {
        lineaByRuta.set(key, {
          linea: r.linea,
          ramal: r.ramal,
          eot_nombre: r.eot_nombre,
          cod_catalogo: Number(r.cod_catalogo),
        })
      }
    }

    // GPS: últimos mensajes de esas agencias
    const gpsRes = await poolGPS.query(
      `
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
          AND TRIM(agency_id) = ANY($1::text[])
        ORDER BY id DESC
        LIMIT 4000
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (PARTITION BY mean_id ORDER BY fecha_hora DESC) AS rn
        FROM top_messages
      )
      SELECT *
      FROM ranked
      WHERE rn <= 2
      ORDER BY mean_id, rn ASC
      `,
      [agencyIds]
    )

    const byBus = new Map<string, any[]>()
    for (const row of gpsRes.rows) {
      if (!byBus.has(row.mean_id)) byBus.set(row.mean_id, [])
      byBus.get(row.mean_id)!.push(row)
    }

    const buses: any[] = []
    for (const rows of byBus.values()) {
      rows.sort(
        (a, b) =>
          new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime()
      )
      const latest = { ...rows[rows.length - 1] }
      const routeKey = String(latest.route_id || '').toLowerCase().trim()
      if (!rutaHexSet.has(routeKey)) continue

      let velocidad = Number(latest.velocidad) || 0
      if (velocidad > 120) velocidad = 0 // outlier GPS
      if (rows.length >= 2) {
        const prev = rows[0]
        const dt =
          (new Date(latest.fecha_hora).getTime() -
            new Date(prev.fecha_hora).getTime()) /
          1000
        if (dt > 0) {
          const dist = calculateDistanceMeters(
            parseFloat(prev.latitude),
            parseFloat(prev.longitude),
            parseFloat(latest.latitude),
            parseFloat(latest.longitude)
          )
          let calc = Math.round((dist / dt) * 3.6)
          if (calc > 120) calc = 0
          if ((!velocidad || velocidad === 0) && calc > 0) velocidad = calc
          latest.velocidad_calculada = calc
          latest.distancia_entre_puntos_m = Math.round(dist)
        }
      }

      const meta = lineaByRuta.get(routeKey)
      latest.velocidad = velocidad
      latest.linea = meta?.linea || null
      latest.ramal = meta?.ramal || null
      latest.eot_nombre = meta?.eot_nombre || null
      latest.cod_catalogo = meta?.cod_catalogo || null
      latest.linea_label = meta
        ? meta.ramal
          ? `${meta.linea}-${meta.ramal}`
          : meta.linea
        : latest.route_id

      let distanceMeters: number | undefined
      if (
        userLat != null &&
        userLng != null &&
        Number.isFinite(userLat) &&
        Number.isFinite(userLng)
      ) {
        distanceMeters = Math.round(
          calculateDistanceMeters(
            userLat,
            userLng,
            parseFloat(latest.latitude),
            parseFloat(latest.longitude)
          )
        )
        latest.distanceMeters = distanceMeters
      }

      const cerca =
        radioCercaniaM > 0 &&
        distanceMeters != null &&
        distanceMeters <= radioCercaniaM
      // En movimiento, o cercana a la parada/usuario (aunque esté detenida)
      if (soloMovimiento && velocidad < minSpeed && !cerca) continue

      buses.push(latest)
    }

    let enriched = await enrichBusesWithAccesibilidad(buses)
    enriched = enriched.map((b) => ({
      ...b,
      eta_minutos: estimateEtaMinutes(
        b.distanceMeters as number | undefined,
        Number(b.velocidad)
      ),
    }))

    if (soloAccesibles) {
      enriched = enriched.filter((b) => b.tiene_rampa === true)
    }

    enriched.sort(
      (a, b) =>
        (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
        (b.distanceMeters ?? Number.POSITIVE_INFINITY)
    )

    return NextResponse.json({
      success: true,
      count: enriched.length,
      solo_en_movimiento: soloMovimiento,
      solo_accesibles: soloAccesibles,
      agencies: agencyIds,
      rutas: [...rutaHexSet],
      lineas_filtradas: lineas,
      data: enriched,
    })
  } catch (error: any) {
    console.error('Error buses-relevantes:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
