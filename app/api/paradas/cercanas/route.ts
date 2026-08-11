import { NextRequest, NextResponse } from 'next/server'

const GEO_ITINERARIOS_URL =
  process.env.GEO_ITINERARIOS_URL || 'http://127.0.0.1:8020'

/**
 * Proxy hacia geo-itinerarios: GET /paradas/cercanas
 * Evita CORS y centraliza la URL del servicio PostGIS.
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

    const upstream = new URL('/paradas/cercanas', GEO_ITINERARIOS_URL)
    upstream.searchParams.set('lat', String(latNum))
    upstream.searchParams.set('lng', String(lngNum))
    upstream.searchParams.set('radio_m', searchParams.get('radio_m') || '1200')
    upstream.searchParams.set('limit', searchParams.get('limit') || '5')
    upstream.searchParams.set('fuente', searchParams.get('fuente') || 'all')

    const res = await fetch(upstream.toString(), {
      headers: { Accept: 'application/json' },
      // No cachear posiciones en vivo
      cache: 'no-store',
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            (data && (data.detail || data.error)) ||
            `geo-itinerarios respondió HTTP ${res.status}`,
        },
        { status: res.status }
      )
    }

    return NextResponse.json(data, { status: 200 })
  } catch (error: any) {
    console.error('Error proxy /api/paradas/cercanas:', error)
    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          'No se pudo contactar geo-itinerarios. ¿Está levantado en el puerto 8020?',
      },
      { status: 502 }
    )
  }
}
