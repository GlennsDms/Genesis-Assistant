import { useState, useEffect } from 'react'
import type { CalendarEvent } from '../lib/types'
import { formatearHoraEvento, isoAInputLocal, inputLocalAIso } from '../lib/dateFormat'
import { updateEvent, deleteEvent } from '../lib/db'
import './EventDetailPanel.css'

interface Props {
  evento: CalendarEvent
  onCerrar: () => void
  // Presente cuando se navega aquí desde la lista de un día; muestra "◂ VOLVER".
  onVolver?: () => void
}

interface Draft {
  title:      string
  description: string
  location:   string
  startLocal: string   // valor para <input type="datetime-local">
  endLocal:   string   // valor para <input type="datetime-local">
  allDay:     boolean
}

function initDraft(evento: CalendarEvent): Draft {
  return {
    title:       evento.title,
    description: evento.description ?? '',
    location:    evento.location    ?? '',
    startLocal:  isoAInputLocal(evento.start_at),
    endLocal:    isoAInputLocal(evento.end_at),
    allDay:      evento.all_day === 1,
  }
}

function EventDetailPanel({ evento, onCerrar, onVolver }: Props) {
  const [modoEdicion,      setModoEdicion]      = useState(false)
  const [draft,            setDraft]            = useState<Draft>(() => initDraft(evento))
  const [guardando,        setGuardando]        = useState(false)
  const [errores,          setErrores]          = useState<Record<string, string>>({})
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(false)
  const [borrando,          setBorrando]          = useState(false)

  // Cancela la confirmación automáticamente si el usuario no actúa en 5 segundos.
  useEffect(() => {
    if (!confirmandoBorrar) return
    const timer = setTimeout(() => setConfirmandoBorrar(false), 5000)
    return () => clearTimeout(timer)
  }, [confirmandoBorrar])

  const fuente = evento.source === 'ics_import' ? 'IMPORTADO DE .ICS' : 'CREADO EN GENESIS'

  function cancelarEdicion() {
    setDraft(initDraft(evento))
    setErrores({})
    setModoEdicion(false)
  }

  // Validación mínima. Cuando all_day = true solo se exige start_at;
  // cuando all_day = false se exige también end_at posterior a start_at.
  function validar(): boolean {
    const nuevosErrores: Record<string, string> = {}

    if (!draft.title.trim()) {
      nuevosErrores.title = 'El título no puede estar vacío.'
    }

    if (!draft.startLocal) {
      nuevosErrores.startLocal = draft.allDay ? 'La fecha es obligatoria.' : 'La fecha de inicio es obligatoria.'
    }

    if (!draft.allDay) {
      if (!draft.endLocal) {
        nuevosErrores.endLocal = 'La fecha de fin es obligatoria.'
      } else if (draft.startLocal && new Date(draft.endLocal) <= new Date(draft.startLocal)) {
        nuevosErrores.endLocal = 'La fecha de fin debe ser posterior a la de inicio.'
      }
    }

    setErrores(nuevosErrores)
    return Object.keys(nuevosErrores).length === 0
  }

  async function handleGuardar() {
    if (!validar()) return

    setGuardando(true)
    try {
      // Construir patch con solo los campos que cambiaron respecto al evento original.
      // all_day: comparación estricta de number (0|1) — no truthy/falsy.
      const patch: Partial<Pick<CalendarEvent, 'title' | 'description' | 'location' | 'start_at' | 'end_at' | 'all_day'>> = {}

      const nuevoTitle = draft.title.trim()
      if (nuevoTitle !== evento.title) patch.title = nuevoTitle

      const nuevaDesc = draft.description.trim() || null
      if (nuevaDesc !== evento.description) patch.description = nuevaDesc

      const nuevaLoc = draft.location.trim() || null
      if (nuevaLoc !== evento.location) patch.location = nuevaLoc

      const nuevoAllDay: 0 | 1 = draft.allDay ? 1 : 0
      if (nuevoAllDay !== evento.all_day) patch.all_day = nuevoAllDay

      if (draft.startLocal) {
        const nuevoStartIso = inputLocalAIso(draft.startLocal)
        // Comparar como timestamps para no depender del formato del offset almacenado.
        if (new Date(nuevoStartIso).getTime() !== new Date(evento.start_at).getTime()) {
          patch.start_at = nuevoStartIso
        }
      }

      // end_at solo si no es todo el día. Si el usuario marcó all_day, se deja
      // el end_at original — no tiene sentido de negocio editarlo si está oculto.
      if (!draft.allDay && draft.endLocal) {
        const nuevoEndIso = inputLocalAIso(draft.endLocal)
        if (new Date(nuevoEndIso).getTime() !== new Date(evento.end_at).getTime()) {
          patch.end_at = nuevoEndIso
        }
      }

      await updateEvent(evento.id, patch)
      // eventsChanged se dispara dentro de updateEvent: CalendarView recarga y
      // sincroniza panel.evento con los datos frescos de la BD.
      setModoEdicion(false)
    } catch {
      setErrores({ general: 'Error al guardar. Inténtalo de nuevo.' })
    } finally {
      setGuardando(false)
    }
  }

  async function handleBorrarConfirmado() {
    setBorrando(true)
    try {
      await deleteEvent(evento.id)
      // deleteEvent dispara eventsChanged y cancela el recordatorio derivado.
      // onCerrar cierra el panel; CalendarView recarga la cuadrícula.
      onCerrar()
    } catch {
      setBorrando(false)
      setConfirmandoBorrar(false)
    }
  }

  // ── Modo edición ──────────────────────────────────────────────────────────────

  if (modoEdicion) {
    return (
      <div className="event-panel">
        <div className="event-panel__top">
          <h2 className="event-panel__titulo event-panel__titulo--editar">EDITAR EVENTO</h2>
          <div className="event-panel__acciones">
            <button className="event-panel__cerrar" onClick={cancelarEdicion} disabled={guardando}>
              <span>CANCELAR</span>
            </button>
          </div>
        </div>

        <div className="event-panel__slash" aria-hidden />

        {/* Título */}
        <div className="event-panel__bloque">
          <label className="event-panel__label" htmlFor="ep-title">TÍTULO</label>
          <input
            id="ep-title"
            className={`event-panel__input${errores.title ? ' event-panel__input--error' : ''}`}
            type="text"
            value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            disabled={guardando}
            autoFocus
          />
          {errores.title && <span className="event-panel__error">{errores.title}</span>}
        </div>

        <div className="event-panel__slash" aria-hidden />

        {/* Todo el día */}
        <div className="event-panel__bloque event-panel__bloque--row">
          <label className="event-panel__label" htmlFor="ep-allday">TODO EL DÍA</label>
          <input
            id="ep-allday"
            className="event-panel__checkbox"
            type="checkbox"
            checked={draft.allDay}
            onChange={e => setDraft(d => ({ ...d, allDay: e.target.checked }))}
            disabled={guardando}
          />
        </div>

        <div className="event-panel__slash" aria-hidden />

        {/* start_at */}
        <div className="event-panel__bloque">
          <label className="event-panel__label" htmlFor="ep-start">
            {draft.allDay ? 'FECHA' : 'INICIO'}
          </label>
          <input
            id="ep-start"
            className={`event-panel__input event-panel__input--date${errores.startLocal ? ' event-panel__input--error' : ''}`}
            type="datetime-local"
            value={draft.startLocal}
            onChange={e => setDraft(d => ({ ...d, startLocal: e.target.value }))}
            disabled={guardando}
          />
          {errores.startLocal && <span className="event-panel__error">{errores.startLocal}</span>}
        </div>

        {/* end_at — oculto cuando all_day = true */}
        {!draft.allDay && (
          <>
            <div className="event-panel__slash" aria-hidden />
            <div className="event-panel__bloque">
              <label className="event-panel__label" htmlFor="ep-end">FIN</label>
              <input
                id="ep-end"
                className={`event-panel__input event-panel__input--date${errores.endLocal ? ' event-panel__input--error' : ''}`}
                type="datetime-local"
                value={draft.endLocal}
                onChange={e => setDraft(d => ({ ...d, endLocal: e.target.value }))}
                disabled={guardando}
              />
              {errores.endLocal && <span className="event-panel__error">{errores.endLocal}</span>}
            </div>
          </>
        )}

        <div className="event-panel__slash" aria-hidden />

        {/* Lugar */}
        <div className="event-panel__bloque">
          <label className="event-panel__label" htmlFor="ep-location">LUGAR</label>
          <input
            id="ep-location"
            className="event-panel__input"
            type="text"
            placeholder="Sin especificar"
            value={draft.location}
            onChange={e => setDraft(d => ({ ...d, location: e.target.value }))}
            disabled={guardando}
          />
        </div>

        <div className="event-panel__slash" aria-hidden />

        {/* Notas */}
        <div className="event-panel__bloque">
          <label className="event-panel__label" htmlFor="ep-desc">NOTAS</label>
          <textarea
            id="ep-desc"
            className="event-panel__textarea"
            placeholder="Sin notas"
            value={draft.description}
            onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
            disabled={guardando}
            rows={4}
          />
        </div>

        {errores.general && (
          <span className="event-panel__error event-panel__error--general">{errores.general}</span>
        )}

        {/* Pie: guardar / cancelar */}
        <div className="event-panel__editar-acciones">
          <button
            className="event-panel__btn-guardar"
            onClick={handleGuardar}
            disabled={guardando}
          >
            <span>{guardando ? 'GUARDANDO...' : 'GUARDAR'}</span>
          </button>
          <button
            className="event-panel__btn-cancelar"
            onClick={cancelarEdicion}
            disabled={guardando}
          >
            <span>CANCELAR</span>
          </button>
        </div>

        <div className="event-panel__fuente">{fuente}</div>
      </div>
    )
  }

  // ── Modo lectura ──────────────────────────────────────────────────────────────

  return (
    <div className="event-panel">
      <div className="event-panel__top">
        <h2 className="event-panel__titulo">{evento.title}</h2>
        <div className="event-panel__acciones">
          {onVolver && (
            <button className="event-panel__btn-nav" onClick={onVolver}>
              <span>◂ VOLVER</span>
            </button>
          )}
          <button className="event-panel__cerrar" onClick={onCerrar}>
            <span>CERRAR</span>
          </button>
        </div>
      </div>

      <div className="event-panel__slash" aria-hidden />

      <div className="event-panel__bloque">
        <span className="event-panel__label">HORA</span>
        <span className="event-panel__valor">{formatearHoraEvento(evento)}</span>
      </div>

      {evento.location && (
        <>
          <div className="event-panel__slash" aria-hidden />
          <div className="event-panel__bloque">
            <span className="event-panel__label">LUGAR</span>
            <span className="event-panel__valor">{evento.location}</span>
          </div>
        </>
      )}

      {evento.description && (
        <>
          <div className="event-panel__slash" aria-hidden />
          <div className="event-panel__bloque">
            <span className="event-panel__label">NOTAS</span>
            <p className="event-panel__descripcion">{evento.description}</p>
          </div>
        </>
      )}

      {/* Pie: acciones del evento */}
      <div className="event-panel__pie">
        {confirmandoBorrar ? (
          <span className="event-panel__confirm">
            <span className="event-panel__confirm-pregunta">¿SEGURO?</span>
            <button
              className="event-panel__confirm-si"
              onClick={handleBorrarConfirmado}
              disabled={borrando}
            >
              <span>SÍ</span>
            </button>
            <button
              className="event-panel__confirm-no"
              onClick={() => setConfirmandoBorrar(false)}
              disabled={borrando}
            >
              <span>NO</span>
            </button>
          </span>
        ) : (
          <>
            <button className="event-panel__btn-editar" onClick={() => setModoEdicion(true)}>
              <span>EDITAR</span>
            </button>
            <button
              className="event-panel__btn-borrar"
              onClick={() => setConfirmandoBorrar(true)}
            >
              <span>BORRAR</span>
            </button>
          </>
        )}
      </div>

      <div className="event-panel__fuente">{fuente}</div>
    </div>
  )
}

export default EventDetailPanel
