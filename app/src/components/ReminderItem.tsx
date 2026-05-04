import { useState } from 'react'
import type { Reminder } from '../lib/types'
import { formatearFechaRelativa, estaVencida } from '../lib/dateFormat'

interface Props {
  reminder: Reminder
  onToggle:  (id: number) => Promise<void>
  onBorrar:  (id: number) => Promise<void>
  onEditar:  (reminder: Reminder) => void
}

function ReminderItem({ reminder, onToggle, onBorrar, onEditar }: Props) {
  // El estado de confirmación vive aquí, no en el padre, para que cada item
  // gestione su propio diálogo sin contaminar la lista completa.
  const [confirmando, setConfirmando] = useState(false)
  const [procesando,  setProcesando]  = useState(false)

  const completado = reminder.completed === 1
  const vencido    = !completado && reminder.due_at !== null && estaVencida(reminder.due_at)

  async function handleToggle() {
    setProcesando(true)
    await onToggle(reminder.id)
    setProcesando(false)
  }

  async function handleBorrarConfirmado() {
    setProcesando(true)
    await onBorrar(reminder.id)
    // No hace falta resetear procesando porque el componente se desmontará.
  }

  let claseItem = 'reminder-item'
  if (completado) claseItem += ' reminder-item--completado'
  if (vencido)    claseItem += ' reminder-item--vencido'

  return (
    <li className={claseItem}>
      <button
        className="reminder-checkbox"
        type="button"
        onClick={handleToggle}
        disabled={procesando}
        aria-label={completado ? 'Marcar como pendiente' : 'Marcar como completado'}
      >
        {completado ? '✕' : ''}
      </button>

      <div className="reminder-content">
        <span className="reminder-title">{reminder.title}</span>
        {reminder.description && (
          <span className="reminder-description">{reminder.description}</span>
        )}
        {reminder.due_at && (
          <span className={`reminder-due ${vencido ? 'reminder-due--vencida' : ''}`}>
            {formatearFechaRelativa(reminder.due_at)}
          </span>
        )}
      </div>

      <div className="reminder-actions">
        {confirmando ? (
          <span className="reminder-confirm">
            <span className="reminder-confirm-pregunta">¿Borrar?</span>
            <button
              className="reminder-confirm-si"
              type="button"
              onClick={handleBorrarConfirmado}
              disabled={procesando}
            >
              Sí
            </button>
            <button
              className="reminder-confirm-no"
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={procesando}
            >
              No
            </button>
          </span>
        ) : (
          <>
            {!completado && (
              <button
                className="reminder-editar"
                type="button"
                onClick={() => onEditar(reminder)}
                disabled={procesando}
                aria-label="Editar recordatorio"
              >
                ✎
              </button>
            )}
            <button
              className="reminder-borrar"
              type="button"
              onClick={() => setConfirmando(true)}
              aria-label="Borrar recordatorio"
            >
              ×
            </button>
          </>
        )}
      </div>
    </li>
  )
}

export default ReminderItem
