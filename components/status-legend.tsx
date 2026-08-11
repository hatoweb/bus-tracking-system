import { STATUS_DESCRIPTION, STATUS_LABEL, type BusStatus } from "@/lib/transit-data"

const ORDER: BusStatus[] = ["stopped", "moving", "near", "arrival"]

const COLOR_CLASS: Record<BusStatus, string> = {
  stopped: "bg-status-stopped",
  moving: "bg-status-moving",
  near: "bg-status-near",
  arrival: "bg-status-arrival",
}

export function StatusLegend() {
  return (
    <ul className="grid grid-cols-2 gap-2" aria-label="Leyenda de estados GPS">
      {ORDER.map((status) => (
        <li
          key={status}
          className="flex items-start gap-2 rounded-lg border border-border bg-card p-2"
        >
          <span
            className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${COLOR_CLASS[status]}`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-tight text-card-foreground">
              {STATUS_LABEL[status]}
            </p>
            <p className="text-[11px] leading-tight text-muted-foreground">
              {STATUS_DESCRIPTION[status]}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
