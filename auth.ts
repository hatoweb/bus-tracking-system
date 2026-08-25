import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

/**
 * Auth.js (next-auth v5) + Google / Gmail.
 * Con next.config basePath, las rutas quedan en {basePath}/api/auth/*.
 * Definí AUTH_URL con el path completo, ej:
 *   AUTH_URL=https://sistemas.mopc.gov.py/prototipo_vmt
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID,
      clientSecret:
        process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "select_account",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    authorized({ auth: session, request }) {
      const path = request.nextUrl.pathname
      const isPublic =
        path.includes("/login") ||
        path.includes("/api/auth") ||
        path.includes("/api/health") ||
        path.includes("/favicon") ||
        path.includes("/icon")

      if (isPublic) return true
      return !!session
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
