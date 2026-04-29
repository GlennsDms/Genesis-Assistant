import { useState } from 'react'
import type { Vista } from './types'
import Sidebar from './components/Sidebar'
import OnboardingScreen from './components/OnboardingScreen'
import HomeView from './views/HomeView'
import CalendarView from './views/CalendarView'
import RemindersView from './views/RemindersView'
import ScheduleView from './views/ScheduleView'
import ChatView from './views/ChatView'
import SettingsView from './views/SettingsView'

function App() {
  // El nombre persiste en localStorage; la función de inicialización solo se ejecuta una vez.
  const [userName, setUserName] = useState<string>(
    () => localStorage.getItem('genesis_username') ?? ''
  )
  const [vistaActiva, setVistaActiva] = useState<Vista>('hoy')

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
      case 'hoy':           return <HomeView userName={userName} />
      case 'calendario':    return <CalendarView />
      case 'recordatorios': return <RemindersView />
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
