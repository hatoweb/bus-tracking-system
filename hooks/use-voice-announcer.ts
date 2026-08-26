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

  /**
   * Selecciona la voz española más natural disponible.
   * Orden de preferencia: voces neurales/natural de Microsoft o Google,
   * luego variantes regionales (es-419, es-AR, es-MX), y finalmente
   * cualquier voz en español.
   */
  const pickBestSpanishVoice = (voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
    if (!voices.length) return null

    // 1) Voces neurales/natural de Microsoft o Google (las más naturales)
    const neural = voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith("es") &&
        /(neural|natural|online|google|microsoft)/i.test(v.name),
    )
    if (neural) return neural

    // 2) Variantes regionales que suelen ser más cálidas
    const regional = voices.find(
      (v) =>
        /^es-(419|ar|mx|co|cl|pe|uy|py|bo|ec|ve|cr|pa|do|gt|hn|ni|sv|pr|cu)/i.test(v.lang),
    )
    if (regional) return regional

    // 3) Cualquier voz española
    return voices.find((v) => v.lang.toLowerCase().startsWith("es")) ?? null
  }

  const speak = useCallback(
    (message: string, opts?: { force?: boolean }) => {
      if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return
      if (!opts?.force && message === lastMessage.current) return
      lastMessage.current = message

      const doSpeak = () => {
        const utterance = new SpeechSynthesisUtterance(message)
        utterance.lang = "es-419" // Español latinoamericano como base
        utterance.rate = 0.92    // Ligeramente más pausado → suena más natural
        utterance.pitch = 1
        utterance.volume = 1

        const voices = window.speechSynthesis.getVoices()
        const bestVoice = pickBestSpanishVoice(voices)
        if (bestVoice) utterance.voice = bestVoice

        // Cancela cualquier anuncio en curso para priorizar el más reciente
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utterance)
      }

      // Si las voces aún no están cargadas, esperar el evento
      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) {
        doSpeak()
      } else {
        const handler = () => {
          window.speechSynthesis.removeEventListener("voiceschanged", handler)
          doSpeak()
        }
        window.speechSynthesis.addEventListener("voiceschanged", handler)
      }
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
