import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import type { NextAuthConfig } from "next-auth"
import { getBasePath } from "@/lib/base-path"

/**
 * Auth.js (next-auth v5) + Google / Gmail.
 *
 * Con next.config basePath=/prototipo_vmt hay que declarar el mismo
 * prefijo en Auth.js y reinyectarlo en la route (ver [...nextauth]/route.ts).
 *
 * .env:
 *   AUTH_SECRET=...
 *   AUTH_TRUST_HOST=true
 *   AUTH_URL=https://sistemas.mopc.gov.py/prototipo_vmt
 *   AUTH_GOOGLE_ID=...
 *   AUTH_GOOGLE_SECRET=...
 */
const appBase = getBasePath()
const authBasePath = appBase ? `${appBase}/api/auth` : "/api/auth"

const googleId =
  process.env.AUTH_GOOGLE_ID?.trim() ||
  process.env.GOOGLE_CLIENT_ID?.trim() ||
  ""
const googleSecret =
  process.env.AUTH_GOOGLE_SECRET?.trim() ||
  process.env.GOOGLE_CLIENT_SECRET?.trim() ||
  ""

const secret =
  process.env.AUTH_SECRET?.trim() ||
  process.env.NEXTAUTH_SECRET?.trim() ||
  ""

export function authConfigStatus() {
  return {
    hasSecret: Boolean(secret),
    hasGoogleId: Boolean(googleId),
    hasGoogleSecret: Boolean(googleSecret),
    authUrl:
      process.env.AUTH_URL?.trim() ||
      process.env.NEXTAUTH_URL?.trim() ||
      null,
    authBasePath,
  }
}

const providers: NextAuthConfig["providers"] = []
if (googleId && googleSecret) {
  providers.push(
    Google({
      clientId: googleId,
      clientSecret: googleSecret,
      authorization: {
        params: {
          prompt: "select_account",
          access_type: "offline",
          response_type: "code",
        },
      },
    })
  )
} else {
  console.warn(
    "[auth] Faltan AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET — el login con Google no estará disponible."
  )
}

if (!secret) {
  console.error(
    "[auth] Falta AUTH_SECRET en el entorno. Generá uno con: openssl rand -base64 32"
  )
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: authBasePath,
  secret: secret || undefined,
  trustHost: true,
  providers,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  callbacks: {
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
