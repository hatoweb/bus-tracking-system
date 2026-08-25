"use client"

import { SessionProvider } from "next-auth/react"
import { getBasePath } from "@/lib/base-path"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const base = getBasePath()
  // Con next.config basePath, Auth.js vive en {basePath}/api/auth
  const authBase = base ? `${base}/api/auth` : "/api/auth"
  return (
    <SessionProvider
      basePath={authBase}
      refetchInterval={5 * 60}
      refetchOnWindowFocus
    >
      {children}
    </SessionProvider>
  )
}
