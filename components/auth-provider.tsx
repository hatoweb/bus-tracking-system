"use client"

import { SessionProvider } from "next-auth/react"
import { getBasePath } from "@/lib/base-path"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const base = getBasePath()
  // URL pública que ve el browser (con prefijo /prototipo_vmt)
  const authBase = base ? `${base}/api/auth` : "/api/auth"
  return (
    <SessionProvider basePath={authBase} refetchOnWindowFocus>
      {children}
    </SessionProvider>
  )
}
