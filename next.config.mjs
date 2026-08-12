/** @type {import('next').NextConfig} */
const rawBase =
  process.env.BASE_PATH ||
  process.env.NEXT_PUBLIC_BASE_PATH ||
  ""
const basePath =
  rawBase && rawBase !== "/"
    ? rawBase.endsWith("/")
      ? rawBase.slice(0, -1)
      : rawBase
    : ""

const nextConfig = {
  ...(process.env.CAPACITOR_BUILD === "true"
    ? { output: "export" }
    : { output: "standalone" }),
  ...(basePath ? { basePath } : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Exponer el mismo valor al cliente para fetch('/api/...')
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
}

export default nextConfig
