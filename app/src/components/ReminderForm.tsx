import { useState } from 'react'
import type { NewReminder } from '../lib/types'
import { inputLocalAIso, isoAInputLocal } from '../lib/dateFormat'

interface Props {
  onGuardar:     (data: NewReminder) => Promise<void>
  onCancelar:    () => void
  initialValues?: NewReminder
  modoEdicion?:  boolean
}

function ReminderForm({ onGuardar, onCancelar, initialValues, modoEdicion }: Props) {
  const [titulo,      setTitulo]      = useState(initialValues?.title       ?? '')
  const [descripcion, setDescripcion] = useState(initialValues?.description ?? '')
  // Convertimos el ISO almacenado al formato que acepta datetime-local.
  const [fechaLocal,  setFechaLocal]  = useState(
    initialValues?.due_at ? isoAInputLocal(initialValues.due_at) : ''
  )
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const tituloLimpio = titulo.trim()
    if (!tituloLimpio) {
      setError('El título es obligatorio.')
      return
    }

    setGuardando(true)
    setError('')
    try {
      await onGuardar({
        title:       tituloLimpio,
        description: descripcion.trim() || null,
        due_at:      fechaLocal ? inputLocalAIso(fechaLocal) : null,
      })
    } catch {
      setError('Error al guardar. Inténtalo de nuevo.')
      setGuardando(false)
    }
  }

  return (
    <form className="reminder-form" onSubmit={handleSubmit}>
      <div className="reminder-form-row">
        <input
          className="reminder-form-input"
          type="text"
          placeholder="TÍTULO DEL RECORDATORIO"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          autoFocus
          disabled={guardando}
        />
      </div>

      <div className="reminder-form-row">
        <input
          className="reminder-form-input reminder-form-input--secondary"
          type="text"
          placeholder="Descripción (opcional)"
          value={descripcion ?? ''}
          onChange={(e) => setDescripcion(e.target.value)}
          disabled={guardando}
        />
      </div>

      <div className="reminder-form-row">
        <input
          className="reminder-form-input reminder-form-input--date"
          type="datetime-local"
          value={fechaLocal}
          onChange={(e) => setFechaLocal(e.target.value)}
          disabled={guardando}
        />
      </div>

      {error && <p className="reminder-form-error">{error}</p>}

      <div className="reminder-form-actions">
        <button
          className="reminder-btn reminder-btn--primary"
          type="submit"
          disabled={guardando}
        >
          {guardando ? 'GUARDANDO...' : modoEdicion ? 'GUARDAR' : 'CREAR'}
        </button>
        <button
          className="reminder-btn reminder-btn--ghost"
          type="button"
          onClick={onCancelar}
          disabled={guardando}
        >
          CANCELAR
        </button>
      </div>
    </form>
  )
}

export default ReminderForm
