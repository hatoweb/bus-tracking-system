import { NextRequest, NextResponse } from 'next/server'
import {
  AMA_CENTRAL_DISTRITOS,
  AMA_NOMINATIM_VIEWBOX,
  nominatimResultInAma,
  stripAccents,
} from '@/lib/ama'

/**
 * Geocoding Nominatim limitado al Área Metropolitana de Asunción
 * (Asunción + distritos AMA de Central).
 *
 * GET ?q=Shopping+del+Sol&limit=5
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()
    const limit = Math.min(parseInt(searchParams.get('limit') || '6', 10) || 6, 10)

    if (q.length < 3) {
      return NextResponse.json({
        success: true,
        results: [],
        message: 'Escribí al menos 3 caracteres',
        ambito: 'ama',
      })
    }

    // Preferir la query tal cual; el viewbox+bounded limitan al AMA.
    // Solo agregamos "Asunción" si no hay contexto geográfico.
    const qNorm = stripAccents(q)
    const scopedQuery =
      qNorm.includes('asuncion') ||
      qNorm.includes('paraguay') ||
      AMA_CENTRAL_DISTRITOS.some((d) => qNorm.includes(d))
        ? q
        : `${q}, Asunción`

    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', scopedQuery)
    url.searchParams.set('format', 'json')
    url.searchParams.set('addressdetails', '1')
    // Pedimos de más y filtramos AMA
    url.searchParams.set('limit', String(Math.min(limit * 3, 20)))
    url.searchParams.set('countrycodes', 'py')
    url.searchParams.set('viewbox', AMA_NOMINATIM_VIEWBOX)
    url.searchParams.set('bounded', '1')

    let res: Response
    try {
      res = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'bus-tracking-system/1.0 (AMA Asuncion-Central; contacto@local)',
        },
        cache: 'no-store',
      })
    } catch (netErr: any) {
      return NextResponse.json(
        {
          success: false,
          error:
            'El servidor no pudo salir a Internet (Nominatim). Usá búsqueda local o marcar en el mapa.',
          detail: netErr?.message,
        },
        { status: 502 }
      )
    }

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `Nominatim HTTP ${res.status}` },
        { status: 502 }
      )
    }

    let data = await res.json()

    // Fallback: sin bounded, filtramos AMA a mano
    if (!Array.isArray(data) || data.length === 0) {
      const url2 = new URL('https://nominatim.openstreetmap.org/search')
      url2.searchParams.set('q', scopedQuery)
      url2.searchParams.set('format', 'json')
      url2.searchParams.set('addressdetails', '1')
      url2.searchParams.set('limit', String(Math.min(limit * 3, 20)))
      url2.searchParams.set('countrycodes', 'py')
      url2.searchParams.set('viewbox', AMA_NOMINATIM_VIEWBOX)
      url2.searchParams.set('bounded', '0')
      res = await fetch(url2.toString(), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'bus-tracking-system/1.0 (AMA Asuncion-Central; contacto@local)',
        },
        cache: 'no-store',
      })
      if (res.ok) data = await res.json()
    }
    const results = (Array.isArray(data) ? data : [])
      .filter((item: any) => nominatimResultInAma(item))
      .slice(0, limit)
      .map((item: any) => ({
        id: `osm:${item.place_id}`,
        label: item.display_name as string,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        tipo: 'geocode' as const,
        fuente: 'nominatim',
        clase: item.class,
        tipo_osm: item.type,
        ambito: 'ama',
      }))

    return NextResponse.json({
      success: true,
      count: results.length,
      results,
      ambito: 'ama',
      mensaje:
        results.length === 0
          ? 'Sin resultados en Asunción / Área Metropolitana (Central AMA).'
          : undefined,
    })
  } catch (error: any) {
    console.error('Error geocode:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Error de geocoding' },
      { status: 500 }
    )
  }
}
