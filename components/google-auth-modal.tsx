"use client"

import { useState, useEffect, useRef } from "react"
import { LogOut, MapPin, CheckCircle2, ShieldCheck, Settings, Key } from "lucide-react"

declare global {
  interface Window {
    google: any
  }
}

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
  onLogin: (user: UserProfile) => void
  onLogout: () => void
  onShareLocation: () => void
}

// Client ID por defecto (o configurable vía NEXT_PUBLIC_GOOGLE_CLIENT_ID)
const DEFAULT_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "1028394829304-example.apps.googleusercontent.com"

export function GoogleAuthModal({
  isOpen,
  onClose,
  user,
  onLogin,
  onLogout,
  onShareLocation,
}: GoogleAuthModalProps) {
  const googleBtnRef = useRef<HTMLDivElement>(null)
  const [clientId, setClientId] = useState<string>(DEFAULT_CLIENT_ID)
  const [showConfig, setShowConfig] = useState(false)
  const [customClientIdInput, setCustomClientIdInput] = useState("")

  useEffect(() => {
    if (!isOpen || user) return

    const scriptId = "google-gsi-client"
    let script = document.getElementById(scriptId) as HTMLScriptElement

    const handleCredentialResponse = (response: any) => {
      if (!response || !response.credential) return
      try {
        const token = response.credential
        const base64Url = token.split(".")[1]
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/")
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split("")
            .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
            .join("")
        )
        const payload = JSON.parse(jsonPayload)

        onLogin({
          name: payload.name || payload.given_name || "Usuario Google",
          email: payload.email || "",
          picture: payload.picture || "",
          locationShared: false,
        })
      } catch (err) {
        console.error("Error decodificando token de Google:", err)
      }
    }

    const initGoogleGSI = () => {
      if (window.google?.accounts?.id && googleBtnRef.current) {
        try {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: handleCredentialResponse,
            auto_select: false,
          })

          googleBtnRef.current.innerHTML = ""
          window.google.accounts.id.renderButton(googleBtnRef.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "signin_with",
            shape: "rectangular",
            logo_alignment: "left",
            width: "280",
          })
        } catch (e) {
          console.error("Error inicializando Google Identity Services:", e)
        }
      }
    }

    if (!script) {
      script = document.createElement("script")
      script.id = scriptId
      script.src = "https://accounts.google.com/gsi/client"
      script.async = true
      script.defer = true
      script.onload = initGoogleGSI
      document.body.appendChild(script)
    } else {
      initGoogleGSI()
    }
  }, [isOpen, user, clientId, onLogin])

  if (!isOpen) return null

  const handleSaveCustomClientId = (e: React.FormEvent) => {
    e.preventDefault()
    if (customClientIdInput.trim()) {
      setClientId(customClientIdInput.trim())
      setShowConfig(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-bold text-card-foreground">Autenticación Real con Google</h2>
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
          {user ? (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-center">
              {user.picture ? (
                <img
                  src={user.picture}
                  alt={user.name}
                  className="mx-auto h-12 w-12 rounded-full border-2 border-primary object-cover shadow-md"
                />
              ) : (
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg shadow-md">
                  {user.name.charAt(0)}
                </div>
              )}
              <div>
                <p className="text-sm font-bold text-card-foreground">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
                <span className="mt-1 inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                  Autenticado con Google OAuth
                </span>
              </div>

              {/* Estado de la ubicación */}
              <div className="mt-2 rounded-lg border border-border bg-card p-2.5 text-left text-xs">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <MapPin className={`h-4 w-4 ${user.locationShared ? "text-status-moving" : "text-muted-foreground"}`} />
                    Ubicación en vivo:
                  </span>
                  {user.locationShared ? (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-status-moving">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Compartida
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">No compartida</span>
                  )}
                </div>
                {user.lat && user.lng && (
                  <p className="mt-1 text-[10px] font-mono text-muted-foreground">
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
                  onClick={onLogout}
                  className="flex items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Cerrar Sesión Google
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-center">
              <p className="text-xs text-muted-foreground">
                Inicia sesión con tu cuenta de Google real para acceder con tus credenciales oficiales de Google.
              </p>

              {/* Contenedor del Botón Oficial de Google Identity Services */}
              <div className="my-2 flex justify-center">
                <div ref={googleBtnRef} className="min-h-[40px]" />
              </div>

              <div className="relative my-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Google OAuth 2.0 SSL</span>
                </div>
              </div>

              {/* Opción para ajustar Google Client ID si es necesario */}
              <button
                type="button"
                onClick={() => setShowConfig(!showConfig)}
                className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-3.5 w-3.5" />
                Configuración Google Client ID (Opcional)
              </button>

              {showConfig && (
                <form onSubmit={handleSaveCustomClientId} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-left text-xs">
                  <label className="font-semibold text-foreground flex items-center gap-1">
                    <Key className="h-3.5 w-3.5 text-primary" />
                    Google OAuth Client ID:
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. 123456...apps.googleusercontent.com"
                    value={customClientIdInput}
                    onChange={(e) => setCustomClientIdInput(e.target.value)}
                    className="w-full rounded border border-input bg-background p-1.5 text-[11px] font-mono text-foreground"
                  />
                  <button
                    type="submit"
                    className="rounded bg-primary py-1 text-[11px] font-bold text-primary-foreground"
                  >
                    Guardar Client ID
                  </button>
                </form>
              )}
            </div>
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
