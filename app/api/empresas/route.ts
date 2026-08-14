import { NextResponse } from 'next/server'
import { cidConfigError, poolCID } from '@/lib/db'

export async function GET() {
  try {
    const cfg = cidConfigError()
    if (cfg) {
      return NextResponse.json({ success: false, error: cfg }, { status: 503 })
    }
    const result = await poolCID.query(`
      SELECT DISTINCT
        e.eot_id,
        e.eot_nombre,
        e.eot_linea,
        e.cod_catalogo,
        e.id_eot_vmt_hex
      FROM public.eots e
      JOIN public.catalogo_rutas r ON r.id_eot_catalogo = e.cod_catalogo
      JOIN geometria.historico_itinerario h ON LOWER(h.ruta_hex) = LOWER(r.ruta_hex)
      WHERE h.vigente = true
      ORDER BY e.eot_nombre ASC;
    `)

    return NextResponse.json({ success: true, data: result.rows })
  } catch (error: any) {
    console.error('Error fetching empresas:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
