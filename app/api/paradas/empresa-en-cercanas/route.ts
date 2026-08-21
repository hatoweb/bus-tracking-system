import { NextRequest, NextResponse } from 'next/server'
import { poolCID } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'
import { sqlItinerarioVigenteEnFecha } from '@/lib/sql-itinerario-vigente'

/**
 * Cruza paradas cercanas (IDs) con una empresa (cod_catalogo)
 * usando geometria.itinerario_parada + itinerarios vigentes por fecha.
 *
 * GET ?cod_catalogo=7&parada_ids=184,185,396
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const codCatalogoRaw = searchParams.get('cod_catalogo')
    const paradaIdsRaw = searchParams.get('parada_ids') || ''

    if (!codCatalogoRaw) {
      return NextResponse.json(
        { success: false, error: 'cod_catalogo es obligatorio' },
        { status: 400 }
      )
    }

    const codCatalogo = parseInt(codCatalogoRaw, 10)
    if (!Number.isFinite(codCatalogo)) {
      return NextResponse.json(
        { success: false, error: 'cod_catalogo inválido' },
        { status: 400 }
      )
    }

    const paradaIds = paradaIdsRaw
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n))

    if (paradaIds.length === 0) {
      return NextResponse.json({
        success: true,
        passes: false,
        matching_stop_ids: [],
        matching_itinerario_ids: [],
        matches: [],
        count: 0,
      })
    }

    const result = await poolCID.query(
      `
      SELECT DISTINCT
        p.id AS id_parada,
        COALESCE(NULLIF(p.source_name, ''), p.source_id, 'Parada Oficial') AS nombre,
        h.id_itinerario,
        ${sqlNumeroLinea('ln')} AS ruta_linea,
        r.sentido,
        e.eot_nombre,
        e.cod_catalogo
      FROM geometria.paradas_oficiales p
      JOIN geometria.itinerario_parada ip ON ip.id_parada = p.id
      JOIN geometria.historico_itinerario h ON h.id_itinerario = ip.id_itinerario
      JOIN public.catalogo_rutas r ON LOWER(r.ruta_hex) = LOWER(h.ruta_hex)
      ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
      JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
      WHERE p.id = ANY($1::int[])
        AND e.cod_catalogo = $2
        AND ${sqlItinerarioVigenteEnFecha('h')}
      ORDER BY p.id, ruta_linea
      `,
      [paradaIds, codCatalogo]
    )

    const matchingStopIds = [
      ...new Set(result.rows.map((r: any) => Number(r.id_parada))),
    ]
    const matchingItinerarioIds = [
      ...new Set(result.rows.map((r: any) => Number(r.id_itinerario))),
    ]

    const byStop: Record<
      number,
      { id_parada: number; nombre: string; lineas: string[]; itinerario_ids: number[] }
    > = {}

    for (const row of result.rows) {
      const id = Number(row.id_parada)
      if (!byStop[id]) {
        byStop[id] = {
          id_parada: id,
          nombre: row.nombre,
          lineas: [],
          itinerario_ids: [],
        }
      }
      const linea = String(row.ruta_linea || '').trim()
      if (linea && !byStop[id].lineas.includes(linea)) {
        byStop[id].lineas.push(linea)
      }
      const itinId = Number(row.id_itinerario)
      if (Number.isFinite(itinId) && !byStop[id].itinerario_ids.includes(itinId)) {
        byStop[id].itinerario_ids.push(itinId)
      }
    }

    return NextResponse.json({
      success: true,
      passes: matchingStopIds.length > 0,
      cod_catalogo: codCatalogo,
      matching_stop_ids: matchingStopIds,
      matching_itinerario_ids: matchingItinerarioIds,
      matches: Object.values(byStop),
      count: matchingStopIds.length,
    })
  } catch (error: any) {
    console.error('Error empresa-en-cercanas:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
