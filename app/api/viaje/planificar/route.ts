import { NextRequest, NextResponse } from 'next/server'
import { cidConfigError, poolCID } from '@/lib/db'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'
import { sqlItinerarioVigenteEnFecha } from '@/lib/sql-itinerario-vigente'
import {
  buildTripOptions,
  type TripLeg,
  type TripPlanResult,
} from '@/lib/trip-plan'

function parseIds(raw: string | null): number[] {
  if (!raw) return []
  return [
    ...new Set(
      raw
        .split(',')
        .map((x) => parseInt(x.trim(), 10))
        .filter((n) => Number.isFinite(n))
    ),
  ]
}

function stopLabel(alias: string): string {
  return `COALESCE(NULLIF(BTRIM(CAST(${alias}.source_name AS text)), ''), CAST(${alias}.source_id AS text), 'Parada Oficial')`
}

/**
 * Planifica A→B con sentido (orden de paradas en el itinerario).
 *
 * Optimizado para responder < ~10s (evita 504 de nginx):
 *  1) Directo: mismo itinerario, orden(A) < orden(B)
 *  2) Transbordo: parada C compartida entre 2 itinerarios, orden A→C y C→B
 *     ordenado por dist(A,C)+dist(C,B)
 *
 * GET ?parada_ids_origen=&parada_ids_destino=&lat_origen=&lng_origen=&lat_destino=&lng_destino=
 */
export async function GET(request: NextRequest) {
  const client = await poolCID.connect()
  try {
    const cfg = cidConfigError()
    if (cfg) {
      return NextResponse.json({ success: false, error: cfg }, { status: 503 })
    }

    // Cortar consultas lentas antes del gateway (~60s nginx)
    await client.query(`SET LOCAL statement_timeout = '12000'`)

    const { searchParams } = new URL(request.url)
    const origenIds = parseIds(searchParams.get('parada_ids_origen')).slice(0, 8)
    const destinoIds = parseIds(searchParams.get('parada_ids_destino')).slice(0, 8)
    const latOrigen = Number(searchParams.get('lat_origen'))
    const lngOrigen = Number(searchParams.get('lng_origen'))
    const latDestino = Number(searchParams.get('lat_destino'))
    const lngDestino = Number(searchParams.get('lng_destino'))
    const codCatalogoRaw = searchParams.get('cod_catalogo')
    const codCatalogo = codCatalogoRaw ? parseInt(codCatalogoRaw, 10) : null
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

    if (origenIds.length === 0 || destinoIds.length === 0) {
      return NextResponse.json({
        success: true,
        mode: 'none',
        options: [],
        direct: [],
        transfers: [],
        best: null,
        message: 'Se requieren paradas cercanas al origen y al destino',
      })
    }

    const empresaFilter = Number.isFinite(codCatalogo)
      ? ` AND e.cod_catalogo = ${codCatalogo}`
      : ''

    // ------------------------------------------------------------------
    // 1) DIRECTO — sentido A→B vía orden de paradas (rápido)
    // ------------------------------------------------------------------
    const directSql = `
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
        (ip_d.orden - ip_o.orden) AS hops
      FROM geometria.itinerario_parada ip_o
      JOIN geometria.historico_itinerario h
        ON h.id_itinerario = ip_o.id_itinerario AND ${sqlItinerarioVigenteEnFecha('h')}
      JOIN geometria.paradas_oficiales p_o ON p_o.id = ip_o.id_parada
      JOIN geometria.itinerario_parada ip_d
        ON ip_d.id_itinerario = h.id_itinerario
       AND ip_d.orden > ip_o.orden
      JOIN geometria.paradas_oficiales p_d ON p_d.id = ip_d.id_parada
      JOIN public.catalogo_rutas r ON LOWER(TRIM(r.ruta_hex)) = LOWER(TRIM(h.ruta_hex))
      ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
      JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
      WHERE ip_o.id_parada = ANY($5::int[])
        AND ip_d.id_parada = ANY($6::int[])
        AND e.permisionario = true
        ${empresaFilter}
      ORDER BY
        h.id_itinerario,
        hops ASC,
        dist_origen_m ASC,
        dist_destino_m ASC
      LIMIT 12
    `

    const directRes = await client.query(directSql, [
      latOrigen,
      lngOrigen,
      latDestino,
      lngDestino,
      origenIds,
      destinoIds,
    ])

    const direct: TripPlanResult[] = directRes.rows.map((row: any) => {
      const leg: TripLeg = {
        leg: 1,
        id_itinerario: Number(row.id_itinerario),
        ruta_hex: String(row.ruta_hex || ''),
        linea: row.linea != null ? String(row.linea) : null,
        ramal: row.ramal != null ? String(row.ramal) : null,
        eot_nombre: String(row.eot_nombre || ''),
        cod_catalogo: Number(row.cod_catalogo),
        boarding: {
          id: Number(row.boarding_stop_id),
          name: String(row.boarding_name || 'Origen'),
          lat: Number(row.boarding_lat),
          lng: Number(row.boarding_lng),
        },
        alighting: {
          id: Number(row.alighting_stop_id),
          name: String(row.alighting_name || 'Destino'),
          lat: Number(row.alighting_lat),
          lng: Number(row.alighting_lng),
        },
      }
      return {
        type: 'direct' as const,
        legs: [leg],
        score:
          Number(row.dist_origen_m || 0) +
          Number(row.dist_destino_m || 0) +
          Number(row.hops || 0) * 25,
      }
    })
    direct.sort((a, b) => a.score - b.score)

    // ------------------------------------------------------------------
    // 2) TRANSBORDO — parada C compartida (sin ST_Intersection pesado)
    //    Sentido: orden A < orden C en leg1 y orden C < orden B en leg2
    // ------------------------------------------------------------------
    const transfers: TripPlanResult[] = []
    const needTransfers = direct.length < maxOptions

    if (needTransfers) {
      const transferSql = `
        WITH boardings AS (
          SELECT
            h.id_itinerario,
            h.ruta_hex,
            ${sqlNumeroLinea('ln')} AS linea,
            CAST(r.ramal AS text) AS ramal,
            e.cod_catalogo,
            e.eot_nombre,
            ip.id_parada AS boarding_id,
            ip.orden AS boarding_orden,
            ${stopLabel('p')} AS boarding_name,
            ST_Y(ST_Transform(p.geom, 4326)) AS boarding_lat,
            ST_X(ST_Transform(p.geom, 4326)) AS boarding_lng
          FROM geometria.itinerario_parada ip
          JOIN geometria.historico_itinerario h
            ON h.id_itinerario = ip.id_itinerario AND ${sqlItinerarioVigenteEnFecha('h')}
          JOIN geometria.paradas_oficiales p ON p.id = ip.id_parada
          JOIN public.catalogo_rutas r ON LOWER(TRIM(r.ruta_hex)) = LOWER(TRIM(h.ruta_hex))
          ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
          JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
          WHERE ip.id_parada = ANY($5::int[])
            AND e.permisionario = true
            ${empresaFilter}
        ),
        alightings AS (
          SELECT
            h.id_itinerario,
            h.ruta_hex,
            ${sqlNumeroLinea('ln')} AS linea,
            CAST(r.ramal AS text) AS ramal,
            e.cod_catalogo,
            e.eot_nombre,
            ip.id_parada AS alighting_id,
            ip.orden AS alighting_orden,
            ${stopLabel('p')} AS alighting_name,
            ST_Y(ST_Transform(p.geom, 4326)) AS alighting_lat,
            ST_X(ST_Transform(p.geom, 4326)) AS alighting_lng
          FROM geometria.itinerario_parada ip
          JOIN geometria.historico_itinerario h
            ON h.id_itinerario = ip.id_itinerario AND ${sqlItinerarioVigenteEnFecha('h')}
          JOIN geometria.paradas_oficiales p ON p.id = ip.id_parada
          JOIN public.catalogo_rutas r ON LOWER(TRIM(r.ruta_hex)) = LOWER(TRIM(h.ruta_hex))
          ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
          JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
          WHERE ip.id_parada = ANY($6::int[])
            AND e.permisionario = true
            ${empresaFilter}
        ),
        candidates AS (
          SELECT
            b.id_itinerario AS leg1_itinerario,
            b.ruta_hex AS leg1_ruta_hex,
            b.linea AS leg1_linea,
            b.ramal AS leg1_ramal,
            b.cod_catalogo AS leg1_cod_catalogo,
            b.eot_nombre AS leg1_eot_nombre,
            b.boarding_id,
            b.boarding_name,
            b.boarding_lat,
            b.boarding_lng,
            c.id AS transfer_stop_id,
            ${stopLabel('c')} AS transfer_name,
            ST_Y(ST_Transform(c.geom, 4326)) AS transfer_lat,
            ST_X(ST_Transform(c.geom, 4326)) AS transfer_lng,
            a.id_itinerario AS leg2_itinerario,
            a.ruta_hex AS leg2_ruta_hex,
            a.linea AS leg2_linea,
            a.ramal AS leg2_ramal,
            a.cod_catalogo AS leg2_cod_catalogo,
            a.eot_nombre AS leg2_eot_nombre,
            a.alighting_id,
            a.alighting_name,
            a.alighting_lat,
            a.alighting_lng,
            ROUND(
              ST_Distance(
                ST_Transform(c.geom, 4326)::geography,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
              )::numeric, 0
            ) AS dist_a_c_m,
            ROUND(
              ST_Distance(
                ST_Transform(c.geom, 4326)::geography,
                ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography
              )::numeric, 0
            ) AS dist_c_b_m
          FROM boardings b
          JOIN geometria.itinerario_parada ip_c1
            ON ip_c1.id_itinerario = b.id_itinerario
           AND ip_c1.orden > b.boarding_orden
           AND ip_c1.orden <= b.boarding_orden + 45
          JOIN geometria.paradas_oficiales c ON c.id = ip_c1.id_parada
          JOIN geometria.itinerario_parada ip_c2
            ON ip_c2.id_parada = c.id
           AND ip_c2.id_itinerario <> b.id_itinerario
          JOIN alightings a
            ON a.id_itinerario = ip_c2.id_itinerario
           AND a.alighting_orden > ip_c2.orden
           AND a.alighting_orden <= ip_c2.orden + 45
          WHERE c.id <> ALL($5::int[])
            AND c.id <> ALL($6::int[])
        )
        SELECT *
        FROM (
          SELECT
            *,
            (dist_a_c_m + dist_c_b_m) AS total_m,
            ROW_NUMBER() OVER (
              PARTITION BY leg1_itinerario, leg2_itinerario
              ORDER BY (dist_a_c_m + dist_c_b_m) ASC
            ) AS rn
          FROM candidates
        ) ranked
        WHERE rn = 1
        ORDER BY total_m ASC
        LIMIT 20
      `

      try {
        const transferRes = await client.query(transferSql, [
          latOrigen,
          lngOrigen,
          latDestino,
          lngDestino,
          origenIds,
          destinoIds,
        ])

        const seen = new Set<string>()
        for (const row of transferRes.rows) {
          const key = `${row.leg1_itinerario}|${row.leg2_itinerario}|${row.transfer_stop_id}`
          if (seen.has(key)) continue
          seen.add(key)

          const distAC = Number(row.dist_a_c_m || 0)
          const distCB = Number(row.dist_c_b_m || 0)
          const cId = Number(row.transfer_stop_id)
          const cName = String(row.transfer_name || 'Transbordo')
          const cLat = Number(row.transfer_lat)
          const cLng = Number(row.transfer_lng)

          const leg1: TripLeg = {
            leg: 1,
            id_itinerario: Number(row.leg1_itinerario),
            ruta_hex: String(row.leg1_ruta_hex || ''),
            linea: row.leg1_linea != null ? String(row.leg1_linea) : null,
            ramal: row.leg1_ramal != null ? String(row.leg1_ramal) : null,
            eot_nombre: String(row.leg1_eot_nombre || ''),
            cod_catalogo: Number(row.leg1_cod_catalogo),
            boarding: {
              id: Number(row.boarding_id),
              name: String(row.boarding_name || 'Origen (A)'),
              lat: Number(row.boarding_lat),
              lng: Number(row.boarding_lng),
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
              id: Number(row.alighting_id),
              name: String(row.alighting_name || 'Destino (B)'),
              lat: Number(row.alighting_lat),
              lng: Number(row.alighting_lng),
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
      } catch (transferErr: any) {
        // Si el transbordo se corta por timeout, devolvemos al menos los directos
        console.warn(
          'Transbordo omitido (timeout/error):',
          transferErr?.message
        )
      }
    }

    const options = buildTripOptions(direct, transfers, maxOptions)
    const best = options[0] || null

    return NextResponse.json({
      success: true,
      mode: best?.type || 'none',
      options,
      direct: direct.slice(0, maxOptions),
      transfers: transfers.slice(0, maxOptions),
      best,
      query: {
        origenIds,
        destinoIds,
        lat_origen: latOrigen,
        lng_origen: lngOrigen,
        lat_destino: latDestino,
        lng_destino: lngDestino,
        cod_catalogo: codCatalogo,
        limit: maxOptions,
        sense: 'A→B via stop order',
        engine: 'itinerario_parada',
      },
    })
  } catch (error: any) {
    console.error('Error planificar viaje:', error)
    const timedOut =
      /statement timeout|canceling statement/i.test(error?.message || '')
    return NextResponse.json(
      {
        success: false,
        error: timedOut
          ? 'La búsqueda de viaje tardó demasiado. Probá con otra ubicación o ampliá el radio.'
          : error.message,
        timed_out: timedOut,
      },
      { status: timedOut ? 504 : 500 }
    )
  } finally {
    client.release()
  }
}
