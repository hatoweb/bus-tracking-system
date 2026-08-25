import { NextResponse } from "next/server"
import { authConfigStatus } from "@/auth"

export const dynamic = "force-dynamic"

/**
 * Diagnóstico de auth sin exponer secretos.
 * GET /api/auth-debug
 */
export async function GET() {
  const cfg = authConfigStatus()
  return NextResponse.json({
    ok: cfg.hasSecret && cfg.hasGoogleId && cfg.hasGoogleSecret,
    auth: cfg,
    nodeEnv: process.env.NODE_ENV,
    hint: !cfg.hasSecret
      ? "AUTH_SECRET no llega al proceso Node. Revisá .env y docker compose env_file."
      : !cfg.hasGoogleId || !cfg.hasGoogleSecret
        ? "Faltan AUTH_GOOGLE_ID o AUTH_GOOGLE_SECRET en el contenedor."
        : "Env OK. Si /api/auth/session aún falla, mirá docker logs bus_tracking_app.",
  })
}
