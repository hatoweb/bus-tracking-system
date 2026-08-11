import { NextRequest, NextResponse } from 'next/server'
import { poolCID } from '@/lib/db'

const GEO_ITINERARIOS_URL =
  process.env.GEO_ITINERARIOS_URL || 'http://127.0.0.1:8020'

async function fetchFromGeoItinerarios(url: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(
        (data && (data.detail || data.error)) ||
          `geo-itinerarios HTTP ${res.status}`
      )
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

async function fetchFromCid(
  lat: number,
  lng: number,
  radioM: number,
  limit: number
) {
  const sqlWithBearing = `
    SELECT
      id,
      source_id,
      source_name,
      attrs,
      bearing,
      ROUND(
        ST_Distance(
          ST_Transform(geom, 4326)::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        )::numeric, 2
      ) AS distancia_m,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
    FROM geometria.paradas_oficiales
    WHERE geom IS NOT NULL
      AND ST_DWithin(
        ST_Transform(geom, 4326)::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )
    ORDER BY distancia_m ASC
    LIMIT $4
  `
  const sqlNoBearing = `
    SELECT
      id,
      source_id,
      source_name,
      attrs,
      ROUND(
        ST_Distance(
          ST_Transform(geom, 4326)::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        )::numeric, 2
      ) AS distancia_m,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
    FROM geometria.paradas_oficiales
    WHERE geom IS NOT NULL
      AND ST_DWithin(
        ST_Transform(geom, 4326)::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )
    ORDER BY distancia_m ASC
    LIMIT $4
  `

  let result
  try {
    result = await poolCID.query(sqlWithBearing, [lng, lat, radioM, limit])
  } catch {
    result = await poolCID.query(sqlNoBearing, [lng, lat, radioM, limit])
  }

  const features = result.rows.map((row: any) => {
    const geometry =
      typeof row.geometry === 'string' ? JSON.parse(row.geometry) : row.geometry
    const { geometry: _g, ...properties } = row
    if (properties.bearing != null) {
      const n = Number(properties.bearing)
      properties.bearing = Number.isFinite(n) ? n : null
    }
    return {
      type: 'Feature',
      geometry,
      properties,
    }
  })

  return {
    type: 'FeatureCollection',
    query: { lat, lng, radio_m: radioM, fuente: 'all', limit },
    total: features.length,
    features,
    source: 'cid',
  }
}

/**
 * Paradas cercanas: intenta geo-itinerarios y si no responde usa CID/PostGIS.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const lat = searchParams.get('lat')
    const lng = searchParams.get('lng')

    if (!lat || !lng) {
      return NextResponse.json(
        { success: false, error: 'Parámetros lat y lng son obligatorios' },
        { status: 400 }
      )
    }

    const latNum = Number(lat)
    const lngNum = Number(lng)
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return NextResponse.json(
        { success: false, error: 'lat/lng deben ser números válidos' },
        { status: 400 }
      )
    }

    const radioM = Number(searchParams.get('radio_m') || '1200')
    const limit = Number(searchParams.get('limit') || '5')

    const upstream = new URL('/paradas/cercanas', GEO_ITINERARIOS_URL)
    upstream.searchParams.set('lat', String(latNum))
    upstream.searchParams.set('lng', String(lngNum))
    upstream.searchParams.set('radio_m', String(radioM || 1200))
    upstream.searchParams.set('limit', String(limit || 5))
    upstream.searchParams.set('fuente', searchParams.get('fuente') || 'all')

    try {
      const data = await fetchFromGeoItinerarios(upstream.toString())
      return NextResponse.json({ ...data, source: 'geo-itinerarios' }, { status: 200 })
    } catch (proxyErr) {
      console.warn(
        'geo-itinerarios no disponible, fallback CID:',
        (proxyErr as Error)?.message
      )
    }

    const fallback = await fetchFromCid(
      latNum,
      lngNum,
      Number.isFinite(radioM) ? radioM : 1200,
      Number.isFinite(limit) ? limit : 5
    )
    return NextResponse.json(fallback, { status: 200 })
  } catch (error: any) {
    console.error('Error /api/paradas/cercanas:', error)
    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          'No se pudieron cargar paradas cercanas (geo-itinerarios ni CID).',
      },
      { status: 502 }
    )
  }
}
