import { NextRequest } from "next/server"
import { handlers } from "@/auth"
import { getBasePath } from "@/lib/base-path"

/**
 * Next.js quita el basePath del request interno.
 * Auth.js necesita ver /{basePath}/api/auth/... para parsear la acción
 * (si no → 400 Bad Request en /session, callback, etc.).
 *
 * @see https://github.com/nextauthjs/next-auth/issues/13034
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
    const proto = url.protocol.replace(":", "") || "https"
    headers.set("x-forwarded-proto", proto === "http" ? "https" : proto)
  }

  const init: ConstructorParameters<typeof NextRequest>[1] = {
    method: req.method,
    headers,
  }

  // Solo reenviar body en POST/PUT/PATCH
  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    ;(init as { body?: BodyInit; duplex?: string }).body = req.body
    ;(init as { duplex?: string }).duplex = "half"
  }

  return handler(new NextRequest(url, init))
}

export async function GET(req: NextRequest) {
  return withBasePath(req, handlers.GET)
}

export async function POST(req: NextRequest) {
  return withBasePath(req, handlers.POST)
}
