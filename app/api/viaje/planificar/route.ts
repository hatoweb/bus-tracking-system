import { NextRequest, NextResponse } from 'next/server'
import { getTransitNetwork } from '@/lib/routing-engine/network-store'
import { planJourney } from '@/lib/routing-engine/router'

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

/**
 * Planificador de viajes estilo Google Maps (Motor en Memoria con Búsqueda en Grafos).
 *
 * Características:
 *  1) Tiempo de respuesta ultra-rápido (< 20ms) sin sobrecargar PostgreSQL.
 *  2) Soporta viajes directos y transbordos con conexión peatonal (caminatas intermedias).
 *  3) Pondera tiempo de caminata, tiempo de viaje a bordo y tiempo de espera.
 *
 * GET ?lat_origen=&lng_origen=&lat_destino=&lng_destino=&parada_ids_origen=&parada_ids_destino=&cod_catalogo=&limit=
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  try {
    const { searchParams } = new URL(request.url)
    const latOrigen = Number(searchParams.get('lat_origen'))
    const lngOrigen = Number(searchParams.get('lng_origen'))
    const latDestino = Number(searchParams.get('lat_destino'))
    const lngDestino = Number(searchParams.get('lng_destino'))
    const origenIds = parseIds(searchParams.get('parada_ids_origen'))
    const destinoIds = parseIds(searchParams.get('parada_ids_destino'))
    const codCatalogoRaw = searchParams.get('cod_catalogo')
    const codCatalogo = codCatalogoRaw ? parseInt(codCatalogoRaw, 10) : null
    const forceRefresh = searchParams.get('refresh') === 'true'
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

    // 1) Obtener el grafo de transporte en memoria
    const { network, spatialIndex } = await getTransitNetwork(forceRefresh)

    // 2) Ejecutar búsqueda de rutas multi-modal
    const options = planJourney(network, spatialIndex, {
      latOrigen,
      lngOrigen,
      latDestino,
      lngDestino,
      origenParadaIds: origenIds,
      destinoParadaIds: destinoIds,
      codCatalogo,
      maxOptions,
      maxWalkOriginM: 1200,
      maxWalkDestM: 1200,
      maxWalkTransferM: 350,
    })

    const direct = options.filter((o) => o.type === 'direct')
    const transfers = options.filter((o) => o.type === 'transfer')
    const best = options[0] || null
    const computeTimeMs = Date.now() - startTime

    if (options.length === 0) {
      return NextResponse.json({
        success: true,
        mode: 'none',
        options: [],
        direct: [],
        transfers: [],
        best: null,
        message:
          'No se encontraron rutas directas ni con transbordo para este trayecto. Probá ampliando los puntos de búsqueda.',
        compute_time_ms: computeTimeMs,
      })
    }

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
        cod_catalogo: codCatalogo,
        limit: maxOptions,
        engine: 'in-memory-transit-graph',
      },
      compute_time_ms: computeTimeMs,
    })
  } catch (error: any) {
    console.error('Error planificar viaje:', error)
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Error calculando ruta de viaje.',
      },
      { status: 500 }
    )
  }
}
