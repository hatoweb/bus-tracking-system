import { NextRequest, NextResponse } from 'next/server'
import { poolCID } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'

/**
 * Paradas de abordaje cerca del usuario que comparten líneas/empresas
 * con una (o varias) paradas de bajada del destino.
 *
 * GET ?parada_ids_origen=1,2,3&parada_ids_destino=10
 *   &cod_catalogos=14,18&lineas=12,30,31
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const origenRaw = searchParams.get('parada_ids_origen') || ''
    const destinoRaw = searchParams.get('parada_ids_destino') || ''
    const catalogosRaw = searchParams.get('cod_catalogos') || ''
    const lineasRaw = searchParams.get('lineas') || ''

    const origenIds = origenRaw
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n))
    const destinoIds = destinoRaw
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n))
    const codCatalogos = catalogosRaw
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n))
    const lineas = lineasRaw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)

    if (origenIds.length === 0) {
      return NextResponse.json({
        success: true,
        matches: [],
        matching_stop_ids: [],
        message: 'Se requieren parada_ids_origen',
      })
    }

    // Si no mandan catálogos/líneas, derivarlos de las paradas de bajada
    let catalogos = codCatalogos
    let lineasFiltro = lineas

    if (
      (catalogos.length === 0 && lineasFiltro.length === 0) &&
      destinoIds.length > 0
    ) {
      const destRes = await poolCID.query(
        `
        SELECT DISTINCT
          e.cod_catalogo,
          ${sqlNumeroLinea('ln')} AS linea
        FROM geometria.itinerario_parada ip
        JOIN geometria.historico_itinerario h
          ON h.id_itinerario = ip.id_itinerario AND h.vigente = true
        JOIN public.catalogo_rutas r ON LOWER(r.ruta_hex) = LOWER(h.ruta_hex)
        ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
        JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
        WHERE ip.id_parada = ANY($1::int[])
          AND e.permisionario = true
        `,
        [destinoIds]
      )
      catalogos = [
        ...new Set(
          destRes.rows
            .map((r: any) => Number(r.cod_catalogo))
            .filter((n: number) => Number.isFinite(n))
        ),
      ]
      lineasFiltro = [
        ...new Set(
          destRes.rows
            .map((r: any) => String(r.linea || '').trim())
            .filter(Boolean)
        ),
      ]
    }

    if (catalogos.length === 0 && lineasFiltro.length === 0) {
      return NextResponse.json({
        success: true,
        matches: [],
        matching_stop_ids: [],
        catalogos: [],
        lineas: [],
        message: 'Sin líneas/empresas de referencia en el destino',
      })
    }

    const params: any[] = [origenIds]
    const filters: string[] = [
      'p.id = ANY($1::int[])',
      'h.vigente = true',
      'e.permisionario = true',
    ]

    const matchParts: string[] = []
    if (catalogos.length > 0) {
      params.push(catalogos)
      matchParts.push(`e.cod_catalogo = ANY($${params.length}::int[])`)
    }
    if (lineasFiltro.length > 0) {
      params.push(lineasFiltro)
      matchParts.push(`${sqlNumeroLinea('ln')} = ANY($${params.length}::text[])`)
    }
    // Empresa O línea de la bajada recomendada
    if (matchParts.length === 1) {
      filters.push(matchParts[0])
    } else if (matchParts.length > 1) {
      filters.push(`(${matchParts.join(' OR ')})`)
    }

    const result = await poolCID.query(
      `
      SELECT
        p.id AS id_parada,
        COALESCE(NULLIF(p.source_name, ''), p.source_id, 'Parada Oficial') AS nombre,
        e.cod_catalogo,
        e.eot_nombre,
        ${sqlNumeroLinea('ln')} AS linea,
        CAST(r.ramal AS text) AS ramal,
        h.id_itinerario
      FROM geometria.paradas_oficiales p
      JOIN geometria.itinerario_parada ip ON ip.id_parada = p.id
      JOIN geometria.historico_itinerario h ON h.id_itinerario = ip.id_itinerario
      JOIN public.catalogo_rutas r ON LOWER(r.ruta_hex) = LOWER(h.ruta_hex)
      ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
      JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
      WHERE ${filters.join(' AND ')}
      ORDER BY p.id, linea
      `,
      params
    )

    const byStop: Record<
      number,
      {
        id_parada: number
        nombre: string
        lineas: string[]
        empresas: string[]
        catalogos: number[]
        itinerario_ids: number[]
      }
    > = {}

    for (const row of result.rows) {
      const id = Number(row.id_parada)
      if (!byStop[id]) {
        byStop[id] = {
          id_parada: id,
          nombre: row.nombre,
          lineas: [],
          empresas: [],
          catalogos: [],
          itinerario_ids: [],
        }
      }
      const linea = String(row.linea || '').trim()
      const ramal = String(row.ramal || '').trim()
      const label = linea ? (ramal ? `${linea}-${ramal}` : linea) : ''
      if (label && !byStop[id].lineas.includes(label)) {
        byStop[id].lineas.push(label)
      }
      const emp = String(row.eot_nombre || '').trim()
      if (emp && !byStop[id].empresas.includes(emp)) {
        byStop[id].empresas.push(emp)
      }
      const cat = Number(row.cod_catalogo)
      if (Number.isFinite(cat) && !byStop[id].catalogos.includes(cat)) {
        byStop[id].catalogos.push(cat)
      }
      const itin = Number(row.id_itinerario)
      if (Number.isFinite(itin) && !byStop[id].itinerario_ids.includes(itin)) {
        byStop[id].itinerario_ids.push(itin)
      }
    }

    const matches = Object.values(byStop)
    return NextResponse.json({
      success: true,
      count: matches.length,
      matching_stop_ids: matches.map((m) => m.id_parada),
      matches,
      catalogos,
      lineas: lineasFiltro,
      query: { origenIds, destinoIds, catalogos, lineas: lineasFiltro },
    })
  } catch (error: any) {
    console.error('Error paradas-abordaje:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
