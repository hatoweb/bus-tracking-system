import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

/**
 * Auth.js + Google con next.config basePath=/prototipo_vmt
 *
 * Next.js quita el basePath del request interno → hay que:
 *  1) Declarar basePath: /prototipo_vmt/api/auth en Auth.js
 *  2) Reinyectar ese prefijo en app/api/auth/[...nextauth]/route.ts
 *
 * AUTH_* se leen en runtime (no capturar en build).
 * @see https://github.com/nextauthjs/next-auth/issues/13034
 */
function appBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_BASE_PATH || process.env.BASE_PATH || ""
  if (!raw || raw === "/") return ""
  return raw.endsWith("/") ? raw.slice(0, -1) : raw
}

function authBasePath(): string {
  const base = appBase()
  return base ? `${base}/api/auth` : "/api/auth"
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
    authBasePath: authBasePath(),
    appBase: appBase() || "/",
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const base = appBase()
  const authPath = authBasePath()

  return {
    basePath: authPath,
    trustHost: true,
    // Auth.js toma AUTH_SECRET / AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET del env
    providers: [Google],
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
