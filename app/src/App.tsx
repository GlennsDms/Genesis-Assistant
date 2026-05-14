import { useState, useEffect } from 'react'
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
import SettingsView from './views/SettingsView'
import AlarmOverlay from './components/AlarmOverlay'
import { useAudioUnlock } from './hooks/useAudioUnlock'
import { openDb, materializeEventsForToday, markReminderCompleted, updateReminder } from './lib/db'
import { scheduleReminder, cancelReminder, rehydrateAlarms } from './lib/scheduler'
import { getSetting, setSetting, SETTING_KEYS } from './lib/settings'

function App() {
  // null = cargando desde BD; '' = sin nombre (onboarding); string = app lista.
  const [userName, setUserName] = useState<string | null>(null)
  const [vistaActiva, setVistaActiva] = useState<Vista>('asistente')

  // Migración única: mueve genesis_username de localStorage a app_settings y carga el valor.
  useEffect(() => {
    async function cargarNombre() {
      const legacy = localStorage.getItem('genesis_username')
      if (legacy) {
        const existente = await getSetting(SETTING_KEYS.USER_NAME)
        if (!existente) await setSetting(SETTING_KEYS.USER_NAME, legacy)
        localStorage.removeItem('genesis_username')
      }
      const nombre = await getSetting(SETTING_KEYS.USER_NAME)
      setUserName(nombre ?? '')
    }
    cargarNombre()
  }, [])

  // Desbloquea el contexto de audio en el primer gesto del usuario para que
  // la alarma pueda reproducirse automáticamente sin necesitar interacción.
  useAudioUnlock()

  // Cola FIFO de alarmas. Si dos recordatorios vencen a la vez, la segunda
  // espera a que el usuario cierre la primera antes de aparecer.
  const [colaAlarmas, setColaAlarmas] = useState<AlarmPayload[]>([])

  // Rehidratación y materialización al arranque, sin gate de userName:
  // los recordatorios y eventos existen independientemente de si el usuario
  // ha completado el onboarding. El flag cancelled evita actuar si el
  // componente se desmonta antes de que resuelvan las Promises (React Strict Mode).
  // Secuencia obligatoria:
  //   1. openDb()               — tauri-plugin-sql abre la conexión de forma lazy:
  //                               DbInstances (estado Rust) no registra la BD hasta
  //                               que el frontend llama a Database.load(). Sin este
  //                               paso, rehydrate_alarms devuelve error porque la
  //                               entrada "sqlite:genesis.db" aún no existe en el mapa.
  //   2. rehydrateAlarms()      — Rust ya puede leer y programar los tasks existentes.
  //   3. materializeEventsForToday() — crea los derivados de hoy y los programa.
  useEffect(() => {
    let cancelled = false

    async function arrancar() {
      try {
        await openDb()
        if (cancelled) return
        await rehydrateAlarms()
        if (cancelled) return
        await materializeEventsForToday()
      } catch (e) {
        console.error('[genesis] error en arranque del scheduler:', e)
      }
    }

    arrancar()
    return () => { cancelled = true }
  }, [])

  // Solicita permiso de notificación en cuanto hay un userName válido.
  // La rehidratación del scheduler ya no vive aquí — se mueve al efecto de arranque.
  useEffect(() => {
    if (!userName) return

    async function solicitarPermiso() {
      try {
        const concedido = await isPermissionGranted()
        if (!concedido) await requestPermission()
      } catch (e) {
        console.error('[genesis] error al solicitar permiso de notificación:', e)
      }
    }

    solicitarPermiso()
  }, [userName])

  // Suscripción al evento Tauri emitido por Rust cuando un recordatorio vence.
  // La Promise de listen() resuelve en una microtarea posterior al montaje: en
  // React Strict Mode el cleanup síncrono del primer mount corre antes de que
  // resuelva, dejando unlisten === null y el listener huérfano activo. Esto
  // duplicaba la cola de alarmas y provocaba que HECHO ejecutara el toggle dos
  // veces, revirtiéndolo. La bandera `cancelled` garantiza que si el cleanup
  // ya corrió, el listener se cancela en cuanto la Promise resuelva.
  useEffect(() => {
    if (!userName) return

    let cancelled = false
    let unlisten: (() => void) | null = null

    listen<AlarmPayload>('reminder-due', (event) => {
      setColaAlarmas(prev => [...prev, event.payload])
    }).then(fn => {
      if (cancelled) {
        fn()
      } else {
        unlisten = fn
      }
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [userName])

  // ── Handlers de la alarma activa ──────────────────────────────────────────

  // El primer elemento de la cola es la alarma que se muestra en pantalla.
  const alarmaActiva = colaAlarmas[0] ?? null

  async function handleAlarmaDone() {
    if (!alarmaActiva) return
    // markReminderCompleted (SET completed=1) en lugar del toggle genérico:
    // desde una alarma el recordatorio siempre era pendiente, y la operación
    // directa es idempotente si el handler se ejecuta más de una vez.
    try {
      await markReminderCompleted(alarmaActiva.id)
      await cancelReminder(alarmaActiva.id)
    } catch (e) {
      console.error('[genesis] error al completar recordatorio desde alarma:', e)
    }
    setColaAlarmas(prev => prev.slice(1))
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

  if (userName === null) return null

  if (!userName) {
    return (
      <OnboardingScreen
        onComplete={async (nombre) => {
          await setSetting(SETTING_KEYS.USER_NAME, nombre)
          setUserName(nombre)
        }}
      />
    )
  }

  function renderVista() {
    switch (vistaActiva) {
      case 'asistente':     return <HomeView userName={userName!} onIrAjustes={() => setVistaActiva('ajustes')} />
      case 'calendario':    return <CalendarView />
      case 'recordatorios': return <RemindersView />
      case 'horarios':      return <ScheduleView />
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
