import { NextRequest, NextResponse } from 'next/server'

const GEO_ITINERARIOS_URL =
  process.env.GEO_ITINERARIOS_URL || 'http://127.0.0.1:8020'

/**
 * Proxy → geo-itinerarios GET /paradas/{id}/lineas-vinculadas
 * Líneas/autobuses que pasan por una parada oficial.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const paradaId = Number(id)
    if (!Number.isFinite(paradaId)) {
      return NextResponse.json(
        { success: false, error: 'id de parada inválido' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const upstream = new URL(
      `/paradas/${paradaId}/lineas-vinculadas`,
      GEO_ITINERARIOS_URL
    )
    upstream.searchParams.set(
      'distinct_linea',
      searchParams.get('distinct_linea') || 'true'
    )
    upstream.searchParams.set(
      'solo_vigentes',
      searchParams.get('solo_vigentes') || 'true'
    )
    upstream.searchParams.set('limit', searchParams.get('limit') || '50')

    const res = await fetch(upstream.toString(), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    const data = await res.json().catch(() => null)

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            (data && (data.detail || data.error)) ||
            `geo-itinerarios HTTP ${res.status}`,
        },
        { status: res.status }
      )
    }

    return NextResponse.json({ success: true, ...data }, { status: 200 })
  } catch (error: any) {
    console.error('Error proxy lineas-vinculadas:', error)
    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          'No se pudo contactar geo-itinerarios (:8020).',
      },
      { status: 502 }
    )
  }
}
