import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBasePath } from "@/lib/base-path"

export default auth((req) => {
  const path = req.nextUrl.pathname
  const base = getBasePath()

  const isPublic =
    path.includes("/login") ||
    path.includes("/api/auth") ||
    path.includes("/api/health") ||
    path.includes("/favicon") ||
    path.includes("/icon") ||
    path.includes("/apple-icon")

  if (isPublic) {
    return NextResponse.next()
  }

  if (req.auth) {
    return NextResponse.next()
  }

  // APIs: JSON 401 (evitar devolver HTML del login a fetch())
  if (path.includes("/api/")) {
    return NextResponse.json(
      { success: false, error: "No autenticado. Iniciá sesión con Google." },
      { status: 401 }
    )
  }

  const login = req.nextUrl.clone()
  login.pathname = `${base}/login`
  login.searchParams.set("callbackUrl", path)
  return NextResponse.redirect(login)
})

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|ico|svg)$).*)",
  ],
}
