import { existsSync } from 'fs'
import { Pool } from 'pg'

function env(name: string, fallback = ''): string {
  return (process.env[name] || fallback).trim()
}

function inDocker(): boolean {
  try {
    return existsSync('/.dockerenv')
  } catch {
    return false
  }
}

function missingDbVars(prefix: 'CID' | 'GPS'): string[] {
  const keys = [
    `DB_${prefix}_HOST`,
    `DB_${prefix}_USER`,
    `DB_${prefix}_PASSWORD`,
    `DB_${prefix}_NAME`,
  ]
  return keys.filter((k) => !env(k))
}

function localhostInContainer(host: string): boolean {
  return (
    inDocker() &&
    ['127.0.0.1', 'localhost', '::1', ''].includes(host.toLowerCase())
  )
}

export function cidConfigError(): string | null {
  const missing = missingDbVars('CID')
  if (missing.length > 0) {
    return `Faltan variables en .env: ${missing.join(', ')}. Completá el .env del servidor (no uses 127.0.0.1 dentro de Docker).`
  }
  if (localhostInContainer(env('DB_CID_HOST'))) {
    return 'DB_CID_HOST apunta a localhost dentro del contenedor. Usá el host/IP real de CID (el mismo de .env.local).'
  }
  return null
}

export function gpsConfigError(): string | null {
  const missing = missingDbVars('GPS')
  if (missing.length > 0) {
    return `Faltan variables en .env: ${missing.join(', ')}.`
  }
  if (localhostInContainer(env('DB_GPS_HOST'))) {
    return 'DB_GPS_HOST apunta a localhost dentro del contenedor. Usá el host/IP real de GPS.'
  }
  return null
}

export const poolCID = new Pool({
  host: env('DB_CID_HOST'),
  port: parseInt(env('DB_CID_PORT', '5432'), 10),
  user: env('DB_CID_USER'),
  password: env('DB_CID_PASSWORD'),
  database: env('DB_CID_NAME'),
  ssl: process.env.DB_CID_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

export const poolGPS = new Pool({
  host: env('DB_GPS_HOST'),
  port: parseInt(env('DB_GPS_PORT', '5432'), 10),
  user: env('DB_GPS_USER'),
  password: env('DB_GPS_PASSWORD'),
  database: env('DB_GPS_NAME'),
  ssl:
    process.env.DB_GPS_SSL === 'false'
      ? false
      : env('DB_GPS_HOST')
        ? { rejectUnauthorized: false }
        : false,
})
