/**
 * Vigencia real de geometria.historico_itinerario por fechas.
 * No alcanza con h.vigente: hay que respetar inicio/fin a la fecha consultada.
 *
 * @param alias alias de historico_itinerario (ej. "h", "hi")
 * @param dateExpr expresión SQL de fecha (default CURRENT_DATE)
 */
export function sqlItinerarioVigenteEnFecha(
  alias = "h",
  dateExpr = "CURRENT_DATE"
): string {
  return `
    ${alias}.fecha_inicio_vigencia IS NOT NULL
    AND ${alias}.fecha_inicio_vigencia <= (${dateExpr})::date
    AND (
      ${alias}.fecha_fin_vigencia IS NULL
      OR ${alias}.fecha_fin_vigencia >= (${dateExpr})::date
    )
  `
}
