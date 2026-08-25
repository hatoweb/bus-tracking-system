import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"
import { getBasePath } from "@/lib/base-path"

/**
 * Protege pantallas (HTML). Las APIs de datos no se bloquean aquí:
 * el acceso al UI exige login; así evitamos 401 por cookies/edge con basePath.
 * /api/auth y /api/health siempre libres.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const base = getBasePath()

  const isPublic =
    path.includes("/login") ||
    path.includes("/api/auth") ||
    path.includes("/api/health") ||
    path.includes("/favicon") ||
    path.includes("/icon") ||
    path.includes("/apple-icon") ||
    path.includes("/api/")

  if (isPublic) {
    return NextResponse.next()
  }

  const secret =
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    ""

  const secure =
    (process.env.AUTH_URL || "").startsWith("https://") ||
    process.env.NODE_ENV === "production"

  const token =
    (await getToken({
      req: request,
      secret,
      cookieName: secure
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
    })) ||
    (await getToken({
      req: request,
      secret,
      cookieName: "authjs.session-token",
    })) ||
    (await getToken({
      req: request,
      secret,
      cookieName: "__Secure-next-auth.session-token",
    })) ||
    (await getToken({
      req: request,
      secret,
      cookieName: "next-auth.session-token",
    }))

  if (!token) {
    const login = request.nextUrl.clone()
    login.pathname = `${base}/login`
    login.searchParams.set("callbackUrl", path.startsWith(base) ? path : `${base}${path}`)
    return NextResponse.redirect(login)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|ico|svg)$).*)",
  ],
}
