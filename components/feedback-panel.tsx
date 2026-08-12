"use client"

import { useState, useEffect } from "react"
import {
  MessageSquare,
  Send,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Sparkles,
  Bus,
  Phone,
  User,
  FileText,
  Clock,
  History
} from "lucide-react"
import { apiUrl } from "@/lib/base-path"

type FeedbackType = "reclamo" | "sugerencia" | "consulta" | "reporte_bus"

type ReclamoItem = {
  id_reclamo: number
  ticket_num: string
  usuario_email: string
  usuario_nombre: string
  tipo: string
  linea_empresa: string
  mensaje: string
  estado: string
  respuesta: string | null
  fecha_creacion: string
  fecha_respuesta?: string
}

type FeedbackPanelProps = {
  userEmail?: string
  userName?: string
}

export function FeedbackPanel({ userEmail, userName }: FeedbackPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<"nuevo" | "historial">("nuevo")
  const [type, setType] = useState<FeedbackType>("reclamo")
  const [nombre, setNombre] = useState(userName || "")
  const [contacto, setContacto] = useState(userEmail || "")
  const [linea, setLinea] = useState("")
  const [mensaje, setMensaje] = useState("")
  const [submittedTicket, setSubmittedTicket] = useState<ReclamoItem | null>(null)
  const [loading, setLoading] = useState(false)

  const [historial, setHistorial] = useState<ReclamoItem[]>([])
  const [loadingHistorial, setLoadingHistorial] = useState(false)

  // Sincronizar con props del usuario si cambian
  useEffect(() => {
    if (userName) setNombre(userName)
    if (userEmail) setContacto(userEmail)
  }, [userName, userEmail])

  // Cargar historial de reclamos de la BD CID
  const fetchHistorial = async () => {
    setLoadingHistorial(true)
    try {
      const url = contacto
        ? apiUrl(`/api/reclamos?email=${encodeURIComponent(contacto)}`)
        : apiUrl("/api/reclamos")
      const res = await fetch(url)
      const data = await res.json()
      if (data.success && data.data) {
        setHistorial(data.data)
      }
    } catch (err) {
      console.error("Error al obtener historial de reclamos:", err)
    } finally {
      setLoadingHistorial(false)
    }
  }

  useEffect(() => {
    if (activeSubTab === "historial") {
      fetchHistorial()
    }
  }, [activeSubTab, contacto])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mensaje.trim()) return

    setLoading(true)
    try {
      const res = await fetch(apiUrl("/api/reclamos"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario_email: contacto || "anonimo@geobus.py",
          usuario_nombre: nombre || "Usuario GeoBus",
          tipo,
          linea_empresa: linea || "General",
          mensaje,
        }),
      })
      const data = await res.json()
      if (data.success && data.data) {
        setSubmittedTicket(data.data)
      }
    } catch (err) {
      console.error("Error registrando reclamo:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setSubmittedTicket(null)
    setMensaje("")
    setLinea("")
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header del canal de comunicación */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
          <MessageSquare className="h-5 w-5" />
        </div>
        <h2 className="text-sm font-bold text-card-foreground">Canal de Reclamos y Atención (BD CID)</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Envía tus reclamos o consultas almacenadas directamente en la base de datos oficial del VMT.
        </p>

        {/* Sub-navegación: Nuevo Reclamo vs Historial */}
        <div className="mt-3 flex rounded-lg border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setActiveSubTab("nuevo")}
            className={`flex-1 rounded-md py-1.5 text-xs font-bold transition-all ${
              activeSubTab === "nuevo"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Nuevo Mensaje
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("historial")}
            className={`flex-1 rounded-md py-1.5 text-xs font-bold transition-all ${
              activeSubTab === "historial"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Historial y Respuestas
          </button>
        </div>
      </div>

      {activeSubTab === "nuevo" ? (
        submittedTicket ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-status-moving/30 bg-status-moving/10 p-6 text-center animate-in fade-in zoom-in duration-300">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-moving text-card shadow-lg">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-card-foreground">¡Reclamo Guardado en BD CID!</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Hemos registrado tu reporte en el schema <strong>reclamos</strong> de la base de datos.
              </p>
              <div className="mt-3 flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left text-[11px] text-muted-foreground shadow-sm">
                <p><strong>N° de Ticket:</strong> #{submittedTicket.ticket_num}</p>
                <p><strong>Tipo:</strong> {submittedTicket.tipo.toUpperCase()}</p>
                <p><strong>Estado:</strong> <span className="font-bold text-status-moving">{submittedTicket.estado.toUpperCase()}</span></p>
                {submittedTicket.respuesta && (
                  <div className="mt-2 rounded bg-muted/60 p-2 text-foreground">
                    <p className="font-bold text-primary">Respuesta Oficial Generada:</p>
                    <p className="italic">"{submittedTicket.respuesta}"</p>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="mt-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Enviar otro mensaje
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* Tipo de Feedback */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-card-foreground">
                ¿Qué deseas enviar?
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setType("reclamo")}
                  className={`flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs font-medium transition-all ${
                    type === "reclamo"
                      ? "border-destructive bg-destructive/10 text-destructive font-bold shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Reclamo
                </button>

                <button
                  type="button"
                  onClick={() => setType("sugerencia")}
                  className={`flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs font-medium transition-all ${
                    type === "sugerencia"
                      ? "border-primary bg-primary/10 text-primary font-bold shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Sparkles className="h-4 w-4 shrink-0" />
                  Sugerencia
                </button>

                <button
                  type="button"
                  onClick={() => setType("consulta")}
                  className={`flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs font-medium transition-all ${
                    type === "consulta"
                      ? "border-status-near bg-status-near/10 text-foreground font-bold shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <HelpCircle className="h-4 w-4 shrink-0" />
                  Consulta
                </button>

                <button
                  type="button"
                  onClick={() => setType("reporte_bus")}
                  className={`flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs font-medium transition-all ${
                    type === "reporte_bus"
                      ? "border-status-moving bg-status-moving/10 text-foreground font-bold shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Bus className="h-4 w-4 shrink-0" />
                  Incidencia Bus
                </button>
              </div>
            </div>

            {/* Nombre */}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-card-foreground">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                Nombre y Apellido
              </label>
              <input
                type="text"
                placeholder="Ej. Juan Pérez"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full rounded-lg border border-input bg-background p-2 text-xs font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Teléfono / Email */}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-card-foreground">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                Teléfono o Correo de Contacto
              </label>
              <input
                type="text"
                placeholder="Ej. usuario@ejemplo.com"
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                className="w-full rounded-lg border border-input bg-background p-2 text-xs font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Línea / Empresa Afectada */}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-card-foreground">
                <Bus className="h-3.5 w-3.5 text-muted-foreground" />
                Línea o Empresa Afectada
              </label>
              <input
                type="text"
                placeholder="Ej. Línea 12 - Magno SA"
                value={linea}
                onChange={(e) => setLinea(e.target.value)}
                className="w-full rounded-lg border border-input bg-background p-2 text-xs font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Mensaje / Descripción */}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-card-foreground">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                Detalle del reclamo / consulta <span className="text-destructive">*</span>
              </label>
              <textarea
                required
                rows={3}
                placeholder="Describe detalladamente lo sucedido..."
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                className="w-full rounded-lg border border-input bg-background p-2 text-xs font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Botón Enviar */}
            <button
              type="submit"
              disabled={loading || !mensaje.trim()}
              className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground shadow-md transition-all hover:opacity-90 disabled:opacity-50"
            >
              {loading ? (
                <span>Guardando en BD CID...</span>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Enviar y Registrar Reclamo
                </>
              )}
            </button>
          </form>
        )
      ) : (
        /* Historial de Reclamos */
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Reclamos en BD CID ({historial.length})
            </h3>
            <button
              type="button"
              onClick={fetchHistorial}
              className="text-[11px] font-semibold text-primary hover:underline"
            >
              Actualizar
            </button>
          </div>

          {loadingHistorial ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Cargando historial de la base de datos...
            </p>
          ) : historial.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No se han encontrado reclamos registrados para este usuario.
            </p>
          ) : (
            historial.map((item) => (
              <div
                key={item.id_reclamo || item.ticket_num}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm transition-all hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                      #{item.ticket_num}
                    </span>
                    <span className="ml-2 rounded bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {item.tipo}
                    </span>
                    <p className="mt-1 text-xs font-bold text-card-foreground">
                      {item.linea_empresa}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-status-moving/20 px-2 py-0.5 text-[10px] font-bold text-status-moving">
                    {item.estado.toUpperCase()}
                  </span>
                </div>

                <p className="text-xs text-foreground bg-muted/30 p-2 rounded-md">
                  "{item.mensaje}"
                </p>

                {item.respuesta && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 text-xs">
                    <p className="font-bold text-primary flex items-center gap-1 text-[11px]">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Respuesta VMT:
                    </p>
                    <p className="mt-0.5 text-muted-foreground italic">{item.respuesta}</p>
                  </div>
                )}

                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>{new Date(item.fecha_creacion).toLocaleString("es-ES")}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
