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

// App es el componente raíz — el "jefe" que decide qué se muestra.
// Maneja dos estados:
//   1. userName  → quién es el usuario (viene de localStorage)
//   2. vistaActiva → qué pantalla está abierta ahora mismo
function App() {

  // useState crea una variable reactiva: cuando cambia, React vuelve a renderizar.
  // La función () => ... se llama solo una vez al arrancar para leer localStorage.
  // ?? '' significa "si localStorage devuelve null, usa cadena vacía"
  const [userName, setUserName] = useState<string>(
    () => localStorage.getItem('genesis_username') ?? ''
  )

  // La vista que está activa ahora mismo. Por defecto, 'hoy'.
  const [vistaActiva, setVistaActiva] = useState<Vista>('hoy')

  // Si aún no hay nombre guardado, mostramos la pantalla de bienvenida.
  // onComplete recibe el nombre que escribió el usuario y lo guarda en localStorage.
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

  // Devuelve el componente correcto según la vista activa.
  // switch/case evalúa vistaActiva y ejecuta solo la rama que coincide.
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

  // Layout principal: sidebar a la izquierda, panel a la derecha.
  // onCambiarVista le pasamos setVistaActiva para que Sidebar pueda cambiar el estado.
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
