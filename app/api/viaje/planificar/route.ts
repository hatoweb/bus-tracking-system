import { NextRequest, NextResponse } from 'next/server'
import { cidConfigError, poolCID } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'
import {
  buildTripOptions,
  type TripLeg,
  type TripPlanResult,
} from '@/lib/trip-plan'

function parseIds(raw: string | null): number[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n))
}

function stopLabel(alias: string): string {
  return `COALESCE(NULLIF(BTRIM(CAST(${alias}.source_name AS text)), ''), CAST(${alias}.source_id AS text), 'Parada Oficial')`
}

/**
 * Fracción 0..1 de un punto sobre el shape (sentido del LineString).
 * Si el merge da MultiLineString, usa el segmento más cercano al punto.
 */
function sqlLocateFraction(geom4326Expr: string, lonParam: string, latParam: string): string {
  return `
    (
      SELECT ST_LineLocatePoint(seg.geom, ST_SetSRID(ST_MakePoint(${lonParam}, ${latParam}), 4326))
      FROM (
        SELECT (ST_Dump(
          CASE
            WHEN ST_GeometryType(ST_LineMerge(${geom4326Expr})) = 'ST_LineString'
              THEN ST_LineMerge(${geom4326Expr})
            ELSE ST_LineMerge(${geom4326Expr})
          END
        )).geom AS geom
      ) seg
      ORDER BY ST_Distance(
        seg.geom::geography,
        ST_SetSRID(ST_MakePoint(${lonParam}, ${latParam}), 4326)::geography
      )
      LIMIT 1
    )
  `
}

/**
 * Planifica viaje A → B respetando el sentido del shape (A→B, no B→A).
 *
 * Opciones (hasta 3):
 *  1) Primero: un solo itinerario en sentido A→B
 *  2) Siguientes: transbordo (shapes A∩B → punto C) con sentido A→C y C→B,
 *     ordenados por A–C + C–B más cortos
 */
export async function GET(request: NextRequest) {
  try {
    const cfg = cidConfigError()
    if (cfg) {
      return NextResponse.json({ success: false, error: cfg }, { status: 503 })
    }

    const { searchParams } = new URL(request.url)
    const origenIds = parseIds(searchParams.get('parada_ids_origen'))
    const destinoIds = parseIds(searchParams.get('parada_ids_destino'))
    const latOrigen = Number(searchParams.get('lat_origen'))
    const lngOrigen = Number(searchParams.get('lng_origen'))
    const latDestino = Number(searchParams.get('lat_destino'))
    const lngDestino = Number(searchParams.get('lng_destino'))
    const codCatalogoRaw = searchParams.get('cod_catalogo')
    const codCatalogo = codCatalogoRaw ? parseInt(codCatalogoRaw, 10) : null
    const radioM = Math.min(
      Math.max(parseInt(searchParams.get('radio_m') || '900', 10) || 900, 200),
      2500
    )
    const maxOptions = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '3', 10) || 3, 1),
      5
    )

    if (
      !Number.isFinite(latOrigen) ||
      !Number.isFinite(lngOrigen) ||
      !Number.isFinite(latDestino) ||
      !Number.isFinite(lngDestino)
    ) {
      return NextResponse.json(
        { success: false, error: 'lat/lng de origen y destino son obligatorios' },
        { status: 400 }
      )
    }

    const empresaFilter = Number.isFinite(codCatalogo)
      ? ` AND e.cod_catalogo = ${codCatalogo}`
      : ''

    const fracA = sqlLocateFraction('ST_Transform(h.geom, 4326)', '$2', '$1')
    const fracB = sqlLocateFraction('ST_Transform(h.geom, 4326)', '$4', '$3')

    // ------------------------------------------------------------------
    // 1) DIRECTO: un solo itinerario en sentido A → B
    // ------------------------------------------------------------------
    const hasStops = origenIds.length > 0 && destinoIds.length > 0

    const directSql = hasStops
      ? `
      SELECT DISTINCT ON (h.id_itinerario)
        h.id_itinerario,
        h.ruta_hex,
        ${sqlNumeroLinea('ln')} AS linea,
        CAST(r.ramal AS text) AS ramal,
        e.cod_catalogo,
        e.eot_nombre,
        p_o.id AS boarding_stop_id,
        ${stopLabel('p_o')} AS boarding_name,
        ST_Y(ST_Transform(p_o.geom, 4326)) AS boarding_lat,
        ST_X(ST_Transform(p_o.geom, 4326)) AS boarding_lng,
        p_d.id AS alighting_stop_id,
        ${stopLabel('p_d')} AS alighting_name,
        ST_Y(ST_Transform(p_d.geom, 4326)) AS alighting_lat,
        ST_X(ST_Transform(p_d.geom, 4326)) AS alighting_lng,
        ROUND(
          ST_Distance(
            ST_Transform(p_o.geom, 4326)::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          )::numeric, 0
        ) AS dist_origen_m,
        ROUND(
          ST_Distance(
            ST_Transform(p_d.geom, 4326)::geography,
            ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography
          )::numeric, 0
        ) AS dist_destino_m,
        (ip_d.orden - ip_o.orden) AS hops,
        ${fracA} AS frac_a,
        ${fracB} AS frac_b
      FROM geometria.historico_itinerario h
      JOIN geometria.itinerario_parada ip_o ON ip_o.id_itinerario = h.id_itinerario
      JOIN geometria.paradas_oficiales p_o ON p_o.id = ip_o.id_parada
      JOIN geometria.itinerario_parada ip_d
        ON ip_d.id_itinerario = h.id_itinerario AND ip_d.orden > ip_o.orden
      JOIN geometria.paradas_oficiales p_d ON p_d.id = ip_d.id_parada
      JOIN public.catalogo_rutas r ON LOWER(r.ruta_hex) = LOWER(h.ruta_hex)
      ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
      JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
      WHERE h.vigente = true
        AND h.geom IS NOT NULL
        AND p_o.id = ANY($5::int[])
        AND p_d.id = ANY($6::int[])
        AND e.permisionario = true
        ${empresaFilter}
        -- Sentido del shape: A aparece antes que B en el LineString
        AND COALESCE(${fracA}, 0) < COALESCE(${fracB}, 1)
      ORDER BY
        h.id_itinerario,
        hops ASC,
        dist_origen_m ASC,
        dist_destino_m ASC
      LIMIT 20
    `
      : `
      SELECT DISTINCT ON (h.id_itinerario)
        h.id_itinerario,
        h.ruta_hex,
        ${sqlNumeroLinea('ln')} AS linea,
        CAST(r.ramal AS text) AS ramal,
        e.cod_catalogo,
        e.eot_nombre,
        NULL::int AS boarding_stop_id,
        'Cerca del origen'::text AS boarding_name,
        $1::float8 AS boarding_lat,
        $2::float8 AS boarding_lng,
        NULL::int AS alighting_stop_id,
        'Cerca del destino'::text AS alighting_name,
        $3::float8 AS alighting_lat,
        $4::float8 AS alighting_lng,
        ROUND(
          ST_Distance(
            ST_Transform(h.geom, 4326)::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          )::numeric, 0
        ) AS dist_origen_m,
        ROUND(
          ST_Distance(
            ST_Transform(h.geom, 4326)::geography,
            ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography
          )::numeric, 0
        ) AS dist_destino_m,
        0 AS hops,
        ${fracA} AS frac_a,
        ${fracB} AS frac_b
      FROM geometria.historico_itinerario h
      JOIN public.catalogo_rutas r ON LOWER(r.ruta_hex) = LOWER(h.ruta_hex)
      ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
      JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
      WHERE h.vigente = true
        AND h.geom IS NOT NULL
        AND e.permisionario = true
        AND ST_DWithin(
          ST_Transform(h.geom, 4326)::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $5
        )
        AND ST_DWithin(
          ST_Transform(h.geom, 4326)::geography,
          ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography,
          $5
        )
        AND COALESCE(${fracA}, 0) < COALESCE(${fracB}, 1)
        ${empresaFilter}
      ORDER BY
        h.id_itinerario,
        dist_origen_m ASC,
        dist_destino_m ASC
      LIMIT 20
    `

    const directParams = hasStops
      ? [latOrigen, lngOrigen, latDestino, lngDestino, origenIds, destinoIds]
      : [latOrigen, lngOrigen, latDestino, lngDestino, radioM]

    const directRes = await poolCID.query(directSql, directParams)

    const direct: TripPlanResult[] = directRes.rows
      .filter((row: any) => {
        const fa = Number(row.frac_a)
        const fb = Number(row.frac_b)
        // Doble check sentido A→B
        if (Number.isFinite(fa) && Number.isFinite(fb) && fa >= fb) return false
        return true
      })
      .map((row: any) => {
        const leg: TripLeg = {
          leg: 1,
          id_itinerario: Number(row.id_itinerario),
          ruta_hex: String(row.ruta_hex || ''),
          linea: row.linea != null ? String(row.linea) : null,
          ramal: row.ramal != null ? String(row.ramal) : null,
          eot_nombre: String(row.eot_nombre || ''),
          cod_catalogo: Number(row.cod_catalogo),
          boarding: {
            id: row.boarding_stop_id != null ? Number(row.boarding_stop_id) : 0,
            name: String(row.boarding_name || 'Origen'),
            lat: row.boarding_lat != null ? Number(row.boarding_lat) : latOrigen,
            lng: row.boarding_lng != null ? Number(row.boarding_lng) : lngOrigen,
          },
          alighting: {
            id: row.alighting_stop_id != null ? Number(row.alighting_stop_id) : 0,
            name: String(row.alighting_name || 'Destino'),
            lat:
              row.alighting_lat != null ? Number(row.alighting_lat) : latDestino,
            lng:
              row.alighting_lng != null ? Number(row.alighting_lng) : lngDestino,
          },
        }
        return {
          type: 'direct' as const,
          legs: [leg],
          score:
            Number(row.dist_origen_m || 0) +
            Number(row.dist_destino_m || 0) +
            Number(row.hops || 0) * 40,
        }
      })
    direct.sort((a, b) => a.score - b.score)

    // ------------------------------------------------------------------
    // 2) TRANSBORDO: shapes(A) ∩ shapes(B) → C, sentido A→C y C→B
    //    Siempre se calcula para completar hasta N opciones.
    // ------------------------------------------------------------------
    const transfers: TripPlanResult[] = []
    const needTransfers = direct.length < maxOptions

    if (needTransfers) {
      const transferSql = `
        WITH pt_a AS (
          SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS g,
                 ST_SetSRID(ST_MakePoint($2, $1), 4326) AS geom
        ),
        pt_b AS (
          SELECT ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography AS g,
                 ST_SetSRID(ST_MakePoint($4, $3), 4326) AS geom
        ),
        shapes_a AS (
          SELECT
            h.id_itinerario,
            h.ruta_hex,
            ST_Transform(h.geom, 4326) AS geom4326,
            ${sqlNumeroLinea('ln')} AS linea,
            CAST(r.ramal AS text) AS ramal,
            e.cod_catalogo,
            e.eot_nombre
          FROM geometria.historico_itinerario h
          JOIN public.catalogo_rutas r ON LOWER(r.ruta_hex) = LOWER(h.ruta_hex)
          ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
          JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
          CROSS JOIN pt_a
          WHERE h.vigente = true
            AND h.geom IS NOT NULL
            AND e.permisionario = true
            AND ST_DWithin(ST_Transform(h.geom, 4326)::geography, pt_a.g, $5)
            ${empresaFilter}
          ORDER BY ST_Distance(ST_Transform(h.geom, 4326)::geography, pt_a.g)
          LIMIT 80
        ),
        shapes_b AS (
          SELECT
            h.id_itinerario,
            h.ruta_hex,
            ST_Transform(h.geom, 4326) AS geom4326,
            ${sqlNumeroLinea('ln')} AS linea,
            CAST(r.ramal AS text) AS ramal,
            e.cod_catalogo,
            e.eot_nombre
          FROM geometria.historico_itinerario h
          JOIN public.catalogo_rutas r ON LOWER(r.ruta_hex) = LOWER(h.ruta_hex)
          ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
          JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
          CROSS JOIN pt_b
          WHERE h.vigente = true
            AND h.geom IS NOT NULL
            AND e.permisionario = true
            AND ST_DWithin(ST_Transform(h.geom, 4326)::geography, pt_b.g, $5)
            ${empresaFilter}
          ORDER BY ST_Distance(ST_Transform(h.geom, 4326)::geography, pt_b.g)
          LIMIT 80
        ),
        pairs AS (
          SELECT
            a.id_itinerario AS leg1_itinerario,
            a.ruta_hex AS leg1_ruta_hex,
            a.linea AS leg1_linea,
            a.ramal AS leg1_ramal,
            a.cod_catalogo AS leg1_cod_catalogo,
            a.eot_nombre AS leg1_eot_nombre,
            a.geom4326 AS geom_a,
            b.id_itinerario AS leg2_itinerario,
            b.ruta_hex AS leg2_ruta_hex,
            b.linea AS leg2_linea,
            b.ramal AS leg2_ramal,
            b.cod_catalogo AS leg2_cod_catalogo,
            b.eot_nombre AS leg2_eot_nombre,
            b.geom4326 AS geom_b,
            CASE
              WHEN ST_IsEmpty(ST_Intersection(a.geom4326, b.geom4326)) THEN
                ST_ClosestPoint(a.geom4326, b.geom4326)
              WHEN ST_GeometryType(ST_Intersection(a.geom4326, b.geom4326))
                   IN ('ST_Point', 'ST_MultiPoint') THEN
                ST_GeometryN(
                  ST_CollectionExtract(ST_Intersection(a.geom4326, b.geom4326), 1),
                  1
                )
              ELSE
                ST_PointOnSurface(ST_Intersection(a.geom4326, b.geom4326))
            END AS c_geom
          FROM shapes_a a
          JOIN shapes_b b
            ON a.id_itinerario <> b.id_itinerario
           AND (
             ST_Intersects(a.geom4326, b.geom4326)
             OR ST_DWithin(a.geom4326::geography, b.geom4326::geography, 80)
           )
        ),
        scored AS (
          SELECT
            p.*,
            ST_Y(p.c_geom) AS transfer_lat,
            ST_X(p.c_geom) AS transfer_lng,
            ROUND(
              ST_Distance(p.c_geom::geography, (SELECT g FROM pt_a))::numeric, 0
            ) AS dist_a_c_m,
            ROUND(
              ST_Distance(p.c_geom::geography, (SELECT g FROM pt_b))::numeric, 0
            ) AS dist_c_b_m,
            -- Sentido A→C en shape 1 y C→B en shape 2
            ${sqlLocateFraction('p.geom_a', '$2', '$1')} AS frac_a_on_1,
            ${sqlLocateFraction('p.geom_a', 'ST_X(p.c_geom)', 'ST_Y(p.c_geom)')} AS frac_c_on_1,
            ${sqlLocateFraction('p.geom_b', 'ST_X(p.c_geom)', 'ST_Y(p.c_geom)')} AS frac_c_on_2,
            ${sqlLocateFraction('p.geom_b', '$4', '$3')} AS frac_b_on_2
          FROM pairs p
          WHERE p.c_geom IS NOT NULL AND NOT ST_IsEmpty(p.c_geom)
        )
        SELECT
          s.*,
          (s.dist_a_c_m + s.dist_c_b_m) AS total_m,
          ns.id AS transfer_stop_id,
          ${stopLabel('ns')} AS transfer_name,
          ST_Y(ST_Transform(ns.geom, 4326)) AS nearest_stop_lat,
          ST_X(ST_Transform(ns.geom, 4326)) AS nearest_stop_lng
        FROM scored s
        LEFT JOIN LATERAL (
          SELECT p.id, p.source_name, p.source_id, p.geom
          FROM geometria.paradas_oficiales p
          WHERE p.geom IS NOT NULL
          ORDER BY ST_Transform(p.geom, 4326)::geography <-> s.c_geom::geography
          LIMIT 1
        ) ns ON true
        WHERE COALESCE(s.frac_a_on_1, 0) < COALESCE(s.frac_c_on_1, 1)
          AND COALESCE(s.frac_c_on_2, 0) < COALESCE(s.frac_b_on_2, 1)
        ORDER BY total_m ASC, dist_a_c_m ASC
        LIMIT 40
      `

      const transferRes = await poolCID.query(transferSql, [
        latOrigen,
        lngOrigen,
        latDestino,
        lngDestino,
        radioM,
      ])

      const seen = new Set<string>()
      for (const row of transferRes.rows) {
        const key = `${row.leg1_itinerario}|${row.leg2_itinerario}|${Number(row.transfer_lat).toFixed(4)}|${Number(row.transfer_lng).toFixed(4)}`
        if (seen.has(key)) continue
        seen.add(key)

        const cLat =
          row.nearest_stop_lat != null
            ? Number(row.nearest_stop_lat)
            : Number(row.transfer_lat)
        const cLng =
          row.nearest_stop_lng != null
            ? Number(row.nearest_stop_lng)
            : Number(row.transfer_lng)
        const cName = String(row.transfer_name || 'Punto de transbordo')
        const cId =
          row.transfer_stop_id != null ? Number(row.transfer_stop_id) : 0

        const distAC = Number(row.dist_a_c_m || 0)
        const distCB = Number(row.dist_c_b_m || 0)

        const leg1: TripLeg = {
          leg: 1,
          id_itinerario: Number(row.leg1_itinerario),
          ruta_hex: String(row.leg1_ruta_hex || ''),
          linea: row.leg1_linea != null ? String(row.leg1_linea) : null,
          ramal: row.leg1_ramal != null ? String(row.leg1_ramal) : null,
          eot_nombre: String(row.leg1_eot_nombre || ''),
          cod_catalogo: Number(row.leg1_cod_catalogo),
          boarding: {
            id: origenIds[0] || 0,
            name: 'Origen (A)',
            lat: latOrigen,
            lng: lngOrigen,
          },
          alighting: {
            id: cId,
            name: cName,
            lat: cLat,
            lng: cLng,
          },
        }
        const leg2: TripLeg = {
          leg: 2,
          id_itinerario: Number(row.leg2_itinerario),
          ruta_hex: String(row.leg2_ruta_hex || ''),
          linea: row.leg2_linea != null ? String(row.leg2_linea) : null,
          ramal: row.leg2_ramal != null ? String(row.leg2_ramal) : null,
          eot_nombre: String(row.leg2_eot_nombre || ''),
          cod_catalogo: Number(row.leg2_cod_catalogo),
          boarding: {
            id: cId,
            name: cName,
            lat: cLat,
            lng: cLng,
          },
          alighting: {
            id: destinoIds[0] || 0,
            name: 'Destino (B)',
            lat: latDestino,
            lng: lngDestino,
          },
        }

        transfers.push({
          type: 'transfer',
          legs: [leg1, leg2],
          transfer: {
            id: cId,
            name: cName,
            lat: cLat,
            lng: cLng,
            dist_a_c_m: distAC,
            dist_c_b_m: distCB,
            total_m: distAC + distCB,
          },
          score: distAC + distCB,
        })
      }
      transfers.sort((a, b) => a.score - b.score)
    }

    const options = buildTripOptions(direct, transfers, maxOptions)
    const best = options[0] || null

    return NextResponse.json({
      success: true,
      mode: best?.type || 'none',
      options,
      direct,
      transfers,
      best,
      query: {
        origenIds,
        destinoIds,
        lat_origen: latOrigen,
        lng_origen: lngOrigen,
        lat_destino: latDestino,
        lng_destino: lngDestino,
        radio_m: radioM,
        cod_catalogo: codCatalogo,
        limit: maxOptions,
        sense: 'A→B only',
      },
    })
  } catch (error: any) {
    console.error('Error planificar viaje:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
