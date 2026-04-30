import { useState, useEffect, useCallback } from 'react'
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

function App() {
  // El nombre persiste en localStorage; la función de inicialización solo se ejecuta una vez.
  const [userName, setUserName] = useState<string>(
    () => localStorage.getItem('genesis_username') ?? ''
  )
  const [vistaActiva, setVistaActiva] = useState<Vista>('hoy')

  // El conteo de pendientes se refresca cuando el usuario vuelve al dashboard.
  // Inicializamos con null para distinguir "sin cargar aún" de "cero recordatorios".
  const [pendingCount, setPendingCount] = useState<number>(0)

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
