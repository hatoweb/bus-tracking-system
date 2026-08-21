import { NextRequest, NextResponse } from 'next/server'
import { poolCID } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'
import { sqlItinerarioVigenteEnFecha } from '@/lib/sql-itinerario-vigente'

const GEO_ITINERARIOS_URL =
  process.env.GEO_ITINERARIOS_URL || 'http://host.docker.internal:8020'

function summarizeLineas(rows: any[], limit: number, distinct: boolean) {
  const lineasMin = new Map<string, any>()
  for (const r of rows) {
    const linea = String(r.linea ?? '').trim()
    const ramal = String(r.ramal ?? '').trim()
    if (!linea && !ramal) continue
    const lineaRamal = ramal ? `${linea} - ${ramal}` : linea
    const dist = r.distancia_m != null ? Number(r.distancia_m) : 1e12
    const prev = lineasMin.get(lineaRamal)
    if (!prev || dist < Number(prev.distancia_m || 1e12)) {
      lineasMin.set(lineaRamal, {
        eot_nombre: r.eot_nombre,
        cod_catalogo: r.cod_catalogo,
        id_eot_vmt_hex: r.id_eot_vmt_hex,
        linea,
        ramal,
        sentido: r.sentido,
        origen: r.origen,
        destino: r.destino,
        distancia_m: r.distancia_m,
        linea_ramal: lineaRamal,
      })
    }
  }
  let resumen = [...lineasMin.values()].sort(
    (a, b) =>
      Number(a.distancia_m || 1e12) - Number(b.distancia_m || 1e12) ||
      String(a.linea_ramal).localeCompare(String(b.linea_ramal))
  )
  if (distinct) resumen = resumen.slice(0, limit)
  return {
    lineas: resumen,
    lineas_solo: resumen.map((x) => x.linea_ramal),
    lineas_resumen: resumen,
    total: resumen.length,
  }
}

async function fetchFromCid(paradaId: number, limit: number, distinct: boolean) {
  const result = await poolCID.query(
    `
    SELECT
      e.eot_nombre,
      e.cod_catalogo,
      e.id_eot_vmt_hex,
      ${sqlNumeroLinea('ln')} AS linea,
      CAST(cr.ramal AS text) AS ramal,
      cr.sentido,
      cr.origen,
      cr.destino,
      ROUND(
        ST_Distance(
          ST_Transform(cr.geom, 4326)::geography,
          ST_Transform(p.geom, 4326)::geography
        )::numeric, 2
      ) AS distancia_m
    FROM geometria.itinerario_parada ip
    JOIN geometria.paradas_oficiales p ON p.id = ip.id_parada
    JOIN geometria.historico_itinerario hi ON hi.id_itinerario = ip.id_itinerario
    JOIN public.catalogo_rutas cr ON LOWER(TRIM(cr.ruta_hex)) = LOWER(TRIM(hi.ruta_hex))
    ${sqlJoinLineaVigente('cr', 'lrc', 'ln')}
    JOIN public.eots e ON e.cod_catalogo = cr.id_eot_catalogo
    WHERE ip.id_parada = $1
      AND e.permisionario = true
      AND ${sqlItinerarioVigenteEnFecha('hi')}
    ORDER BY distancia_m ASC NULLS LAST
    LIMIT $2
    `,
    [paradaId, Math.max(1, limit) * 20]
  )
  return summarizeLineas(result.rows, limit, distinct)
}

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
    const distinct = searchParams.get('distinct_linea') !== 'false'
    const limit = Number(searchParams.get('limit') || '50') || 50

    const upstream = new URL(
      `/paradas/${paradaId}/lineas-vinculadas`,
      GEO_ITINERARIOS_URL
    )
    upstream.searchParams.set('distinct_linea', String(distinct))
    upstream.searchParams.set(
      'solo_vigentes',
      searchParams.get('solo_vigentes') || 'true'
    )
    upstream.searchParams.set('limit', String(limit))

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2500)
      const res = await fetch(upstream.toString(), {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await res.json().catch(() => null)
      if (res.ok && data) {
        return NextResponse.json(
          { success: true, source: 'geo-itinerarios', ...data },
          { status: 200 }
        )
      }
    } catch (proxyErr) {
      console.warn(
        'geo-itinerarios no disponible, fallback CID lineas:',
        (proxyErr as Error)?.message
      )
    }

    const cid = await fetchFromCid(paradaId, limit, distinct)
    return NextResponse.json(
      {
        success: true,
        source: 'cid',
        mode: 'linked',
        query: { parada_id: paradaId, distinct_linea: distinct, limit },
        ...cid,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('Error lineas-vinculadas:', error)
    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          'No se pudieron cargar líneas (geo-itinerarios ni CID).',
      },
      { status: 502 }
    )
  }
}
