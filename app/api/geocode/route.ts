import { NextRequest, NextResponse } from 'next/server'
import {
  AMA_CENTRAL_DISTRITOS,
  AMA_NOMINATIM_VIEWBOX,
  nominatimResultInAma,
  stripAccents,
} from '@/lib/ama'

const NOMINATIM_TIMEOUT_MS = 4500

async function fetchNominatim(url: string): Promise<{ ok: boolean; data: any; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        // Nominatim exige User-Agent identificable
        'User-Agent':
          'GeoBus-MOPC/1.0 (prototipo_vmt; https://sistemas.mopc.gov.py/prototipo_vmt)',
      },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) {
      return { ok: false, data: [], error: `Nominatim HTTP ${res.status}` }
    }
    const data = await res.json().catch(() => [])
    return { ok: true, data }
  } catch (err: any) {
    const msg =
      err?.name === 'AbortError'
        ? 'Nominatim timeout'
        : err?.message || 'Error de red hacia Nominatim'
    return { ok: false, data: [], error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Geocoding Nominatim limitado al Área Metropolitana de Asunción.
 * Si Nominatim no es alcanzable desde el servidor, responde 200 con results=[]
 * (no 502) para no romper la búsqueda local de paradas/lugares.
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

    const qNorm = stripAccents(q)
    const normalizedIntersections = q
      .replace(/\s+(?:esquina|esq\.?|con)\s+/gi, ' & ')
      .replace(/\s+y\s+/gi, ' & ')
      .trim()

    const targetQuery = normalizedIntersections.length > 0 ? normalizedIntersections : q

    const scopedQuery =
      qNorm.includes('asuncion') ||
      qNorm.includes('paraguay') ||
      AMA_CENTRAL_DISTRITOS.some((d) => qNorm.includes(d))
        ? targetQuery
        : `${targetQuery}, Asunción`

    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', scopedQuery)
    url.searchParams.set('format', 'json')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('limit', String(Math.min(limit * 3, 20)))
    url.searchParams.set('countrycodes', 'py')
    url.searchParams.set('viewbox', AMA_NOMINATIM_VIEWBOX)
    url.searchParams.set('bounded', '1')

    let upstream = await fetchNominatim(url.toString())
    let data = upstream.data

    // Fallback: sin bounded o con query original si la normalización no arrojó resultados
    if (upstream.ok && (!Array.isArray(data) || data.length === 0)) {
      const fallbackQuery =
        targetQuery !== q
          ? (qNorm.includes('asuncion') ? q : `${q}, Asunción`)
          : scopedQuery

      const url2 = new URL('https://nominatim.openstreetmap.org/search')
      url2.searchParams.set('q', fallbackQuery)
      url2.searchParams.set('format', 'json')
      url2.searchParams.set('addressdetails', '1')
      url2.searchParams.set('limit', String(Math.min(limit * 3, 20)))
      url2.searchParams.set('countrycodes', 'py')
      url2.searchParams.set('viewbox', AMA_NOMINATIM_VIEWBOX)
      url2.searchParams.set('bounded', '0')
      upstream = await fetchNominatim(url2.toString())
      data = upstream.data
    }

    // Nominatim caído / sin salida a Internet: no romper UI con 502
    if (!upstream.ok) {
      console.warn('Geocode Nominatim no disponible:', upstream.error)
      return NextResponse.json({
        success: true,
        count: 0,
        results: [],
        ambito: 'ama',
        warning:
          'Geocoding externo no disponible. Usá resultados locales o marcá en el mapa.',
        detail: upstream.error,
      })
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
    // Soft-fail: la búsqueda local sigue usable
    return NextResponse.json({
      success: true,
      count: 0,
      results: [],
      ambito: 'ama',
      warning: error?.message || 'Error de geocoding',
    })
  }
}
