import { ArrowRight, Clock, Repeat } from "lucide-react"
import { SCHEDULE, type ScheduleEntry } from "@/lib/transit-data"

const STATUS_STYLE: Record<ScheduleEntry["status"], { label: string; className: string }> = {
  "en-curso": { label: "En curso", className: "bg-status-moving text-card" },
  programado: { label: "Programado", className: "bg-primary text-primary-foreground" },
  finalizado: { label: "Finalizado", className: "bg-muted text-muted-foreground" },
  retrasado: { label: "Retrasado", className: "bg-status-stopped text-card" },
}

export function SchedulePanel() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Salidas planificadas de la línea L1 para la jornada de hoy.
      </p>
      <ul className="flex flex-col gap-2" aria-label="Programación operativa">
        {SCHEDULE.map((entry) => {
          const style = STATUS_STYLE[entry.status]
          return (
            <li
              key={entry.id}
              className="rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
                  <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span>{entry.departure}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span>{entry.arrival}</span>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${style.className}`}
                >
                  {style.label}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                Frecuencia {entry.frequency}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
