import { NextRequest, NextResponse } from "next/server"
import { handlers } from "@/auth"
import { getBasePath } from "@/lib/base-path"

/**
 * Next quita /prototipo_vmt del pathname interno.
 * Auth.js (basePath=/prototipo_vmt/api/auth) necesita ver el prefijo
 * o responde 400 UnknownAction en /session, /error, /callback, etc.
 */
async function withBasePath(
  req: NextRequest,
  handler: (req: NextRequest) => Promise<Response>
) {
  const base = getBasePath()
  if (!base) return handler(req)

  const url = new URL(req.url)
  if (!url.pathname.startsWith(base)) {
    url.pathname = `${base}${url.pathname}`
  }

  const headers = new Headers(req.headers)
  if (!headers.get("x-forwarded-host")) {
    headers.set("x-forwarded-host", headers.get("host") || url.host)
  }
  if (!headers.get("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", "https")
  }

  const init: ConstructorParameters<typeof NextRequest>[1] = {
    method: req.method,
    headers,
  }

  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    Object.assign(init, { body: req.body, duplex: "half" })
  }

  try {
    return await handler(new NextRequest(url, init))
  } catch (err) {
    console.error("[auth] handler error:", err)
    return NextResponse.json(
      {
        error: "AuthHandlerError",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  return withBasePath(req, handlers.GET)
}

export async function POST(req: NextRequest) {
  return withBasePath(req, handlers.POST)
}
