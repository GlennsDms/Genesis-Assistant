import { useState, useEffect, useRef, useCallback } from 'react'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { listen } from '@tauri-apps/api/event'
import type { Vista } from './types'
import type { AlarmPayload } from './lib/types'
import Sidebar from './components/Sidebar'
import OnboardingScreen from './components/OnboardingScreen'
import HomeView from './views/HomeView'
import CalendarView from './views/CalendarView'
import RemindersView from './views/RemindersView'
import ScheduleView from './views/ScheduleView'
import ChatView from './views/ChatView'
import SettingsView from './views/SettingsView'
import AlarmOverlay from './components/AlarmOverlay'
import { listReminders, toggleReminderCompleted, updateReminder } from './lib/db'
import { scheduleReminder, cancelReminder } from './lib/scheduler'

function App() {
  // El nombre persiste en localStorage; la función de inicialización solo se ejecuta una vez.
  const [userName, setUserName] = useState<string>(
    () => localStorage.getItem('genesis_username') ?? ''
  )
  const [vistaActiva, setVistaActiva] = useState<Vista>('hoy')

  // El conteo de pendientes se refresca cuando el usuario vuelve al dashboard.
  // Inicializamos con null para distinguir "sin cargar aún" de "cero recordatorios".
  const [pendingCount, setPendingCount] = useState<number>(0)

  // Cola FIFO de alarmas. Si dos recordatorios vencen a la vez, la segunda
  // espera a que el usuario cierre la primera antes de aparecer.
  const [colaAlarmas, setColaAlarmas] = useState<AlarmPayload[]>([])

  // Evita que la inicialización del scheduler se ejecute más de una vez,
  // incluso en React strict mode (que monta efectos dos veces en desarrollo).
  const schedulerIniciado = useRef(false)

  const refrescarConteo = useCallback(async () => {
    try {
      const todos = await listReminders()
      setPendingCount(todos.filter(r => r.completed === 0).length)
    } catch {
      // La BD puede no estar lista en el primer render; el conteo ya está en 0.
    }
  }, [])

  // Refresca el conteo cada vez que el usuario navega a la vista "hoy".
  useEffect(() => {
    if (vistaActiva === 'hoy') {
      refrescarConteo()
    }
  }, [vistaActiva, refrescarConteo])

  // Solicita permiso de notificación y rehidrata el scheduler al arrancar.
  // Se ejecuta una sola vez en cuanto hay un userName válido (post-onboarding).
  useEffect(() => {
    if (!userName || schedulerIniciado.current) return
    schedulerIniciado.current = true

    async function inicializar() {
      // Pedir permiso de notificación si todavía no se ha concedido.
      try {
        let concedido = await isPermissionGranted()
        if (!concedido) {
          const respuesta = await requestPermission()
          concedido = respuesta === 'granted'
        }
      } catch (e) {
        console.error('[genesis] error al solicitar permiso de notificación:', e)
      }

      // Rehidratar el scheduler: programa notificaciones para todos los recordatorios
      // pendientes con fecha futura. Cubre el caso de que la app se haya cerrado y reabierto.
      try {
        const ahora = new Date()
        const todos = await listReminders()
        const pendientesFuturos = todos.filter(
          r => r.completed === 0 && r.due_at !== null && new Date(r.due_at) > ahora
        )
        await Promise.all(
          pendientesFuturos.map(r =>
            scheduleReminder(r.id, r.due_at!, r.title, r.description)
          )
        )
      } catch (e) {
        console.error('[genesis] error al rehidratar el scheduler:', e)
      }
    }

    inicializar()
  }, [userName])

  // Suscripción al evento Tauri emitido por Rust cuando un recordatorio vence.
  // El unlisten se llama al desmontar para no acumular listeners en strict mode.
  useEffect(() => {
    if (!userName) return

    let unlisten: (() => void) | null = null

    listen<AlarmPayload>('reminder-due', (event) => {
      setColaAlarmas(prev => [...prev, event.payload])
    }).then(fn => { unlisten = fn })

    return () => { unlisten?.() }
  }, [userName])

  // ── Handlers de la alarma activa ──────────────────────────────────────────

  // El primer elemento de la cola es la alarma que se muestra en pantalla.
  const alarmaActiva = colaAlarmas[0] ?? null

  async function handleAlarmaDone() {
    if (!alarmaActiva) return
    // El recordatorio estaba pending (completed=0); el toggle lo marca como completado.
    try {
      await toggleReminderCompleted(alarmaActiva.id)
      await cancelReminder(alarmaActiva.id)
    } catch (e) {
      console.error('[genesis] error al completar recordatorio desde alarma:', e)
    }
    setColaAlarmas(prev => prev.slice(1))
    refrescarConteo()
  }

  async function handleAlarmaSnooze() {
    if (!alarmaActiva) return
    // Reprogramar +10 minutos desde este instante.
    const nuevaHora = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    try {
      await updateReminder(alarmaActiva.id, { due_at: nuevaHora })
      await scheduleReminder(alarmaActiva.id, nuevaHora, alarmaActiva.title, alarmaActiva.description)
    } catch (e) {
      console.error('[genesis] error al posponer recordatorio desde alarma:', e)
    }
    setColaAlarmas(prev => prev.slice(1))
  }

  // ─────────────────────────────────────────────────────────────────────────

  if (!userName) {
    return (
      <OnboardingScreen
        onComplete={(nombre) => {
          localStorage.setItem('genesis_username', nombre)
          setUserName(nombre)
        }}
      />
    )
  }

  function renderVista() {
    switch (vistaActiva) {
      case 'hoy':           return <HomeView userName={userName} pendingCount={pendingCount} />
      case 'calendario':    return <CalendarView />
      case 'recordatorios': return <RemindersView onCambioConteo={refrescarConteo} />
      case 'horarios':      return <ScheduleView />
      case 'chat':          return <ChatView />
      case 'ajustes':       return <SettingsView />
    }
  }

  return (
    <div className="app-layout">
      <Sidebar vistaActiva={vistaActiva} onCambiarVista={setVistaActiva} />
      <main className="panel-principal">
        {renderVista()}
      </main>

      {/* El overlay se monta encima de todo el layout sin destruir el estado
          del formulario de recordatorios ni ninguna otra vista activa. */}
      {alarmaActiva && (
        <AlarmOverlay
          key={alarmaActiva.id}
          payload={alarmaActiva}
          onDone={handleAlarmaDone}
          onSnooze={handleAlarmaSnooze}
        />
      )}
    </div>
  )
}

export default App
