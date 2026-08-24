import { poolCID, cidConfigError } from '@/lib/db'
import { sqlItinerarioVigenteEnFecha } from '@/lib/sql-itinerario-vigente'
import { sqlJoinLineaVigente, sqlNumeroLinea } from '@/lib/sql-linea-ruta'
import {
  Footpath,
  ItineraryPattern,
  Stop,
  StopPassage,
  TransitNetwork,
} from './types'
import {
  buildFootpaths,
  SpatialStopIndex,
} from './spatial-index'

/** TTL de la red en memoria: 20 minutos */
const NETWORK_TTL_MS = 20 * 60 * 1000

let cachedNetwork: TransitNetwork | null = null
let spatialIndexInstance: SpatialStopIndex | null = null
let loadingPromise: Promise<TransitNetwork> | null = null

function stopLabel(alias: string): string {
  return `COALESCE(NULLIF(BTRIM(CAST(${alias}.source_name AS text)), ''), CAST(${alias}.source_id AS text), 'Parada Oficial')`
}

/**
 * Carga la red completa de transporte desde PostgreSQL a la memoria RAM.
 */
async function loadNetworkFromDb(): Promise<TransitNetwork> {
  const cfg = cidConfigError()
  if (cfg) {
    throw new Error(`CID Config error: ${cfg}`)
  }

  const client = await poolCID.connect()
  try {
    // 1) Cargar todas las paradas oficiales con coordenadas
    const stopsSql = `
      SELECT
        id,
        CAST(source_id AS text) AS source_id,
        ${stopLabel('p')} AS name,
        ST_Y(ST_Transform(geom, 4326)) AS lat,
        ST_X(ST_Transform(geom, 4326)) AS lng,
        bearing
      FROM geometria.paradas_oficiales p
      WHERE geom IS NOT NULL
    `
    const stopsRes = await client.query(stopsSql)
    const stopsMap = new Map<number, Stop>()

    for (const row of stopsRes.rows) {
      const lat = Number(row.lat)
      const lng = Number(row.lng)
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        stopsMap.set(Number(row.id), {
          id: Number(row.id),
          source_id: row.source_id ? String(row.source_id) : null,
          name: String(row.name || `Parada #${row.id}`),
          lat,
          lng,
          bearing: row.bearing != null ? Number(row.bearing) : null,
        })
      }
    }

    // 2) Cargar itinerarios vigentes con sus datos comerciales
    const itinsSql = `
      SELECT
        h.id_itinerario,
        h.ruta_hex,
        ${sqlNumeroLinea('ln')} AS linea,
        CAST(r.ramal AS text) AS ramal,
        e.cod_catalogo,
        e.eot_nombre
      FROM geometria.historico_itinerario h
      JOIN public.catalogo_rutas r ON LOWER(TRIM(r.ruta_hex)) = LOWER(TRIM(h.ruta_hex))
      ${sqlJoinLineaVigente('r', 'lrc', 'ln')}
      JOIN public.eots e ON e.cod_catalogo = r.id_eot_catalogo
      WHERE ${sqlItinerarioVigenteEnFecha('h')}
        AND e.permisionario = true
    `
    const itinsRes = await client.query(itinsSql)
    const itinsMap = new Map<number, ItineraryPattern>()

    for (const row of itinsRes.rows) {
      const idItin = Number(row.id_itinerario)
      itinsMap.set(idItin, {
        id_itinerario: idItin,
        ruta_hex: String(row.ruta_hex || ''),
        linea: row.linea != null ? String(row.linea) : null,
        ramal: row.ramal != null ? String(row.ramal) : null,
        eot_nombre: String(row.eot_nombre || ''),
        cod_catalogo: Number(row.cod_catalogo),
        stops: [],
        stopIndexMap: new Map(),
      })
    }

    // 3) Cargar la secuencia de paradas de cada itinerario
    const seqSql = `
      SELECT
        ip.id_itinerario,
        ip.id_parada,
        ip.orden
      FROM geometria.itinerario_parada ip
      JOIN geometria.historico_itinerario h
        ON h.id_itinerario = ip.id_itinerario
       AND ${sqlItinerarioVigenteEnFecha('h')}
      ORDER BY ip.id_itinerario, ip.orden ASC
    `
    const seqRes = await client.query(seqSql)
    const stopToItinsMap = new Map<number, StopPassage[]>()

    for (const row of seqRes.rows) {
      const idItin = Number(row.id_itinerario)
      const idParada = Number(row.id_parada)
      const orden = Number(row.orden)

      const itin = itinsMap.get(idItin)
      if (!itin || !stopsMap.has(idParada)) continue

      const index = itin.stops.length
      itin.stops.push({ stop_id: idParada, order: orden })
      itin.stopIndexMap.set(idParada, index)

      let passages = stopToItinsMap.get(idParada)
      if (!passages) {
        passages = []
        stopToItinsMap.set(idParada, passages)
      }
      passages.push({ id_itinerario: idItin, stop_index: index })
    }

    // 4) Construir índice espacial de paradas y footpaths
    const spatialIndex = new SpatialStopIndex(0.005)
    spatialIndex.build(stopsMap.values())
    const footpaths = buildFootpaths(stopsMap, spatialIndex, 350)

    const network: TransitNetwork = {
      version: (cachedNetwork?.version || 0) + 1,
      loadedAt: Date.now(),
      stops: stopsMap,
      itineraries: itinsMap,
      stopToItineraries: stopToItinsMap,
      footpaths,
    }

    cachedNetwork = network
    spatialIndexInstance = spatialIndex

    console.log(
      `[TransitNetwork] Red cargada en memoria: ${stopsMap.size} paradas, ` +
        `${itinsMap.size} itinerarios vigentes, ${footpaths.size} paradas con transbordo peatonal.`
    )

    return network
  } finally {
    client.release()
  }
}

/**
 * Obtiene la red en memoria (o la inicializa si no existe o expiró).
 */
export async function getTransitNetwork(forceRefresh = false): Promise<{
  network: TransitNetwork
  spatialIndex: SpatialStopIndex
}> {
  const isExpired =
    !cachedNetwork || Date.now() - cachedNetwork.loadedAt > NETWORK_TTL_MS

  if (!cachedNetwork || isExpired || forceRefresh) {
    if (!loadingPromise) {
      loadingPromise = loadNetworkFromDb().finally(() => {
        loadingPromise = null
      })
    }
    await loadingPromise
  }

  if (!cachedNetwork || !spatialIndexInstance) {
    throw new Error('No se pudo inicializar la red de transporte.')
  }

  return {
    network: cachedNetwork,
    spatialIndex: spatialIndexInstance,
  }
}
