import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

/**
 * Auth.js v5 + Google.
 *
 * IMPORTANTE: no capturar AUTH_* en constantes al cargar el módulo
 * (en `next build` suelen estar vacías y quedan “horneadas” → 500 Configuration).
 * Auth.js lee solo en runtime:
 *   AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_URL, AUTH_TRUST_HOST
 *
 * Con next.config basePath=/prototipo_vmt, las rutas internas son /api/auth/*
 * (Next quita el prefijo). El cliente usa SessionProvider basePath con el prefijo público.
 */
function appBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_BASE_PATH ||
    process.env.BASE_PATH ||
    ""
  if (!raw || raw === "/") return ""
  return raw.endsWith("/") ? raw.slice(0, -1) : raw
}

export function authConfigStatus() {
  const secret =
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    ""
  const googleId =
    process.env.AUTH_GOOGLE_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    ""
  const googleSecret =
    process.env.AUTH_GOOGLE_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    ""
  return {
    hasSecret: Boolean(secret),
    hasGoogleId: Boolean(googleId),
    hasGoogleSecret: Boolean(googleSecret),
    authUrl:
      process.env.AUTH_URL?.trim() ||
      process.env.NEXTAUTH_URL?.trim() ||
      null,
    authBasePath: "/api/auth",
    appBase: appBase() || "/",
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Dejar que Auth.js tome AUTH_SECRET / AUTH_GOOGLE_* del entorno en runtime
  trustHost: true,
  providers: [Google],
  pages: {
    // Path de la app Next (con basePath lo resuelve el framework en páginas;
    // Auth.js a veces redirige en absoluto → usamos callback redirect)
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      const base = appBase()
      const authUrl = (
        process.env.AUTH_URL ||
        process.env.NEXTAUTH_URL ||
        ""
      ).replace(/\/$/, "")

      const origin = (() => {
        try {
          return authUrl ? new URL(authUrl).origin : baseUrl
        } catch {
          return baseUrl
        }
      })()

      const appRoot = authUrl || `${origin}${base}`

      if (url.startsWith(appRoot)) return url

      if (url.startsWith("/")) {
        // /login → https://host/prototipo_vmt/login
        if (base && url.startsWith(base)) return `${origin}${url}`
        return `${appRoot}${url === "/" ? "" : url}`
      }

      try {
        const u = new URL(url)
        if (u.origin === origin) {
          if (base && !u.pathname.startsWith(base)) {
            u.pathname = `${base}${u.pathname}`
          }
          return u.toString()
        }
      } catch {
        /* ignore */
      }

      return appRoot || baseUrl
    },
    async jwt({ token, profile }) {
      if (profile && "picture" in profile && profile.picture) {
        token.picture = profile.picture as string
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.picture) {
        session.user.image = token.picture as string
      }
      return session
    },
  },
})
