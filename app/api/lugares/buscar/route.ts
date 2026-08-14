import { NextRequest, NextResponse } from 'next/server'
import { cidConfigError, poolCID } from '@/lib/db'
import { AMA_BBOX, isInsideAmaBbox, textLooksLikeAma } from '@/lib/ama'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'

/**
 * Busca lugares locales en el AMA (Asunción + Central AMA):
 * paradas oficiales + origen/destino de rutas + EOTs.
 * GET ?q=españa&limit=12
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()
    const limit = Math.min(parseInt(searchParams.get('limit') || '12', 10) || 12, 30)

    if (q.length < 2) {
      return NextResponse.json({ success: true, results: [], ambito: 'ama' })
    }

    const cfg = cidConfigError()
    if (cfg) {
      return NextResponse.json({ success: false, error: cfg }, { status: 503 })
    }

    const like = `%${q}%`
    const half = Math.max(3, Math.ceil(limit / 3))

    const [paradas, rutas, eots] = await Promise.all([
      poolCID.query(
        `
        SELECT
          p.id,
          COALESCE(NULLIF(BTRIM(CAST(p.source_name AS text)), ''), CAST(p.source_id AS text), 'Parada Oficial') AS label,
          ST_Y(ST_Transform(p.geom, 4326)) AS lat,
          ST_X(ST_Transform(p.geom, 4326)) AS lng
        FROM geometria.paradas_oficiales p
        WHERE p.geom IS NOT NULL
          AND (
            CAST(p.source_name AS text) ILIKE $1
            OR CAST(p.source_id AS text) ILIKE $1
          )
          AND ST_Intersects(
            ST_Transform(p.geom, 4326),
            ST_MakeEnvelope($3, $4, $5, $6, 4326)
          )
        ORDER BY p.source_name NULLS LAST
        LIMIT $2
        `,
        [
          like,
          half,
          AMA_BBOX.minLng,
          AMA_BBOX.minLat,
          AMA_BBOX.maxLng,
          AMA_BBOX.maxLat,
        ]
      ),
      poolCID.query(
        `
        SELECT DISTINCT ON (label, tipo)
          label,
          tipo,
          linea,
          cod_catalogo,
          eot_nombre
        FROM (
          SELECT
            cr.origen AS label,
            'origen_ruta'::text AS tipo,
            ${sqlNumeroLinea('ln')} AS linea,
            e.cod_catalogo,
            e.eot_nombre
          FROM public.catalogo_rutas cr
          JOIN public.eots e ON e.cod_catalogo = cr.id_eot_catalogo
          ${sqlJoinLineaVigente('cr', 'lrc', 'ln')}
          WHERE cr.origen ILIKE $1
          UNION ALL
          SELECT
            cr.destino AS label,
            'destino_ruta'::text AS tipo,
            ${sqlNumeroLinea('ln')} AS linea,
            e.cod_catalogo,
            e.eot_nombre
          FROM public.catalogo_rutas cr
          JOIN public.eots e ON e.cod_catalogo = cr.id_eot_catalogo
          ${sqlJoinLineaVigente('cr', 'lrc', 'ln')}
          WHERE cr.destino ILIKE $1
          UNION ALL
          SELECT
            CONCAT(
              'Línea ',
              ${sqlNumeroLinea('ln')},
              CASE
                WHEN NULLIF(BTRIM(CAST(cr.ramal AS text)), '') IS NULL THEN ''
                ELSE CONCAT(' - ', BTRIM(CAST(cr.ramal AS text)))
              END
            ) AS label,
            'linea'::text AS tipo,
            ${sqlNumeroLinea('ln')} AS linea,
            e.cod_catalogo,
            e.eot_nombre
          FROM public.lineas ln
          JOIN public.linea_ruta_catalogo lrc
            ON lrc.id_linea = ln.id_linea
           AND lrc.fecha_inicio <= CURRENT_DATE
           AND (lrc.fecha_fin IS NULL OR lrc.fecha_fin >= CURRENT_DATE)
          JOIN public.catalogo_rutas cr
            ON LOWER(TRIM(cr.ruta_hex)) = LOWER(TRIM(lrc.ruta_hex))
          JOIN public.eots e ON e.cod_catalogo = cr.id_eot_catalogo
          WHERE ${sqlNumeroLinea('ln')} ILIKE $1
             OR CAST(cr.ramal AS text) ILIKE $1
             OR CAST(ln.nombre_comercial AS text) ILIKE $1
        ) x
        WHERE label IS NOT NULL AND BTRIM(label) <> ''
        ORDER BY label, tipo
        LIMIT $2
        `,
        [like, half * 2]
      ),
      poolCID.query(
        `
        SELECT DISTINCT
          e.eot_id,
          e.eot_nombre AS label,
          e.eot_linea,
          e.cod_catalogo
        FROM public.eots e
        WHERE e.permisionario = true
          AND (
            e.eot_nombre ILIKE $1
            OR CAST(e.eot_linea AS text) ILIKE $1
          )
        ORDER BY e.eot_nombre
        LIMIT $2
        `,
        [like, half]
      ),
    ])

    const rutaRows = rutas.rows.filter((r: any) => {
      // Líneas numéricas siempre (operan en AMA)
      if (r.tipo === 'linea') return true
      // Orígenes/destinos: solo si suenan a AMA / Asunción / Central
      return textLooksLikeAma(String(r.label || ''))
    }).slice(0, half)

    const results = [
      ...paradas.rows
        .filter((r: any) => isInsideAmaBbox(Number(r.lat), Number(r.lng)))
        .map((r: any) => ({
          id: `parada:${r.id}`,
          label: r.label as string,
          lat: r.lat != null ? Number(r.lat) : null,
          lng: r.lng != null ? Number(r.lng) : null,
          tipo: 'parada' as const,
          fuente: 'paradas_oficiales',
          ambito: 'ama',
          meta: { id_parada: Number(r.id) },
        })),
      ...rutaRows.map((r: any, idx: number) => ({
        id: `ruta:${r.tipo}:${r.label}:${r.cod_catalogo}:${idx}`,
        label: r.label as string,
        lat: null as number | null,
        lng: null as number | null,
        tipo: r.tipo as string,
        fuente: 'catalogo_rutas',
        ambito: 'ama',
        meta: {
          linea: r.linea,
          cod_catalogo: r.cod_catalogo,
          eot_nombre: r.eot_nombre,
        },
      })),
      ...eots.rows.map((r: any) => ({
        id: `eot:${r.cod_catalogo}`,
        label: `${r.label} (Líneas: ${r.eot_linea || '—'})`,
        lat: null as number | null,
        lng: null as number | null,
        tipo: 'empresa' as const,
        fuente: 'eots',
        ambito: 'ama',
        meta: {
          eot_id: r.eot_id,
          cod_catalogo: r.cod_catalogo,
          eot_linea: r.eot_linea,
        },
      })),
    ].slice(0, limit)

    return NextResponse.json({
      success: true,
      count: results.length,
      results,
      ambito: 'ama',
    })
  } catch (error: any) {
    console.error('Error buscar lugares:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
