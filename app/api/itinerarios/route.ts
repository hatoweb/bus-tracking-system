import { NextRequest, NextResponse } from 'next/server'
import { poolCID } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'
import { sqlItinerarioVigenteEnFecha } from '@/lib/sql-itinerario-vigente'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const codCatalogo = searchParams.get('cod_catalogo')
    const eotId = searchParams.get('eot_id')
    const idsRaw = searchParams.get('ids') || ''
    const ids = idsRaw
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n))

    if (!codCatalogo && !eotId && ids.length === 0) {
      return NextResponse.json({ success: true, count: 0, data: [] })
    }

    let query = `
      SELECT 
        h.id_itinerario,
        h.ruta_hex,
        h.fecha_inicio_vigencia,
        h.fecha_fin_vigencia,
        h.vigente,
        h.observacion,
        e.eot_id,
        e.eot_nombre,
        e.eot_linea,
        ${sqlNumeroLinea('ln')} as ruta_linea,
        r.sentido,
        r.origen,
        r.destino,
        ST_AsGeoJSON(h.geom)::json as geojson
      FROM geometria.historico_itinerario h
      JOIN public.catalogo_rutas r ON LOWER(h.ruta_hex) = LOWER(r.ruta_hex)
      ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
      JOIN public.eots e ON r.id_eot_catalogo = e.cod_catalogo
      WHERE ${sqlItinerarioVigenteEnFecha('h')}
    `

    const values: any[] = []

    if (ids.length > 0) {
      values.push(ids)
      query += ` AND h.id_itinerario = ANY($${values.length}::int[])`
    } else if (codCatalogo) {
      values.push(parseInt(codCatalogo))
      query += ` AND e.cod_catalogo = $${values.length}`
    } else if (eotId) {
      values.push(parseInt(eotId))
      query += ` AND e.eot_id = $${values.length}`
    }

    query += ` ORDER BY e.eot_nombre ASC, h.id_itinerario DESC LIMIT 120;`

    const result = await poolCID.query(query, values)

    return NextResponse.json({ success: true, count: result.rows.length, data: result.rows })
  } catch (error: any) {
    console.error('Error fetching itinerarios:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
