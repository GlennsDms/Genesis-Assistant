import { useEffect } from 'react'

// WebView2 en Windows (y Chromium en general) bloquea audio.play() si no
// hubo ningún gesto del usuario en la sesión actual. Este hook reproduce un
// buffer WAV silencioso de 1 ms en el primer click o keydown global para que
// el contexto de audio quede marcado como "activado por gesto", evitando que
// la alarma automática muestre el botón fallback en condiciones normales de uso.
export function useAudioUnlock(): void {
  useEffect(() => {
    let desbloqueado = false

    function intentarDesbloqueo() {
      if (desbloqueado) return

      const audio = new Audio(
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
      )
      audio.play()
        .then(() => {
          desbloqueado = true
          window.removeEventListener('click',   intentarDesbloqueo)
          window.removeEventListener('keydown', intentarDesbloqueo)
        })
        .catch(() => {
          // Si aún falla, el listener permanece activo para el próximo gesto.
        })
    }

    window.addEventListener('click',   intentarDesbloqueo)
    window.addEventListener('keydown', intentarDesbloqueo)

    return () => {
      window.removeEventListener('click',   intentarDesbloqueo)
      window.removeEventListener('keydown', intentarDesbloqueo)
    }
  }, [])
}
