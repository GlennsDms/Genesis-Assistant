import type { CalendarEvent } from '../lib/types'
import { formatearHoraEvento } from '../lib/dateFormat'
import './DayListPanel.css'

interface Props {
  fecha: Date
  eventos: CalendarEvent[]
  onEventoClick: (evento: CalendarEvent) => void
  onCerrar: () => void
}

function DayListPanel({ fecha, eventos, onEventoClick, onCerrar }: Props) {
  const diaSemana = fecha.toLocaleDateString('es-ES', { weekday: 'long' }).toUpperCase()
  const dia       = fecha.getDate()
  const mes       = fecha.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase()

  return (
    <div className="day-panel">
      <div className="day-panel__top">
        <div className="day-panel__fecha">
          <span className="day-panel__dia-semana">{diaSemana}</span>
          <span className="day-panel__dia-mes">{dia} {mes}</span>
        </div>
        <button className="day-panel__cerrar" onClick={onCerrar}>
          <span>CERRAR</span>
        </button>
      </div>

      <div className="day-panel__slash" aria-hidden />

      <ul className="day-panel__lista">
        {eventos.map(evento => (
          <li key={evento.id}>
            <button
              className={`day-panel__tarjeta${evento.all_day === 1 ? ' day-panel__tarjeta--allday' : ''}`}
              onClick={() => onEventoClick(evento)}
            >
              <span className="day-panel__tarjeta-hora">
                {formatearHoraEvento(evento)}
              </span>
              <span className="day-panel__tarjeta-titulo">{evento.title}</span>
              {evento.location && (
                <span className="day-panel__tarjeta-lugar">{evento.location}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default DayListPanel
