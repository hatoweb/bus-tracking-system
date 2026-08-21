import { NextRequest, NextResponse } from 'next/server'
import { poolCID } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'
import { sqlItinerarioVigenteEnFecha } from '@/lib/sql-itinerario-vigente'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const codCatalogo = searchParams.get('cod_catalogo')
    const eotId = searchParams.get('eot_id')
    const idItinerario = searchParams.get('id_itinerario')

    if (!codCatalogo && !eotId && !idItinerario) {
      return NextResponse.json({ success: true, count: 0, data: [] })
    }

    let query = `
      SELECT DISTINCT ON (p.id, ip.orden)
        p.id,
        ip.id_itinerario,
        ip.orden,
        p.source_id,
        COALESCE(NULLIF(p.source_name, ''), 'Parada Oficial') as nombre,
        ST_Y(ST_Transform(p.geom, 4326)) as latitud,
        ST_X(ST_Transform(p.geom, 4326)) as longitud,
        e.eot_nombre,
        ${sqlNumeroLinea('ln')} as ruta_linea,
        h.ruta_hex
      FROM public.eots e
      JOIN public.catalogo_rutas r ON r.id_eot_catalogo = e.cod_catalogo
      ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
      JOIN geometria.historico_itinerario h ON LOWER(h.ruta_hex) = LOWER(r.ruta_hex)
      JOIN geometria.itinerario_parada ip ON ip.id_itinerario = h.id_itinerario
      JOIN geometria.paradas_oficiales p ON p.id = ip.id_parada
      WHERE ${sqlItinerarioVigenteEnFecha('h')}
    `

    const values: any[] = []

    if (idItinerario) {
      values.push(parseInt(idItinerario))
      query += ` AND h.id_itinerario = $${values.length}`
    } else if (codCatalogo) {
      values.push(parseInt(codCatalogo))
      query += ` AND e.cod_catalogo = $${values.length}`
    } else if (eotId) {
      values.push(parseInt(eotId))
      query += ` AND e.eot_id = $${values.length}`
    }

    query += ` ORDER BY ip.orden ASC, p.id ASC LIMIT 200;`

    const result = await poolCID.query(query, values)

    return NextResponse.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    })
  } catch (error: any) {
    console.error('Error fetching paradas:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
