import { useEffect, useRef, useState } from 'react'
import type { AlarmPayload } from '../lib/types'
import './AlarmOverlay.css'

const ALARM_AUDIO_SRC = '/sounds/Genesis_Alarm.mp3'

// Encapsula el ciclo de vida del objeto Audio para la alarma.
// Se separa en un hook para que AlarmOverlay sea puramente declarativo.
function useAlarmAudio(activa: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!activa) return

    const audio = new Audio(ALARM_AUDIO_SRC)
    audio.loop = true
    audioRef.current = audio

    audio.play().catch((e: unknown) => {
      // El contexto de audio debería estar desbloqueado por useAudioUnlock en App.
      // Si aún falla, lo registramos para diagnóstico sin mostrar ninguna UI al usuario.
      console.error('[genesis] autoplay de alarma bloqueado:', e)
    })

    return () => {
      audio.pause()
      audio.currentTime = 0
      // src = '' libera la referencia interna al recurso de red/decodificación;
      // sin esto el objeto Audio puede retener memoria aunque el overlay desmonte.
      audio.src = ''
      audioRef.current = null
    }
  }, [activa])

  function detenerSonido() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current.src = ''
    }
  }

  return { detenerSonido }
}

// ── Reloj en tiempo real ─────────────────────────────────────────────────────

function useReloj(): string {
  const [hora, setHora] = useState(() => formatearHora(new Date()))

  useEffect(() => {
    // Sincronizamos el intervalo con el inicio del próximo segundo para que no
    // haya desfase acumulado con setInterval plano.
    const ms = 1000 - new Date().getMilliseconds()
    const timeout = setTimeout(() => {
      setHora(formatearHora(new Date()))
      const intervalo = setInterval(() => {
        setHora(formatearHora(new Date()))
      }, 1000)
      return () => clearInterval(intervalo)
    }, ms)
    return () => clearTimeout(timeout)
  }, [])

  return hora
}

function formatearHora(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

// ── Componente principal ─────────────────────────────────────────────────────

interface Props {
  payload: AlarmPayload
  onDone: () => void
  onSnooze: () => void
}

export default function AlarmOverlay({ payload, onDone, onSnooze }: Props) {
  const { detenerSonido } = useAlarmAudio(true)
  const hora = useReloj()

  function handleDone() {
    detenerSonido()
    onDone()
  }

  function handleSnooze() {
    detenerSonido()
    onSnooze()
  }

  return (
    <div className="alarm-overlay" role="alertdialog" aria-modal="true" aria-label="Alarma activa">
      <div className="alarm-overlay__halftone" aria-hidden="true" />
      <div className="alarm-overlay__slashes" aria-hidden="true" />

      <div className="alarm-overlay__clock" aria-hidden="true">{hora}</div>

      <div className="alarm-overlay__content">
        <p className="alarm-overlay__label">▸ OBJETIVO ACTIVO · ALERTA GENESIS</p>

        <h1 className="alarm-overlay__title">{payload.title}</h1>

        {payload.description && (
          <p className="alarm-overlay__description">{payload.description}</p>
        )}

        <div className="alarm-overlay__actions">
          <button className="alarm-btn alarm-btn--done" onClick={handleDone}>
            <span>HECHO</span>
          </button>
          <button className="alarm-btn alarm-btn--snooze" onClick={handleSnooze}>
            <span>POSPONER 10 MIN</span>
          </button>
        </div>
      </div>
    </div>
  )
}
