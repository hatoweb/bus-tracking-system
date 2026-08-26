"use client"

import { signIn } from "next-auth/react"
import { Bus, ShieldCheck } from "lucide-react"
import { getBasePath } from "@/lib/base-path"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

function LoginInner() {
  const search = useSearchParams()
  const error = search.get("error")
  const callbackUrl = search.get("callbackUrl") || `${getBasePath() || ""}/` || "/"

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-slate-100 via-sky-50 to-emerald-50 px-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl">
        <div className="bg-slate-900 px-6 py-8 text-center text-white">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 shadow-lg">
            <Bus className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">GeoBus</h1>
          <p className="mt-1 text-sm text-slate-300">
            Seguimiento de buses en tiempo real
          </p>
        </div>

        <div className="space-y-4 px-6 py-6">
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Iniciá sesión con <strong>Google</strong> para sincronizar tus favoritos en la nube, o continuá directamente como invitado.
            </p>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              No se pudo iniciar sesión
              {error === "Configuration"
                ? ": error de configuración OAuth. Verificá AUTH_* en el .env y que el Redirect URI en Google sea exactamente https://sistemas.mopc.gov.py/prototipo_vmt/api/auth/callback/google"
                : error === "AccessDenied"
                  ? ": acceso denegado."
                  : error === "OAuthCallback" || error === "Callback"
                    ? ": falló el retorno desde Google (revisá Redirect URI y AUTH_URL)."
                    : `. (${error})`}
            </p>
          )}

          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl })}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <GoogleIcon />
            Continuar con Google
          </button>

          <div className="relative my-2 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <span className="relative bg-white px-3 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              o bien
            </span>
          </div>

          <a
            href={callbackUrl}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50/50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            Continuar como invitado (Sin registro)
          </a>

          <p className="text-center text-[11px] text-slate-500">
            En modo invitado tus preferencias y paradas favoritas se guardan únicamente en la memoria de este dispositivo.
          </p>
        </div>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l.1.1 6.2 5.2C39.2 36.3 44 31 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center text-sm text-slate-500">
          Cargando…
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  )
}
