import { NextRequest, NextResponse } from 'next/server'
import { poolCID } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const codCatalogo = searchParams.get('cod_catalogo')
    const eotId = searchParams.get('eot_id')

    if (!codCatalogo && !eotId) {
      return NextResponse.json({ success: true, count: 0, data: [] })
    }

    let query = `
      SELECT 
        h.id_itinerario,
        h.ruta_hex,
        h.fecha_inicio_vigencia,
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
      WHERE h.vigente = true
    `

    const values: any[] = []

    if (codCatalogo) {
      values.push(parseInt(codCatalogo))
      query += ` AND e.cod_catalogo = $${values.length}`
    } else if (eotId) {
      values.push(parseInt(eotId))
      query += ` AND e.eot_id = $${values.length}`
    }

    query += ` ORDER BY e.eot_nombre ASC, h.id_itinerario DESC LIMIT 50;`

    const result = await poolCID.query(query, values)

    return NextResponse.json({ success: true, count: result.rows.length, data: result.rows })
  } catch (error: any) {
    console.error('Error fetching itinerarios:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
