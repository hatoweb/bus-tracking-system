"use client"

import { signOut, useSession } from "next-auth/react"
import {
  LogOut,
  MapPin,
  CheckCircle2,
  ShieldCheck,
  Loader2,
} from "lucide-react"
import { apiUrl } from "@/lib/base-path"

export type UserProfile = {
  name: string
  email: string
  picture?: string
  lat?: number
  lng?: number
  locationShared: boolean
}

type GoogleAuthModalProps = {
  isOpen: boolean
  onClose: () => void
  user: UserProfile | null
  onLogout: () => void
  onShareLocation: () => void
}

export function GoogleAuthModal({
  isOpen,
  onClose,
  user,
  onLogout,
  onShareLocation,
}: GoogleAuthModalProps) {
  const { status } = useSession()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-bold text-card-foreground">
              Tu cuenta GeoBus
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-xs font-bold text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>

        <div className="my-4 flex flex-col gap-4">
          {status === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando sesión…
            </div>
          ) : user ? (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-center">
              {user.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.picture}
                  alt={user.name}
                  className="mx-auto h-12 w-12 rounded-full border-2 border-primary object-cover shadow-md"
                />
              ) : (
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground shadow-md">
                  {user.name.charAt(0)}
                </div>
              )}
              <div>
                <p className="text-sm font-bold text-card-foreground">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
                <span className="mt-1 inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                  Sesión con Google
                </span>
              </div>

              <div className="mt-2 rounded-lg border border-border bg-card p-2.5 text-left text-xs">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <MapPin
                      className={`h-4 w-4 ${
                        user.locationShared
                          ? "text-status-moving"
                          : "text-muted-foreground"
                      }`}
                    />
                    Ubicación en vivo:
                  </span>
                  {user.locationShared ? (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-status-moving">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Compartida
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      No compartida
                    </span>
                  )}
                </div>
                {user.lat != null && user.lng != null && (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    GPS: {user.lat.toFixed(4)}, {user.lng.toFixed(4)}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-2">
                {!user.locationShared && (
                  <button
                    type="button"
                    onClick={onShareLocation}
                    className="flex items-center justify-center gap-2 rounded-xl bg-status-moving px-4 py-2.5 text-xs font-bold text-card shadow-md transition-all hover:opacity-90"
                  >
                    <MapPin className="h-4 w-4" />
                    Compartir Mi Ubicación Ahora
                  </button>
                )}

                <button
                  type="button"
                  onClick={async () => {
                    onLogout()
                    await signOut({
                      callbackUrl: apiUrl("/login"),
                    })
                  }}
                  className="flex items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Cerrar sesión
                </button>
              </div>
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No hay sesión activa. Vas a ser redirigido al login…
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-muted py-2 text-xs font-semibold text-foreground hover:bg-muted/80"
        >
          Cerrar
        </button>
      </div>
    </div>
  )
}
