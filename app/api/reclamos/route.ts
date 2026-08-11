import { NextResponse } from "next/server"
import { poolCID } from "@/lib/db"

// Memoria de respaldo en caso de desconexión con la BD PostgreSQL CID remota
const memoryReclamos: any[] = [
  {
    id_reclamo: 1,
    ticket_num: "VMT-849201",
    usuario_email: "ciudadano@ejemplo.com",
    usuario_nombre: "Juan Pérez",
    tipo: "reclamo",
    linea_empresa: "Línea 12 - Magno SA",
    mensaje: "El bus no respetó la parada obligatoria en Av. Mariscal López.",
    estado: "resuelto",
    respuesta: "Se notificó a la empresa operadora Magno SA y se aplicó la sanción administrativa correspondiente.",
    fecha_creacion: new Date(Date.now() - 7200000).toISOString(),
    fecha_respuesta: new Date(Date.now() - 3600000).toISOString(),
  },
]

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get("email")

  try {
    // Intentar consultar en la base de datos CID
    let query = `
      SELECT id_reclamo, ticket_num, usuario_email, usuario_nombre, tipo, linea_empresa, mensaje, estado, respuesta, fecha_creacion, fecha_respuesta 
      FROM reclamos.tb_reclamos
    `
    const queryParams: any[] = []

    if (email) {
      query += ` WHERE usuario_email = $1`
      queryParams.push(email)
    }

    query += ` ORDER BY fecha_creacion DESC LIMIT 50`

    const res = await poolCID.query(query, queryParams)
    return NextResponse.json({ success: true, source: "database", data: res.rows })
  } catch (err: any) {
    console.warn("DB CID Reclamos query error, using fallback memory:", err.message)
    let filtered = memoryReclamos
    if (email) {
      filtered = filtered.filter((r) => r.usuario_email?.toLowerCase() === email.toLowerCase())
    }
    return NextResponse.json({ success: true, source: "memory", data: filtered })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { usuario_email, usuario_nombre, tipo, linea_empresa, mensaje } = body

    if (!mensaje || !mensaje.trim()) {
      return NextResponse.json({ success: false, error: "El mensaje es obligatorio" }, { status: 400 })
    }

    const ticketNum = `VMT-${Math.floor(100000 + Math.random() * 900000)}`
    
    // Auto-respuesta inteligente basada en el tipo
    let autoRespuesta = "Hemos registrado tu reporte. Un fiscalizador del VMT lo procesará a la brevedad."
    if (tipo === "reclamo") {
      autoRespuesta = "Tu reclamo ha sido remitido a la Dirección de Fiscalización del VMT. Se verificará la telemetría GPS de la unidad denunciada."
    } else if (tipo === "reporte_bus") {
      autoRespuesta = "Incidencia del bus reportada al Centro de Control de Monitoreo (CCM). Gracias por cooperar con el sistema GeoBus."
    } else if (tipo === "sugerencia") {
      autoRespuesta = "Agradecemos tu sugerencia para mejorar la calidad del transporte público. Será evaluada por el equipo técnico."
    }

    try {
      // Intentar inserción en esquema reclamos de la BD CID
      const insertQuery = `
        INSERT INTO reclamos.tb_reclamos (ticket_num, usuario_email, usuario_nombre, tipo, linea_empresa, mensaje, estado, respuesta, fecha_respuesta)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING *
      `
      const values = [
        ticketNum,
        usuario_email || "anonimo@geobus.py",
        usuario_nombre || "Usuario GeoBus",
        tipo || "reclamo",
        linea_empresa || "General",
        mensaje,
        "resuelto",
        autoRespuesta
      ]

      const dbRes = await poolCID.query(insertQuery, values)
      return NextResponse.json({ success: true, source: "database", data: dbRes.rows[0] })
    } catch (dbErr: any) {
      console.warn("DB CID Insert Error, saving to fallback memory:", dbErr.message)
      const newEntry = {
        id_reclamo: memoryReclamos.length + 1,
        ticket_num: ticketNum,
        usuario_email: usuario_email || "anonimo@geobus.py",
        usuario_nombre: usuario_nombre || "Usuario GeoBus",
        tipo: tipo || "reclamo",
        linea_empresa: linea_empresa || "General",
        mensaje,
        estado: "resuelto",
        respuesta: autoRespuesta,
        fecha_creacion: new Date().toISOString(),
        fecha_respuesta: new Date().toISOString(),
      }
      memoryReclamos.unshift(newEntry)
      return NextResponse.json({ success: true, source: "memory", data: newEntry })
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
