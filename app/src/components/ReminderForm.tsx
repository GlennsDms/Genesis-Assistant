import { useState } from 'react'
import type { NewReminder } from '../lib/types'
import { inputLocalAIso } from '../lib/dateFormat'

interface Props {
  onCrear: (data: NewReminder) => Promise<void>
  onCancelar: () => void
}

function ReminderForm({ onCrear, onCancelar }: Props) {
  const [titulo,      setTitulo]      = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fechaLocal,  setFechaLocal]  = useState('')
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
      await onCrear({
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
          value={descripcion}
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
          {guardando ? 'GUARDANDO...' : 'CREAR'}
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
