import type { CalendarEvent } from '../lib/types'
import { formatearHoraEvento } from '../lib/dateFormat'
import { useTooltip } from '../hooks/useTooltip'
import Tooltip from './Tooltip'
import './CalendarDay.css'

// Máximo de píldoras de evento antes de mostrar el contador "+N MÁS".
const MAX_PILDORAS = 2

interface Props {
  fecha: Date
  eventos: CalendarEvent[]
  esHoy: boolean
  esDelMesActivo: boolean
  onEventoClick: (evento: CalendarEvent) => void
  // Llamado cuando el usuario hace click en una celda vacía (sin eventos).
  onCeldaClick: (fecha: Date) => void
  // Llamado cuando el usuario hace click en "+N MÁS" para ver todos los eventos del día.
  onDiaClick: (fecha: Date) => void
}

function CalendarDay({ fecha, eventos, esHoy, esDelMesActivo, onEventoClick, onCeldaClick, onDiaClick }: Props) {
  const { tooltip, mostrar, ocultar } = useTooltip()

  const pildorasVisibles = eventos.slice(0, MAX_PILDORAS)
  const restantes        = eventos.length - MAX_PILDORAS

  function handleCeldaClick() {
    // Solo llega aquí si ningún elemento hijo llamó stopPropagation.
    // Todos los elementos interactivos de la celda (píldoras individuales y
    // el botón "+N MÁS") cortan la propagación, así que este handler se
    // activa únicamente al hacer click en el espacio vacío de la celda.
    onCeldaClick(fecha)
  }

  const clases = [
    'cal-day',
    esHoy           && 'cal-day--hoy',
    !esDelMesActivo && 'cal-day--fuera',
  ].filter(Boolean).join(' ')

  return (
    <div className={clases} onClick={handleCeldaClick}>
      <div className={`cal-day__numero${esHoy ? ' cal-day__numero--hoy' : ''}`}>
        {fecha.getDate()}
      </div>

      <div className="cal-day__eventos">
        {pildorasVisibles.map(evento => (
          // <button> garantiza accesibilidad: foco con teclado, rol implícito button,
          // activación con Enter/Espacio. stopPropagation evita que el click bubujee
          // a handleCeldaClick (que abriría el formulario de creación en 6c).
          <button
            key={evento.id}
            className={`cal-pildora${evento.all_day === 1 ? ' cal-pildora--allday' : ''}`}
            onClick={e => { e.stopPropagation(); onEventoClick(evento) }}
            onMouseEnter={e => mostrar(e, evento.title, formatearHoraEvento(evento))}
            onMouseLeave={ocultar}
          >
            <span className="cal-pildora__texto">{evento.title}</span>
          </button>
        ))}

        {restantes > 0 && (
          // <button> por las mismas razones que las píldoras individuales:
          // accesibilidad + stopPropagation para no activar handleCeldaClick.
          <button
            className="cal-pildora cal-pildora--mas"
            onClick={e => { e.stopPropagation(); onDiaClick(fecha) }}
          >
            <span className="cal-pildora__texto">+{restantes} MÁS</span>
          </button>
        )}
      </div>

      {/* Portal al body: escapa el overflow:hidden de la cuadrícula */}
      <Tooltip {...tooltip} />
    </div>
  )
}

export default CalendarDay
