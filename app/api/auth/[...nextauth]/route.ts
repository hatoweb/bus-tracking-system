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
  // Ayuda a Auth.js detrás de nginx
  if (!headers.get("x-forwarded-host")) {
    headers.set("x-forwarded-host", headers.get("host") || url.host)
  }
  if (!headers.get("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", url.protocol.replace(":", "") || "https")
  }

  const patched = new NextRequest(url, {
    method: req.method,
    headers,
    body: req.body,
    duplex: "half",
  } as RequestInit & { duplex?: string })

  return handler(patched)
}

export async function GET(req: NextRequest) {
  return withBasePath(req, handlers.GET)
}

export async function POST(req: NextRequest) {
  return withBasePath(req, handlers.POST)
}
