import type { CalendarEvent } from '../lib/types'
import { formatearHoraEvento } from '../lib/dateFormat'
import './EventDetailPanel.css'

interface Props {
  evento: CalendarEvent
  onCerrar: () => void
  // Presente cuando se navega aquí desde la lista de un día; muestra "◂ VOLVER".
  onVolver?: () => void
}

function EventDetailPanel({ evento, onCerrar, onVolver }: Props) {
  const fuente = evento.source === 'ics_import' ? 'IMPORTADO DE .ICS' : 'CREADO EN GENESIS'

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

      <div className="event-panel__fuente">{fuente}</div>
    </div>
  )
}

export default EventDetailPanel
