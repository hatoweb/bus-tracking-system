"use client"

import { useCallback, useRef } from "react"
import { formatDistanceLabel } from "@/lib/bus-accesibilidad"

export type ProximityMilestone = 500 | 200 | 50

interface BusProximityTarget {
  id: string
  lineaLabel: string
  distanceMeters: number | null | undefined
  etaMinutes: number | null | undefined
  speedKmh?: number | null
}

interface UseProximityAlertsProps {
  speak: (message: string, opts?: { force?: boolean }) => void
  voiceEnabled: boolean
}

/**
 * Hook de alertas hápticas y telemetría dual para personas con discapacidad visual.
 * Emite vibraciones y avisos de voz estructurados al cruzar los umbrales de aproximación
 * de 500m, 200m y 50m (hito de parada inminente / levantar la mano).
 */
export function useProximityAlerts({ speak, voiceEnabled }: UseProximityAlertsProps) {
  // Mapa de busId -> Set de hitos ya anunciados para evitar repeticiones excesivas
  const announcedMilestonesRef = useRef<Map<string, Set<ProximityMilestone>>>(new Map())

  /**
   * Ejecuta vibración háptica mediante Web Vibration API nativa si está disponible.
   * Totalmente soportado en navegadores Android y WebViews de Capacitor.
   */
  const triggerHaptic = useCallback((pattern: number | number[]) => {
    if (typeof window !== "undefined" && "navigator" in window && "vibrate" in navigator) {
      try {
        navigator.vibrate(pattern)
      } catch (err) {
        console.warn("Vibration API no disponible o bloqueada:", err)
      }
    }
  }, [])

  /**
   * Construye el texto descriptivo de telemetría dual (Distancia + Tiempo).
   * Ej: "Línea 27 a 450 metros, aproximándose en 3 minutos".
   */
  const formatDualTelemetry = useCallback(
    (target: BusProximityTarget): string => {
      const { lineaLabel, distanceMeters, etaMinutes, speedKmh } = target
      if (distanceMeters == null || !Number.isFinite(distanceMeters)) {
        return `${lineaLabel} en seguimiento.`
      }

      const distStr = formatDistanceLabel(distanceMeters)

      if (etaMinutes != null && etaMinutes > 0) {
        const tiempoStr = etaMinutes === 1 ? "1 minuto" : `${etaMinutes} minutos`
        return `${lineaLabel} a ${distStr}, aproximándose en aproximadamente ${tiempoStr}.`
      }

      if (speedKmh != null && speedKmh > 0) {
        return `${lineaLabel} a ${distStr}, velocidad ${Math.round(speedKmh)} kilómetros por hora.`
      }

      return `${lineaLabel} a ${distStr}.`
    },
    []
  )

  /**
   * Evalúa la distancia actual de una unidad y dispara las alertas sonoras y hápticas
   * correspondientes a los hitos de 500m, 200m y 50m.
   */
  const evaluateProximity = useCallback(
    (target: BusProximityTarget) => {
      const { id, lineaLabel, distanceMeters, etaMinutes } = target
      if (!distanceMeters || !Number.isFinite(distanceMeters) || distanceMeters <= 0) return

      if (!announcedMilestonesRef.current.has(id)) {
        announcedMilestonesRef.current.set(id, new Set())
      }
      const announced = announcedMilestonesRef.current.get(id)!

      // Hito 50 m: Acción inminente ("Levantar la mano")
      if (distanceMeters <= 60 && !announced.has(50)) {
        announced.add(50)
        triggerHaptic([350, 100, 350, 100, 350]) // Vibración fuerte y marcada
        speak(
          `¡Atención! ${lineaLabel} a solo 50 metros. Levante la mano para abordar.`,
          { force: true }
        )
        return
      }

      // Hito 200 m: Preparación para abordar
      if (distanceMeters <= 220 && distanceMeters > 60 && !announced.has(200)) {
        announced.add(200)
        triggerHaptic([200, 100, 200]) // Doble vibración
        const tiempoStr =
          etaMinutes && etaMinutes > 0
            ? `, llegando en ${etaMinutes === 1 ? "1 minuto" : `${etaMinutes} minutos`}`
            : ""
        speak(
          `Atención: ${lineaLabel} a 200 metros${tiempoStr}. Prepárese para abordar.`,
          { force: true }
        )
        return
      }

      // Hito 500 m: Aviso temprano de aproximación
      if (distanceMeters <= 550 && distanceMeters > 220 && !announced.has(500)) {
        announced.add(500)
        triggerHaptic(180) // Vibración simple
        const tiempoStr =
          etaMinutes && etaMinutes > 0
            ? `, tiempo estimado ${etaMinutes} minutos`
            : ""
        speak(
          `${lineaLabel} a 500 metros${tiempoStr}.`,
          { force: true }
        )
        return
      }

      // Si el bus se aleja más allá de 1200m, limpiar hitos para permitir nueva alerta en siguiente vuelta
      if (distanceMeters > 1200 && announced.size > 0) {
        announced.clear()
      }
    },
    [speak, triggerHaptic]
  )

  const resetProximityMilestones = useCallback((busId?: string) => {
    if (busId) {
      announcedMilestonesRef.current.delete(busId)
    } else {
      announcedMilestonesRef.current.clear()
    }
  }, [])

  return {
    evaluateProximity,
    formatDualTelemetry,
    triggerHaptic,
    resetProximityMilestones,
  }
}
