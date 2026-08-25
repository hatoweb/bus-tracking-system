import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

/**
 * Acceso dinámico a env (evita rarezas de bundling).
 * AUTH_* deben existir en runtime del contenedor (.env / docker-compose).
 */
function env(name: string): string {
  return String(process.env[name] ?? "").trim()
}

function appBase(): string {
  const raw = env("NEXT_PUBLIC_BASE_PATH") || env("BASE_PATH")
  if (!raw || raw === "/") return ""
  return raw.endsWith("/") ? raw.slice(0, -1) : raw
}

function authBasePath(): string {
  const base = appBase()
  return base ? `${base}/api/auth` : "/api/auth"
}

export function authConfigStatus() {
  const secret = env("AUTH_SECRET") || env("NEXTAUTH_SECRET")
  const googleId = env("AUTH_GOOGLE_ID") || env("GOOGLE_CLIENT_ID")
  const googleSecret = env("AUTH_GOOGLE_SECRET") || env("GOOGLE_CLIENT_SECRET")
  return {
    hasSecret: Boolean(secret),
    hasGoogleId: Boolean(googleId),
    hasGoogleSecret: Boolean(googleSecret),
    secretLength: secret.length,
    authUrl: env("AUTH_URL") || env("NEXTAUTH_URL") || null,
    authBasePath: authBasePath(),
    appBase: appBase() || "/",
    trustHost: env("AUTH_TRUST_HOST") || "true (config)",
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const base = appBase()
  const authPath = authBasePath()
  const secret = env("AUTH_SECRET") || env("NEXTAUTH_SECRET")
  const googleId = env("AUTH_GOOGLE_ID") || env("GOOGLE_CLIENT_ID")
  const googleSecret = env("AUTH_GOOGLE_SECRET") || env("GOOGLE_CLIENT_SECRET")

  if (!secret) {
    console.error("[auth] AUTH_SECRET ausente en runtime")
  }
  if (!googleId || !googleSecret) {
    console.error("[auth] AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET ausentes en runtime")
  }

  return {
    basePath: authPath,
    trustHost: true,
    secret: secret || undefined,
    providers: [
      Google({
        clientId: googleId,
        clientSecret: googleSecret,
      }),
    ],
    pages: {
      signIn: base ? `${base}/login` : "/login",
      error: base ? `${base}/login` : "/login",
    },
    session: {
      strategy: "jwt" as const,
      maxAge: 30 * 24 * 60 * 60,
    },
    callbacks: {
      async redirect({ url, baseUrl }) {
        const authUrl = (env("AUTH_URL") || env("NEXTAUTH_URL")).replace(
          /\/$/,
          ""
        )
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
  }
})
