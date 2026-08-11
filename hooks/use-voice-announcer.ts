"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Hook de accesibilidad: emite anuncios por voz (Web Speech API) en español
 * para personas con discapacidad visual. Evita repetir el mismo mensaje.
 */
export function useVoiceAnnouncer() {
  const [enabled, setEnabled] = useState(false)
  const [supported, setSupported] = useState(true)
  const lastMessage = useRef<string>("")

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSupported(false)
    }
  }, [])

  const speak = useCallback(
    (message: string, opts?: { force?: boolean }) => {
      if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return
      if (!opts?.force && message === lastMessage.current) return
      lastMessage.current = message

      const utterance = new SpeechSynthesisUtterance(message)
      utterance.lang = "es-ES"
      utterance.rate = 1
      utterance.pitch = 1
      utterance.volume = 1

      const voices = window.speechSynthesis.getVoices()
      const spanishVoice = voices.find((v) => v.lang.toLowerCase().startsWith("es"))
      if (spanishVoice) utterance.voice = spanishVoice

      // Cancela cualquier anuncio en curso para priorizar el más reciente
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
    },
    [enabled],
  )

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel()
        if (next) {
          // Precarga de voces + confirmación audible al activar
          window.speechSynthesis.getVoices()
          const u = new SpeechSynthesisUtterance("Anuncios por voz activados.")
          u.lang = "es-ES"
          window.speechSynthesis.speak(u)
        }
      }
      return next
    })
  }, [])

  return { enabled, supported, speak, toggle }
}
