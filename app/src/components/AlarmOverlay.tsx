import { useEffect, useRef, useState } from 'react'
import type { AlarmPayload } from '../lib/types'
import './AlarmOverlay.css'

// TODO: reemplaza este archivo por un MP3 real antes de la release.
// Colocarlo en public/sounds/genesis_alarm.mp3 es suficiente; no requiere rebuild.
const ALARM_AUDIO_SRC = '/sounds/genesis_alarm.mp3'

/**
 * Encapsula el ciclo de vida del objeto Audio para la alarma.
 * Se separa en un hook para que AlarmOverlay sea puramente declarativo.
 *
 * Cuando `activa` pasa a true, intenta reproducir en bucle.
 * Si el navegador/WebView bloquea el autoplay, activa el modo fallback.
 */
function useAlarmAudio(activa: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [necesitaInteraccion, setNecesitaInteraccion] = useState(false)

  useEffect(() => {
    if (!activa) return

    const audio = new Audio(ALARM_AUDIO_SRC)
    audio.loop = true
    audioRef.current = audio

    audio.play().catch((e: unknown) => {
      // WebView2 en Windows puede bloquear autoplay sin gesto previo del usuario.
      console.error('[genesis] autoplay de alarma bloqueado:', e)
      setNecesitaInteraccion(true)
    })

    return () => {
      audio.pause()
      audio.currentTime = 0
      audioRef.current = null
      setNecesitaInteraccion(false)
    }
  }, [activa])

  function activarSonido() {
    audioRef.current?.play().catch((e: unknown) =>
      console.error('[genesis] error al activar sonido manualmente:', e)
    )
    setNecesitaInteraccion(false)
  }

  function detenerSonido() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
  }

  return { necesitaInteraccion, activarSonido, detenerSonido }
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
  const { necesitaInteraccion, activarSonido, detenerSonido } = useAlarmAudio(true)
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

        {/* Fallback visible solo cuando el navegador bloquea el autoplay. */}
        {necesitaInteraccion && (
          <button className="alarm-overlay__sound-fallback" onClick={activarSonido}>
            ▶ ACTIVAR SONIDO
          </button>
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
