import { useState, useEffect, useCallback } from 'react'
import type { Reminder } from '../lib/types'
import { listReminders, createReminder, toggleReminderCompleted, deleteReminder } from '../lib/db'
import ReminderForm from '../components/ReminderForm'
import ReminderItem from '../components/ReminderItem'
import type { NewReminder } from '../lib/types'

interface Props {
  onCambioConteo?: () => void
}

function RemindersView({ onCambioConteo }: Props) {
  const [reminders,    setReminders]    = useState<Reminder[]>([])
  const [mostrárForm,  setMostrarForm]  = useState(false)
  const [cargando,     setCargando]     = useState(true)
  const [errorBd,      setErrorBd]      = useState<string | null>(null)

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
    await createReminder(data)
    setMostrarForm(false)
    await cargar()
    onCambioConteo?.()
  }

  async function handleToggle(id: number) {
    await toggleReminderCompleted(id)
    await cargar()
    onCambioConteo?.()
  }

  async function handleBorrar(id: number) {
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

  return (
    <div className="reminders-view">
      <header className="reminders-header">
        <h1 className="reminders-titulo">RECORDATORIOS</h1>
        {!mostrárForm && (
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
          onCrear={handleCrear}
          onCancelar={() => setMostrarForm(false)}
        />
      )}

      {cargando ? (
        <div className="reminders-cargando">
          <span className="cursor-stream">█</span>
        </div>
      ) : reminders.length === 0 && !mostrárForm ? (
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
