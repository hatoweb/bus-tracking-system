import { poolCID } from '@/lib/db'
import {
  meanIdToNumeroOrden,
  type BusAccesibilidad,
} from '@/lib/bus-accesibilidad'

function accessKey(agencyId: string, numeroOrden: number): string {
  return `${agencyId.trim().toUpperCase()}|${numeroOrden}`
}

/**
 * Lookup batch de rampa para unidades GPS.
 * Devuelve mapa keyed por `${agency_id}|${numero_orden}`.
 */
export async function lookupBusesAccesibilidad(
  pairs: Array<{ agency_id: string; mean_id: string }>
): Promise<Map<string, BusAccesibilidad>> {
  const out = new Map<string, BusAccesibilidad>()
  const agencies = new Set<string>()
  const ordenes = new Set<number>()
  const wanted = new Set<string>()

  for (const p of pairs) {
    const agency = String(p.agency_id || '').trim()
    const orden = meanIdToNumeroOrden(p.mean_id)
    if (!agency || orden == null) continue
    agencies.add(agency.toUpperCase())
    ordenes.add(orden)
    wanted.add(accessKey(agency, orden))
  }

  if (agencies.size === 0 || ordenes.size === 0) return out

  try {
    const res = await poolCID.query(
      `
      SELECT DISTINCT ON (UPPER(TRIM(be.id_eot)), b.numero_orden)
        UPPER(TRIM(be.id_eot)) AS id_eot,
        b.numero_orden,
        be.id_bus,
        b.tiene_rampa
      FROM registro_habilitacion.bus_empresa be
      JOIN registro_habilitacion.buses b ON b.id_bus = be.id_bus
      WHERE UPPER(TRIM(be.id_eot)) = ANY($1::text[])
        AND b.numero_orden = ANY($2::int[])
        AND be.fecha_asignacion <= CURRENT_DATE
        AND (be.fecha_fin_asignacion IS NULL OR be.fecha_fin_asignacion >= CURRENT_DATE)
        AND (
          be.estado_asignacion IS NULL
          OR UPPER(TRIM(be.estado_asignacion)) LIKE 'ACTIV%'
        )
      ORDER BY
        UPPER(TRIM(be.id_eot)),
        b.numero_orden,
        be.fecha_asignacion DESC NULLS LAST
      `,
      [[...agencies], [...ordenes]]
    )

    for (const row of res.rows) {
      const key = accessKey(String(row.id_eot), Number(row.numero_orden))
      if (!wanted.has(key)) continue
      out.set(key, {
        tiene_rampa:
          row.tiene_rampa === true
            ? true
            : row.tiene_rampa === false
              ? false
              : null,
        id_bus: row.id_bus != null ? Number(row.id_bus) : null,
        numero_orden: row.numero_orden != null ? Number(row.numero_orden) : null,
      })
    }
  } catch (err) {
    console.error('lookupBusesAccesibilidad:', err)
  }

  return out
}

/** Adjunta tiene_rampa / id_bus_cid a cada bus GPS. */
export async function enrichBusesWithAccesibilidad<
  T extends { agency_id?: string; mean_id?: string },
>(buses: T[]): Promise<(T & BusAccesibilidad)[]> {
  const map = await lookupBusesAccesibilidad(
    buses.map((b) => ({
      agency_id: String(b.agency_id || ''),
      mean_id: String(b.mean_id || ''),
    }))
  )

  return buses.map((b) => {
    const agency = String(b.agency_id || '')
    const orden = meanIdToNumeroOrden(b.mean_id)
    const hit = orden != null ? map.get(accessKey(agency, orden)) : undefined
    return {
      ...b,
      tiene_rampa: hit ? hit.tiene_rampa : null,
      id_bus: hit?.id_bus ?? null,
      numero_orden: hit?.numero_orden ?? orden,
    }
  })
}
