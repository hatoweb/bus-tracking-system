"use client"

import { SessionProvider } from "next-auth/react"
import { getBasePath } from "@/lib/base-path"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const base = getBasePath()
  return (
    <SessionProvider basePath={base ? `${base}/api/auth` : "/api/auth"}>
      {children}
    </SessionProvider>
  )
}
