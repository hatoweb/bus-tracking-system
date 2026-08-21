import { NextRequest, NextResponse } from 'next/server'
import { poolCID } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'
import { sqlItinerarioVigenteEnFecha } from '@/lib/sql-itinerario-vigente'

/**
 * Sugiere EOTs que pasan por paradas de origen y (si hay) de destino.
 * Incluye IDs de paradas por empresa para marcar abordaje.
 *
 * GET ?parada_ids_origen=1,2,3&parada_ids_destino=4,5&cod_catalogo=7&limit=10
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const origenRaw = searchParams.get('parada_ids_origen') || ''
    const destinoRaw = searchParams.get('parada_ids_destino') || ''
    const codCatalogoRaw = searchParams.get('cod_catalogo')
    const limit = Math.min(parseInt(searchParams.get('limit') || '12', 10) || 12, 30)

    const origenIds = origenRaw
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n))
    const destinoIds = destinoRaw
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n))
    const codCatalogo = codCatalogoRaw ? parseInt(codCatalogoRaw, 10) : null

    if (origenIds.length === 0) {
      return NextResponse.json({
        success: true,
        suggestions: [],
        message: 'Se requieren paradas de origen',
      })
    }

    const params: any[] = [origenIds]
    let empresaFilter = ''
    if (codCatalogo != null && Number.isFinite(codCatalogo)) {
      params.push(codCatalogo)
      empresaFilter = ` AND e.cod_catalogo = $${params.length}`
    }
    params.push(limit)
    const limitParam = `$${params.length}`

    const origenRes = await poolCID.query(
      `
      SELECT
        e.cod_catalogo,
        e.eot_nombre,
        e.eot_linea,
        e.eot_id,
        e.id_eot_vmt_hex,
        COUNT(DISTINCT p.id)::int AS paradas_origen,
        ARRAY_AGG(DISTINCT p.id) AS parada_ids_origen,
        ARRAY_AGG(DISTINCT ${sqlNumeroLinea('ln')}) FILTER (WHERE ln.numero_linea IS NOT NULL) AS lineas
      FROM geometria.paradas_oficiales p
      JOIN geometria.itinerario_parada ip ON ip.id_parada = p.id
      JOIN geometria.historico_itinerario h ON h.id_itinerario = ip.id_itinerario AND ${sqlItinerarioVigenteEnFecha('h')}
      JOIN public.catalogo_rutas r ON LOWER(r.ruta_hex) = LOWER(h.ruta_hex)
      ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
      JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
      WHERE p.id = ANY($1::int[])
      ${empresaFilter}
      GROUP BY e.cod_catalogo, e.eot_nombre, e.eot_linea, e.eot_id, e.id_eot_vmt_hex
      ORDER BY paradas_origen DESC, e.eot_nombre
      LIMIT ${limitParam}
      `,
      params
    )

    let destinoByCatalogo: Record<
      number,
      { count: number; parada_ids: number[] }
    > = {}

    if (destinoIds.length > 0) {
      const destParams: any[] = [destinoIds]
      let destEmpresaFilter = ''
      if (codCatalogo != null && Number.isFinite(codCatalogo)) {
        destParams.push(codCatalogo)
        destEmpresaFilter = ` AND e.cod_catalogo = $${destParams.length}`
      }

      const destRes = await poolCID.query(
        `
        SELECT
          e.cod_catalogo,
          COUNT(DISTINCT p.id)::int AS paradas_destino,
          ARRAY_AGG(DISTINCT p.id) AS parada_ids_destino
        FROM geometria.paradas_oficiales p
        JOIN geometria.itinerario_parada ip ON ip.id_parada = p.id
        JOIN geometria.historico_itinerario h ON h.id_itinerario = ip.id_itinerario AND ${sqlItinerarioVigenteEnFecha('h')}
        JOIN public.catalogo_rutas r ON LOWER(r.ruta_hex) = LOWER(h.ruta_hex)
        JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
        WHERE p.id = ANY($1::int[])
        ${destEmpresaFilter}
        GROUP BY e.cod_catalogo
        `,
        destParams
      )
      for (const row of destRes.rows) {
        destinoByCatalogo[Number(row.cod_catalogo)] = {
          count: Number(row.paradas_destino),
          parada_ids: (row.parada_ids_destino || []).map((id: any) => Number(id)),
        }
      }
    }

    const suggestions = origenRes.rows.map((r: any) => {
      const cod = Number(r.cod_catalogo)
      const destInfo = destinoByCatalogo[cod]
      const paradasDestino = destInfo?.count || 0
      const cubreDestino = destinoIds.length === 0 ? null : paradasDestino > 0
      return {
        cod_catalogo: cod,
        eot_nombre: r.eot_nombre,
        eot_linea: r.eot_linea,
        eot_id: r.eot_id,
        id_eot_vmt_hex: r.id_eot_vmt_hex,
        paradas_origen: Number(r.paradas_origen),
        paradas_destino: paradasDestino,
        parada_ids_origen: (r.parada_ids_origen || []).map((id: any) => Number(id)),
        parada_ids_destino: destInfo?.parada_ids || [],
        cubre_destino: cubreDestino,
        lineas: r.lineas || [],
        score:
          Number(r.paradas_origen) * 10 +
          (cubreDestino ? 80 : 0) +
          paradasDestino * 8,
      }
    })

    suggestions.sort((a: any, b: any) => b.score - a.score)

    // Paradas de abordaje útiles: las del origen que tienen al menos una empresa
    // que también llega a alguna parada cercana al destino.
    const boardingStopIds = new Set<number>()
    const alightingStopIds = new Set<number>()
    for (const s of suggestions) {
      if (destinoIds.length === 0 || s.cubre_destino) {
        for (const id of s.parada_ids_origen || []) boardingStopIds.add(Number(id))
        for (const id of s.parada_ids_destino || []) alightingStopIds.add(Number(id))
      }
    }
    // Si ninguna conecta con destino, igual sugerimos las del origen
    if (boardingStopIds.size === 0) {
      for (const s of suggestions) {
        for (const id of s.parada_ids_origen || []) boardingStopIds.add(Number(id))
      }
    }
    if (alightingStopIds.size === 0 && destinoIds.length > 0) {
      for (const id of destinoIds) alightingStopIds.add(Number(id))
    }

    return NextResponse.json({
      success: true,
      count: suggestions.length,
      suggestions,
      boarding_stop_ids: [...boardingStopIds],
      alighting_stop_ids: [...alightingStopIds],
      query: { origenIds, destinoIds, cod_catalogo: codCatalogo },
    })
  } catch (error: any) {
    console.error('Error sugerir empresas:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
