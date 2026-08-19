import { NextRequest, NextResponse } from 'next/server'
import { cidConfigError, poolCID } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'
import type { TripLeg, TripPlanResult } from '@/lib/trip-plan'

function parseIds(raw: string | null): number[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n))
}

function rowToLeg(row: any, leg: number): TripLeg {
  return {
    leg,
    id_itinerario: Number(row.id_itinerario),
    ruta_hex: String(row.ruta_hex || ''),
    linea: row.linea != null ? String(row.linea) : null,
    ramal: row.ramal != null ? String(row.ramal) : null,
    eot_nombre: String(row.eot_nombre || ''),
    cod_catalogo: Number(row.cod_catalogo),
    boarding: {
      id: Number(row.boarding_stop_id),
      name: String(row.boarding_name || 'Parada'),
      lat: row.boarding_lat != null ? Number(row.boarding_lat) : null,
      lng: row.boarding_lng != null ? Number(row.boarding_lng) : null,
    },
    alighting: {
      id: Number(row.alighting_stop_id),
      name: String(row.alighting_name || 'Parada'),
      lat: row.alighting_lat != null ? Number(row.alighting_lat) : null,
      lng: row.alighting_lng != null ? Number(row.alighting_lng) : null,
    },
  }
}

/**
 * Planifica viaje origen→destino:
 * 1) Directo: un solo itinerario vigente une parada cercana al origen con una del destino.
 * 2) Transbordo: dos itinerarios distintos se unen en una parada común de cambio.
 *
 * GET ?parada_ids_origen=1,2&parada_ids_destino=3,4
 *     &lat_origen=&lng_origen=&lat_destino=&lng_destino=
 *     &cod_catalogo= (opcional)
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

    if (origenIds.length === 0 || destinoIds.length === 0) {
      return NextResponse.json({
        success: true,
        direct: [],
        transfers: [],
        best: null,
        message: 'Se requieren paradas cercanas al origen y al destino',
      })
    }

    const empresaFilter = Number.isFinite(codCatalogo)
      ? ` AND e.cod_catalogo = ${codCatalogo}`
      : ''
    const empresaFilterLeg1 = Number.isFinite(codCatalogo)
      ? ` AND e1.cod_catalogo = ${codCatalogo}`
      : ''

    const stopLabel = (alias: string) =>
      `COALESCE(NULLIF(BTRIM(CAST(${alias}.source_name AS text)), ''), CAST(${alias}.source_id AS text), 'Parada Oficial')`

    const directSql = `
      SELECT DISTINCT ON (h.id_itinerario, p_o.id, p_d.id)
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
            ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
          )::numeric, 0
        ) AS dist_origen_m,
        ROUND(
          ST_Distance(
            ST_Transform(p_d.geom, 4326)::geography,
            ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography
          )::numeric, 0
        ) AS dist_destino_m
      FROM geometria.paradas_oficiales p_o
      JOIN geometria.itinerario_parada ip_o ON ip_o.id_parada = p_o.id
      JOIN geometria.historico_itinerario h
        ON h.id_itinerario = ip_o.id_itinerario AND h.vigente = true
      JOIN geometria.itinerario_parada ip_d
        ON ip_d.id_itinerario = h.id_itinerario AND ip_d.orden > ip_o.orden
      JOIN geometria.paradas_oficiales p_d ON p_d.id = ip_d.id_parada
      JOIN public.catalogo_rutas r ON LOWER(r.ruta_hex) = LOWER(h.ruta_hex)
      ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
      JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
      WHERE p_o.id = ANY($1::int[])
        AND p_d.id = ANY($6::int[])
        AND e.permisionario = true
        ${empresaFilter}
      ORDER BY
        h.id_itinerario,
        p_o.id,
        p_d.id,
        dist_origen_m ASC,
        dist_destino_m ASC
      LIMIT 20
    `

    const directRes = await poolCID.query(directSql, [
      origenIds,
      latOrigen,
      lngOrigen,
      latDestino,
      lngDestino,
      destinoIds,
    ])

    const direct: TripPlanResult[] = directRes.rows.map((row: any) => ({
      type: 'direct' as const,
      legs: [rowToLeg(row, 1)],
      score:
        Number(row.dist_origen_m || 0) +
        Number(row.dist_destino_m || 0),
    }))
    direct.sort((a, b) => a.score - b.score)

    let transfers: TripPlanResult[] = []

    if (direct.length === 0) {
      const transferSql = `
        SELECT DISTINCT ON (h1.id_itinerario, h2.id_itinerario, p_o.id, p_t.id, p_d.id)
          h1.id_itinerario AS leg1_itinerario,
          h1.ruta_hex AS leg1_ruta_hex,
          ${sqlNumeroLinea('ln1')} AS leg1_linea,
          CAST(r1.ramal AS text) AS leg1_ramal,
          e1.cod_catalogo AS leg1_cod_catalogo,
          e1.eot_nombre AS leg1_eot_nombre,
          p_o.id AS leg1_boarding_id,
          ${stopLabel('p_o')} AS leg1_boarding_name,
          ST_Y(ST_Transform(p_o.geom, 4326)) AS leg1_boarding_lat,
          ST_X(ST_Transform(p_o.geom, 4326)) AS leg1_boarding_lng,
          p_t.id AS transfer_stop_id,
          ${stopLabel('p_t')} AS transfer_name,
          ST_Y(ST_Transform(p_t.geom, 4326)) AS transfer_lat,
          ST_X(ST_Transform(p_t.geom, 4326)) AS transfer_lng,
          h2.id_itinerario AS leg2_itinerario,
          h2.ruta_hex AS leg2_ruta_hex,
          ${sqlNumeroLinea('ln2')} AS leg2_linea,
          CAST(r2.ramal AS text) AS leg2_ramal,
          e2.cod_catalogo AS leg2_cod_catalogo,
          e2.eot_nombre AS leg2_eot_nombre,
          p_d.id AS leg2_alighting_id,
          ${stopLabel('p_d')} AS leg2_alighting_name,
          ST_Y(ST_Transform(p_d.geom, 4326)) AS leg2_alighting_lat,
          ST_X(ST_Transform(p_d.geom, 4326)) AS leg2_alighting_lng,
          ROUND(
            ST_Distance(
              ST_Transform(p_o.geom, 4326)::geography,
              ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
            )::numeric, 0
          ) AS dist_origen_m,
          ROUND(
            ST_Distance(
              ST_Transform(p_d.geom, 4326)::geography,
              ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography
            )::numeric, 0
          ) AS dist_destino_m,
          (ip_t1.orden - ip_o.orden + ip_d.orden - ip_t2.orden) AS hop_penalty
        FROM geometria.paradas_oficiales p_o
        JOIN geometria.itinerario_parada ip_o ON ip_o.id_parada = p_o.id
        JOIN geometria.historico_itinerario h1
          ON h1.id_itinerario = ip_o.id_itinerario AND h1.vigente = true
        JOIN geometria.itinerario_parada ip_t1
          ON ip_t1.id_itinerario = h1.id_itinerario AND ip_t1.orden > ip_o.orden
        JOIN geometria.paradas_oficiales p_t ON p_t.id = ip_t1.id_parada
        JOIN geometria.itinerario_parada ip_t2 ON ip_t2.id_parada = p_t.id
        JOIN geometria.historico_itinerario h2
          ON h2.id_itinerario = ip_t2.id_itinerario
         AND h2.vigente = true
         AND h2.id_itinerario <> h1.id_itinerario
        JOIN geometria.itinerario_parada ip_d
          ON ip_d.id_itinerario = h2.id_itinerario AND ip_d.orden > ip_t2.orden
        JOIN geometria.paradas_oficiales p_d ON p_d.id = ip_d.id_parada
        JOIN public.catalogo_rutas r1 ON LOWER(r1.ruta_hex) = LOWER(h1.ruta_hex)
        ${sqlJoinLineaVigente('r1', 'lrc1', 'ln1')}
        JOIN public.eots e1 ON e1.cod_catalogo = r1.id_eot_catalogo
        JOIN public.catalogo_rutas r2 ON LOWER(r2.ruta_hex) = LOWER(h2.ruta_hex)
        ${sqlJoinLineaVigente('r2', 'lrc2', 'ln2')}
        JOIN public.eots e2 ON e2.cod_catalogo = r2.id_eot_catalogo
        WHERE p_o.id = ANY($1::int[])
          AND p_d.id = ANY($6::int[])
          AND e1.permisionario = true
          AND e2.permisionario = true
          ${empresaFilterLeg1}
        ORDER BY
          h1.id_itinerario,
          h2.id_itinerario,
          p_o.id,
          p_t.id,
          p_d.id,
          dist_origen_m ASC,
          dist_destino_m ASC,
          hop_penalty ASC
        LIMIT 25
      `

      const transferRes = await poolCID.query(transferSql, [
        origenIds,
        latOrigen,
        lngOrigen,
        latDestino,
        lngDestino,
        destinoIds,
      ])

      transfers = transferRes.rows.map((row: any) => {
        const leg1: TripLeg = {
          leg: 1,
          id_itinerario: Number(row.leg1_itinerario),
          ruta_hex: String(row.leg1_ruta_hex || ''),
          linea: row.leg1_linea != null ? String(row.leg1_linea) : null,
          ramal: row.leg1_ramal != null ? String(row.leg1_ramal) : null,
          eot_nombre: String(row.leg1_eot_nombre || ''),
          cod_catalogo: Number(row.leg1_cod_catalogo),
          boarding: {
            id: Number(row.leg1_boarding_id),
            name: String(row.leg1_boarding_name || 'Parada'),
            lat:
              row.leg1_boarding_lat != null
                ? Number(row.leg1_boarding_lat)
                : null,
            lng:
              row.leg1_boarding_lng != null
                ? Number(row.leg1_boarding_lng)
                : null,
          },
          alighting: {
            id: Number(row.transfer_stop_id),
            name: String(row.transfer_name || 'Transbordo'),
            lat: row.transfer_lat != null ? Number(row.transfer_lat) : null,
            lng: row.transfer_lng != null ? Number(row.transfer_lng) : null,
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
            id: Number(row.transfer_stop_id),
            name: String(row.transfer_name || 'Transbordo'),
            lat: row.transfer_lat != null ? Number(row.transfer_lat) : null,
            lng: row.transfer_lng != null ? Number(row.transfer_lng) : null,
          },
          alighting: {
            id: Number(row.leg2_alighting_id),
            name: String(row.leg2_alighting_name || 'Parada'),
            lat:
              row.leg2_alighting_lat != null
                ? Number(row.leg2_alighting_lat)
                : null,
            lng:
              row.leg2_alighting_lng != null
                ? Number(row.leg2_alighting_lng)
                : null,
          },
        }
        return {
          type: 'transfer' as const,
          legs: [leg1, leg2],
          transfer: {
            id: Number(row.transfer_stop_id),
            name: String(row.transfer_name || 'Transbordo'),
            lat: row.transfer_lat != null ? Number(row.transfer_lat) : null,
            lng: row.transfer_lng != null ? Number(row.transfer_lng) : null,
          },
          score:
            Number(row.dist_origen_m || 0) +
            Number(row.dist_destino_m || 0) +
            Number(row.hop_penalty || 0) * 80,
        }
      })
      transfers.sort((a, b) => a.score - b.score)
    }

    const best: TripPlanResult | null =
      direct[0] || transfers[0] || null

    return NextResponse.json({
      success: true,
      direct,
      transfers,
      best,
      query: {
        origenIds,
        destinoIds,
        cod_catalogo: codCatalogo,
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
