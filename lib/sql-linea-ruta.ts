/**
 * Línea comercial ya no vive en catalogo_rutas.linea.
 * Se obtiene por la malla vigente: linea_ruta_catalogo → lineas.numero_linea
 *
 * @param rutaAlias alias de catalogo_rutas (ej. "r", "cr")
 * @param lrcAlias alias de linea_ruta_catalogo
 * @param lineaAlias alias de lineas
 */
export function sqlJoinLineaVigente(
  rutaAlias = "cr",
  lrcAlias = "lrc",
  lineaAlias = "ln"
): string {
  return `
  LEFT JOIN public.linea_ruta_catalogo ${lrcAlias}
    ON LOWER(TRIM(${lrcAlias}.ruta_hex)) = LOWER(TRIM(${rutaAlias}.ruta_hex))
   AND ${lrcAlias}.fecha_inicio <= CURRENT_DATE
   AND (${lrcAlias}.fecha_fin IS NULL OR ${lrcAlias}.fecha_fin >= CURRENT_DATE)
  LEFT JOIN public.lineas ${lineaAlias}
    ON ${lineaAlias}.id_linea = ${lrcAlias}.id_linea
`
}

/** Expresión SQL del número de línea comercial */
export function sqlNumeroLinea(lineaAlias = "ln"): string {
  return `CAST(${lineaAlias}.numero_linea AS text)`
}
