/**
 * Prefijo de ruta cuando la app corre bajo un subpath
 * (ej. https://sistemas.mopc.gov.py/prototipo_vmt).
 * Debe coincidir con next.config basePath / env BASE_PATH en el build.
 */
export function getBasePath(): string {
  const raw =
    process.env.NEXT_PUBLIC_BASE_PATH ||
    process.env.BASE_PATH ||
    ""
  if (!raw || raw === "/") return ""
  return raw.endsWith("/") ? raw.slice(0, -1) : raw
}

/** Prefija una ruta interna: apiUrl("/api/empresas") → "/prototipo_vmt/api/empresas" */
export function apiUrl(path: string): string {
  const base = getBasePath()
  if (!path) return base || "/"
  if (path.startsWith("http://") || path.startsWith("https://")) return path
  const normalized = path.startsWith("/") ? path : `/${path}`
  return `${base}${normalized}`
}
