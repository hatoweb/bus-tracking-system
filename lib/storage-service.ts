/**
 * Servicio de persistencia local (localStorage) para GeoBus.
 * Permite guardar preferencias de accesibilidad, paradas/líneas favoritas
 * y búsquedas recientes en el dispositivo del usuario sin requerir cuenta.
 * Totalmente compatible con navegadores web y Capacitor WebView (Android/iOS).
 */

export type AccessibilitySettings = {
  voiceEnabled: boolean
  voiceRate: number
  voiceVolume: number
  needsAccessibility: boolean // filtro de rampa
  proximityAlertsEnabled: boolean
  adaptiveRadiusM: number // 2000m cuando accesibilidad está activa, 1200m por defecto
}

export type FavoriteItem = {
  id: string
  tipo: "parada" | "linea" | "lugar"
  label: string
  lat?: number | null
  lng?: number | null
  meta?: Record<string, unknown>
  fecha: string
}

const STORAGE_KEYS = {
  SETTINGS: "geobus_a11y_settings",
  FAVORITES: "geobus_favorites",
  RECENT_SEARCHES: "geobus_recent_searches",
  GUEST_PROFILE: "geobus_guest_profile",
} as const

const DEFAULT_SETTINGS: AccessibilitySettings = {
  voiceEnabled: false,
  voiceRate: 0.92,
  voiceVolume: 1,
  needsAccessibility: false,
  proximityAlertsEnabled: true,
  adaptiveRadiusM: 1200,
}

function safeGetItem<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch (err) {
    console.warn(`Error leyendo localStorage [${key}]:`, err)
    return fallback
  }
}

function safeSetItem<T>(key: string, value: T): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.warn(`Error guardando en localStorage [${key}]:`, err)
  }
}

export const StorageService = {
  getSettings(): AccessibilitySettings {
    return safeGetItem<AccessibilitySettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS)
  },

  saveSettings(settings: Partial<AccessibilitySettings>): AccessibilitySettings {
    const current = this.getSettings()
    const updated = { ...current, ...settings }
    safeSetItem(STORAGE_KEYS.SETTINGS, updated)
    return updated
  },

  getFavorites(): FavoriteItem[] {
    return safeGetItem<FavoriteItem[]>(STORAGE_KEYS.FAVORITES, [])
  },

  addFavorite(item: Omit<FavoriteItem, "fecha">): FavoriteItem[] {
    const favorites = this.getFavorites().filter((f) => f.id !== item.id)
    const updated = [
      { ...item, fecha: new Date().toISOString() },
      ...favorites,
    ].slice(0, 50)
    safeSetItem(STORAGE_KEYS.FAVORITES, updated)
    return updated
  },

  removeFavorite(id: string): FavoriteItem[] {
    const favorites = this.getFavorites().filter((f) => f.id !== id)
    safeSetItem(STORAGE_KEYS.FAVORITES, favorites)
    return favorites
  },

  isFavorite(id: string): boolean {
    return this.getFavorites().some((f) => f.id === id)
  },

  getRecentSearches(): string[] {
    return safeGetItem<string[]>(STORAGE_KEYS.RECENT_SEARCHES, [])
  },

  addRecentSearch(query: string): string[] {
    const trimmed = query.trim()
    if (!trimmed || trimmed.length < 2) return this.getRecentSearches()
    const current = this.getRecentSearches().filter(
      (q) => q.toLowerCase() !== trimmed.toLowerCase()
    )
    const updated = [trimmed, ...current].slice(0, 15)
    safeSetItem(STORAGE_KEYS.RECENT_SEARCHES, updated)
    return updated
  },

  clearRecentSearches(): void {
    if (typeof window === "undefined") return
    window.localStorage.removeItem(STORAGE_KEYS.RECENT_SEARCHES)
  },
}
