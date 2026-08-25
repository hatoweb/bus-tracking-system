import { NextRequest, NextResponse } from "next/server"
import { handlers } from "@/auth"
import { authConfigStatus } from "@/auth"
import { getBasePath } from "@/lib/base-path"

/**
 * Next quita /prototipo_vmt del pathname interno.
 * Auth.js necesita ver el prefijo o responde 400/500.
 */
async function withBasePath(
  req: NextRequest,
  handler: (req: NextRequest) => Promise<Response>
) {
  const base = getBasePath()
  const url = new URL(req.url)

  if (base && !url.pathname.startsWith(base)) {
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

  return handler(new NextRequest(url, init))
}

function isSessionRequest(req: NextRequest): boolean {
  return req.nextUrl.pathname.endsWith("/session") || req.url.includes("/session")
}

export async function GET(req: NextRequest) {
  try {
    const res = await withBasePath(req, handlers.GET)

    // Si Auth.js falla por Configuration, no tumbar la página de login:
    // devolver sesión vacía y dejar traza en logs + header de diagnóstico.
    if (res.status >= 400 && isSessionRequest(req)) {
      const cfg = authConfigStatus()
      const body = await res.text().catch(() => "")
      console.error("[auth] session failed", res.status, body.slice(0, 500), cfg)
      return NextResponse.json(null, {
        status: 200,
        headers: {
          "x-auth-fallback": "empty-session",
          "x-auth-ready": cfg.hasSecret && cfg.hasGoogleId && cfg.hasGoogleSecret
            ? "1"
            : "0",
        },
      })
    }

    return res
  } catch (err) {
    console.error("[auth] GET exception:", err)
    if (isSessionRequest(req)) {
      return NextResponse.json(null, { status: 200 })
    }
    return NextResponse.json(
      {
        error: "AuthHandlerError",
        message: err instanceof Error ? err.message : String(err),
        auth: authConfigStatus(),
      },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    return await withBasePath(req, handlers.POST)
  } catch (err) {
    console.error("[auth] POST exception:", err)
    return NextResponse.json(
      {
        error: "AuthHandlerError",
        message: err instanceof Error ? err.message : String(err),
        auth: authConfigStatus(),
      },
      { status: 500 }
    )
  }
}
