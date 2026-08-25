import { NextResponse } from 'next/server'
import { cidConfigError, gpsConfigError } from '@/lib/db'
import { authConfigStatus } from '@/auth'

export async function GET() {
  const cid = cidConfigError()
  const gps = gpsConfigError()
  const geo =
    process.env.GEO_ITINERARIOS_URL || 'http://host.docker.internal:8020'
  const authCfg = authConfigStatus()

  return NextResponse.json({
    ok: !cid && authCfg.hasSecret && authCfg.hasGoogleId && authCfg.hasGoogleSecret,
    cid: { configured: !cid, error: cid },
    gps: { configured: !gps, error: gps },
    geoItinerarios: { url: geo },
    auth: {
      ...authCfg,
      ready:
        authCfg.hasSecret &&
        authCfg.hasGoogleId &&
        authCfg.hasGoogleSecret,
      hint: !authCfg.hasSecret
        ? 'Falta AUTH_SECRET en el .env del contenedor'
        : !authCfg.hasGoogleId || !authCfg.hasGoogleSecret
          ? 'Faltan AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET'
          : !authCfg.authUrl
            ? 'Recomendado: AUTH_URL=https://sistemas.mopc.gov.py/prototipo_vmt'
            : null,
    },
  })
}
