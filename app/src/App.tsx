import { useState, useEffect, useRef, useCallback } from 'react'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import type { Vista } from './types'
import Sidebar from './components/Sidebar'
import OnboardingScreen from './components/OnboardingScreen'
import HomeView from './views/HomeView'
import CalendarView from './views/CalendarView'
import RemindersView from './views/RemindersView'
import ScheduleView from './views/ScheduleView'
import ChatView from './views/ChatView'
import SettingsView from './views/SettingsView'
import { listReminders } from './lib/db'
import { scheduleReminder } from './lib/scheduler'

function App() {
  // El nombre persiste en localStorage; la función de inicialización solo se ejecuta una vez.
  const [userName, setUserName] = useState<string>(
    () => localStorage.getItem('genesis_username') ?? ''
  )
  const [vistaActiva, setVistaActiva] = useState<Vista>('hoy')

  // El conteo de pendientes se refresca cuando el usuario vuelve al dashboard.
  // Inicializamos con null para distinguir "sin cargar aún" de "cero recordatorios".
  const [pendingCount, setPendingCount] = useState<number>(0)

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
    </div>
  )
}

export default App
