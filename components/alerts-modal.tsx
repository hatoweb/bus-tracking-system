"use client"

import { AlertTriangle, CloudRain, CalendarClock, Route, Info, Bell, CheckCircle2 } from "lucide-react"

export type OperationalAlert = {
  id: string
  type: "desvio" | "retraso" | "feriado" | "clima" | "info"
  title: string
  description: string
  lines?: string
  timestamp: string
  severity: "low" | "medium" | "high"
}

const INITIAL_ALERTS: OperationalAlert[] = [
  {
    id: "alt-1",
    type: "clima",
    title: "Alerta Meteorológica: Lluvia intensa",
    description: "Servicios con marcha precavida por raudales en zona Av. Eusebio Ayala y Mcal. López. Posibles demoras de 10-15 min.",
    lines: "Todas las líneas",
    timestamp: "Hace 15 min",
    severity: "high",
  },
  {
    id: "alt-2",
    type: "desvio",
    title: "Desvío Operativo por Obras",
    description: "Desvío temporal en tramo San Lorenzo por reparación de asfalto. Las unidades tomarán la calle paralela Julia Miranda Cueto.",
    lines: "Líneas 12, 27, 49",
    timestamp: "Hace 1 hora",
    severity: "medium",
  },
  {
    id: "alt-3",
    type: "feriado",
    title: "Reducción de Servicios por Feriado Nacional",
    description: "Se informa que el día de mañana la frecuencia de buses operará en esquema de día domingo/feriado (intervalos de 20 min).",
    lines: "Servicio Urbano e Interurbano",
    timestamp: "Hoy, 08:00 hs",
    severity: "low",
  },
]

type AlertsModalProps = {
  isOpen: boolean
  onClose: () => void
}

export function AlertsModal({ isOpen, onClose }: AlertsModalProps) {
  if (!isOpen) return null

  const getAlertIcon = (type: OperationalAlert["type"]) => {
    switch (type) {
      case "clima":
        return <CloudRain className="h-4 w-4 text-blue-500" />
      case "desvio":
        return <Route className="h-4 w-4 text-amber-500" />
      case "feriado":
        return <CalendarClock className="h-4 w-4 text-purple-500" />
      case "retraso":
        return <AlertTriangle className="h-4 w-4 text-destructive" />
      default:
        return <Info className="h-4 w-4 text-primary" />
    }
  }

  const getSeverityBadge = (severity: OperationalAlert["severity"]) => {
    switch (severity) {
      case "high":
        return <span className="rounded bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">Alta Prioridad</span>
      case "medium":
        return <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">Atención</span>
      default:
        return <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">Informativo</span>
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <Bell className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-card-foreground">Alertas del Servicio</h2>
              <p className="text-[11px] text-muted-foreground">Comunicados oficiales del VMT / CCM</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-xs font-bold text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>

        <div className="my-4 flex max-h-[380px] flex-col gap-3 overflow-y-auto pr-1">
          {INITIAL_ALERTS.map((alert) => (
            <div
              key={alert.id}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm transition-all hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {getAlertIcon(alert.type)}
                  <h3 className="text-xs font-bold text-card-foreground">{alert.title}</h3>
                </div>
                {getSeverityBadge(alert.severity)}
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {alert.description}
              </p>

              <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
                {alert.lines && (
                  <span className="font-semibold text-foreground">
                    Afecta: {alert.lines}
                  </span>
                )}
                <span>{alert.timestamp}</span>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground shadow-md transition-opacity hover:opacity-90"
        >
          Entendido
        </button>
      </div>
    </div>
  )
}
