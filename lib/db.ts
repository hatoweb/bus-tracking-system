import { Pool } from 'pg'

function env(name: string, fallback = ''): string {
  return process.env[name] || fallback
}

// Conexión 1: BD BBDD_CID (Itinerarios)
// Credenciales solo por variables de entorno (.env / .env.local)
export const poolCID = new Pool({
  host: env('DB_CID_HOST', '127.0.0.1'),
  port: parseInt(env('DB_CID_PORT', '5432'), 10),
  user: env('DB_CID_USER'),
  password: env('DB_CID_PASSWORD'),
  database: env('DB_CID_NAME'),
  ssl: process.env.DB_CID_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

// Conexión 2: BD GPS (Posiciones)
export const poolGPS = new Pool({
  host: env('DB_GPS_HOST', '127.0.0.1'),
  port: parseInt(env('DB_GPS_PORT', '5432'), 10),
  user: env('DB_GPS_USER'),
  password: env('DB_GPS_PASSWORD'),
  database: env('DB_GPS_NAME'),
  ssl:
    process.env.DB_GPS_SSL === 'false'
      ? false
      : process.env.DB_GPS_HOST
        ? { rejectUnauthorized: false }
        : false,
})
