import { useState, useEffect, useCallback } from 'react'
import type { Reminder, NewReminder } from '../lib/types'
import { listReminders, createReminder, updateReminder, toggleReminderCompleted, deleteReminder } from '../lib/db'
import { scheduleReminder, cancelReminder } from '../lib/scheduler'
import ReminderForm from '../components/ReminderForm'
import ReminderItem from '../components/ReminderItem'

interface Props {
  onCambioConteo?: () => void
}

function RemindersView({ onCambioConteo }: Props) {
  const [reminders,   setReminders]   = useState<Reminder[]>([])
  const [mostrárForm, setMostrarForm] = useState(false)
  const [editando,    setEditando]    = useState<Reminder | null>(null)
  const [cargando,    setCargando]    = useState(true)
  const [errorBd,     setErrorBd]     = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const datos = await listReminders()
      setReminders(datos)
      setErrorBd(null)
    } catch (e) {
      setErrorBd('No se pudo conectar con la base de datos. Reinicia la aplicación.')
      console.error(e)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function handleCrear(data: NewReminder) {
    const creado = await createReminder(data)

    // Programar notificación solo si tiene fecha futura.
    if (creado.due_at && new Date(creado.due_at) > new Date()) {
      await scheduleReminder(creado.id, creado.due_at, creado.title, creado.description)
    }

    setMostrarForm(false)
    await cargar()
    onCambioConteo?.()
  }

  async function handleGuardarEdicion(data: NewReminder) {
    if (!editando) return

    // Cancelamos siempre la notificación previa antes de actualizar.
    await cancelReminder(editando.id)
    await updateReminder(editando.id, {
      title:       data.title,
      description: data.description,
      due_at:      data.due_at,
    })

    // Reprogramamos si la nueva fecha es futura.
    if (data.due_at && new Date(data.due_at) > new Date()) {
      await scheduleReminder(editando.id, data.due_at, data.title, data.description)
    }

    setEditando(null)
    await cargar()
    onCambioConteo?.()
  }

  async function handleToggle(id: number) {
    const recordatorio = reminders.find(r => r.id === id)
    await toggleReminderCompleted(id)

    if (recordatorio) {
      if (recordatorio.completed === 0) {
        // Se está completando → ya no necesita notificación.
        await cancelReminder(id)
      } else if (recordatorio.due_at && new Date(recordatorio.due_at) > new Date()) {
        // Se está des-completando con fecha futura → reprogramar.
        await scheduleReminder(id, recordatorio.due_at, recordatorio.title, recordatorio.description)
      }
    }

    await cargar()
    onCambioConteo?.()
  }

  async function handleBorrar(id: number) {
    // Cancelamos siempre antes de borrar; si no había nada programado, es un no-op.
    await cancelReminder(id)
    await deleteReminder(id)
    await cargar()
    onCambioConteo?.()
  }

  if (errorBd) {
    return (
      <div className="reminders-view">
        <div className="reminders-error">
          <span className="reminders-error-icono">!</span>
          <p className="reminders-error-texto">{errorBd}</p>
        </div>
      </div>
    )
  }

  const pendientes  = reminders.filter(r => r.completed === 0)
  const completados = reminders.filter(r => r.completed === 1)

  // El formulario de edición es exclusivo con el de creación.
  const formularioActivo = mostrárForm || editando !== null

  return (
    <div className="reminders-view">
      <header className="reminders-header">
        <h1 className="reminders-titulo">RECORDATORIOS</h1>
        {!formularioActivo && (
          <button
            className="reminders-btn-nuevo"
            onClick={() => setMostrarForm(true)}
          >
            + NUEVO
          </button>
        )}
      </header>

      {mostrárForm && (
        <ReminderForm
          onGuardar={handleCrear}
          onCancelar={() => setMostrarForm(false)}
        />
      )}

      {editando && (
        <ReminderForm
          initialValues={editando}
          modoEdicion
          onGuardar={handleGuardarEdicion}
          onCancelar={() => setEditando(null)}
        />
      )}

      {cargando ? (
        <div className="reminders-cargando">
          <span className="cursor-stream">█</span>
        </div>
      ) : reminders.length === 0 && !formularioActivo ? (
        <div className="reminders-empty">
          <div className="reminders-empty-halftone" aria-hidden="true" />
          <p className="reminders-empty-texto">
            SIN OBJETIVOS.<br />
            ROBA TU PROPIO TIEMPO.
          </p>
        </div>
      ) : (
        <div className="reminders-lista-wrap">
          {pendientes.length > 0 && (
            <ul className="reminders-lista">
              {pendientes.map(r => (
                <ReminderItem
                  key={r.id}
                  reminder={r}
                  onToggle={handleToggle}
                  onBorrar={handleBorrar}
                  onEditar={setEditando}
                />
              ))}
            </ul>
          )}

          {completados.length > 0 && (
            <>
              <div className="reminders-separador">
                <span>COMPLETADOS</span>
              </div>
              <ul className="reminders-lista reminders-lista--completados">
                {completados.map(r => (
                  <ReminderItem
                    key={r.id}
                    reminder={r}
                    onToggle={handleToggle}
                    onBorrar={handleBorrar}
                    onEditar={setEditando}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default RemindersView
