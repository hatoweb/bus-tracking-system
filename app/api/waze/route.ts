import { NextRequest, NextResponse } from "next/server"
import { getWazeLiveData } from "@/lib/waze-service"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const municipio = searchParams.get("municipio")

    const data = await getWazeLiveData(municipio)

    return NextResponse.json({
      success: true,
      countAlerts: data.alerts.length,
      countJams: data.jams.length,
      data,
    })
  } catch (error: any) {
    console.error("Error en endpoint /api/waze:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error al obtener datos de Waze",
      },
      { status: 500 }
    )
  }
}
