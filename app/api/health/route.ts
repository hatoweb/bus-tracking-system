import { NextResponse } from 'next/server'
import { cidConfigError, gpsConfigError } from '@/lib/db'

export async function GET() {
  const cid = cidConfigError()
  const gps = gpsConfigError()
  const geo =
    process.env.GEO_ITINERARIOS_URL || 'http://host.docker.internal:8020'

  return NextResponse.json({
    ok: !cid,
    cid: { configured: !cid, error: cid },
    gps: { configured: !gps, error: gps },
    geoItinerarios: { url: geo },
  })
}
