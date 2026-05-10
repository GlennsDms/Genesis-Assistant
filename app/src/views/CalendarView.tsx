import { useState, useEffect, useCallback } from 'react'
import type { CalendarEvent } from '../lib/types'
import { listEvents, eventsChanged } from '../lib/db'
import {
  obtenerCuadriculaMes,
  eventosPorDia,
  formatearMesAño,
  mismoDia,
  fechaLocalISO,
} from '../lib/dateFormat'
import CalendarDay from '../components/CalendarDay'
import EventDetailPanel from '../components/EventDetailPanel'
import DayListPanel from '../components/DayListPanel'
import './CalendarView.css'

const DIAS_SEMANA = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM']
const LS_KEY = 'genesis_calendar_mes'

// Estado del panel lateral. La variante 'evento' guarda de qué día viene
// para poder volver atrás con el botón "◂ VOLVER".
type PanelState =
  | { tipo: 'evento'; evento: CalendarEvent; origenDia: Date | null }
  | { tipo: 'dia'; fecha: Date }

function primerDiaDeMes(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function CalendarView() {
  const [mesActivo, setMesActivo] = useState<Date>(() => {
    const guardado = localStorage.getItem(LS_KEY)
    if (guardado) {
      const d = new Date(guardado)
      if (!isNaN(d.getTime())) return primerDiaDeMes(d)
    }
    return primerDiaDeMes(new Date())
  })

  const [eventos, setEventos] = useState<CalendarEvent[]>([])
  const [cargando, setCargando] = useState(true)
  const [panel,   setPanel]   = useState<PanelState | null>(null)

  // Derivados: se recomputan en cada render (42 iteraciones, trivial).
  const cuadricula   = obtenerCuadriculaMes(mesActivo)
  const hoy          = new Date()
  const { mes, año } = formatearMesAño(mesActivo)
  const porDia       = eventosPorDia(eventos, cuadricula)

  const cargarEventos = useCallback(async () => {
    // Rango con overlap de intervalos: captura también eventos que empiezan
    // antes del primer lunes de la cuadrícula y terminan dentro de ella.
    const primer = cuadricula[0]
    const ultimo  = cuadricula[41]
    const from = new Date(primer.getFullYear(), primer.getMonth(), primer.getDate()).toISOString()
    const to   = new Date(ultimo.getFullYear(), ultimo.getMonth(), ultimo.getDate() + 1).toISOString()

    try {
      const datos = await listEvents({ from, to })
      setEventos(datos)
    } catch (e) {
      console.error('[CalendarView] error al cargar eventos:', e)
    } finally {
      setCargando(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesActivo])

  useEffect(() => {
    setCargando(true)
    cargarEventos()
  }, [cargarEventos])

  // Refresca sin navegar si una acción externa muta los eventos de calendario.
  useEffect(() => {
    function onCambio() { cargarEventos() }
    eventsChanged.addEventListener('change', onCambio)
    return () => eventsChanged.removeEventListener('change', onCambio)
  }, [cargarEventos])

  // Persiste el mes para restaurarlo en el próximo arranque de la app.
  useEffect(() => {
    localStorage.setItem(LS_KEY, mesActivo.toISOString())
  }, [mesActivo])

  // ── Navegación de mes ───────────────────────────────────────────────────────

  function irMesAnterior() {
    setMesActivo(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
    setPanel(null)
  }

  function irMesSiguiente() {
    setMesActivo(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
    setPanel(null)
  }

  function irHoy() {
    setMesActivo(primerDiaDeMes(new Date()))
    setPanel(null)
  }

  // ── Handlers del panel ──────────────────────────────────────────────────────

  // Click en una píldora de evento: abre el detalle individual.
  function handleEventoClick(evento: CalendarEvent) {
    setPanel({ tipo: 'evento', evento, origenDia: null })
  }

  // Click en "+N MÁS": abre la lista de todos los eventos del día.
  function handleDiaClick(fecha: Date) {
    setPanel({ tipo: 'dia', fecha })
  }

  // Click en una tarjeta dentro de la lista del día: navega al detalle
  // guardando la fecha de origen para poder volver con "◂ VOLVER".
  function handleEventoDesdeListaDia(evento: CalendarEvent) {
    setPanel(prev => ({
      tipo: 'evento',
      evento,
      origenDia: prev?.tipo === 'dia' ? prev.fecha : null,
    }))
  }

  // "◂ VOLVER": retorna a la lista del día de origen.
  function handleVolver() {
    setPanel(prev => {
      if (prev?.tipo === 'evento' && prev.origenDia) {
        return { tipo: 'dia', fecha: prev.origenDia }
      }
      return null
    })
  }

  // Click en celda vacía: cierra el panel (stub de creación en 6c).
  function handleCeldaClick(_fecha: Date) {
    setPanel(null)
    // TODO 6c: abrir formulario de creación de evento para _fecha
    console.log('crear evento en día', _fecha.toISOString())
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const panelAbierto = panel !== null

  // Cuando el panel es de tipo 'dia', los eventos se derivan siempre del
  // porDia fresco (no del estado del panel) para reflejar importaciones en vivo.
  const eventosDia = panel?.tipo === 'dia'
    ? (porDia.get(fechaLocalISO(panel.fecha)) ?? [])
    : []

  return (
    <div className="calendar-view">
      {/* Cabecera: título del mes + navegación */}
      <header className="calendar-header">
        <h1 className="calendar-mes-titulo">
          {mes} <span className="calendar-año">{año}</span>
        </h1>
        <nav className="calendar-nav" aria-label="Navegación del calendario">
          <button className="calendar-nav-btn" onClick={irMesAnterior}>
            <span>◂ MES ANTERIOR</span>
          </button>
          <button className="calendar-nav-btn calendar-nav-btn--hoy" onClick={irHoy}>
            <span>HOY</span>
          </button>
          <button className="calendar-nav-btn" onClick={irMesSiguiente}>
            <span>MES SIGUIENTE ▸</span>
          </button>
        </nav>
      </header>

      {/* Fila de días de la semana */}
      <div className="calendar-dias-semana">
        {DIAS_SEMANA.map(d => (
          <div key={d} className="calendar-dia-semana">{d}</div>
        ))}
      </div>

      {/* Cuerpo: cuadrícula + panel lateral side-by-side */}
      <div className="calendar-body">
        {cargando ? (
          <div className="calendar-cargando" role="status">
            <span className="cursor-stream">█</span>
          </div>
        ) : (
          // key=mesActivo.getTime() recrea el elemento al cambiar de mes,
          // relanzando automáticamente la animación @keyframes calendar-fade-in.
          <div key={mesActivo.getTime()} className="calendar-grid">
            {cuadricula.map(fecha => {
              const clave = fechaLocalISO(fecha)
              return (
                <CalendarDay
                  key={clave}
                  fecha={fecha}
                  eventos={porDia.get(clave) ?? []}
                  esHoy={mismoDia(fecha, hoy)}
                  esDelMesActivo={fecha.getMonth() === mesActivo.getMonth()}
                  onEventoClick={handleEventoClick}
                  onCeldaClick={handleCeldaClick}
                  onDiaClick={handleDiaClick}
                />
              )
            })}
          </div>
        )}

        {/* Panel lateral: transición CSS de anchura (side-by-side) */}
        <aside
          className={`calendar-panel${panelAbierto ? ' calendar-panel--abierto' : ''}`}
          aria-label="Detalle del calendario"
        >
          {panel?.tipo === 'dia' && (
            <DayListPanel
              fecha={panel.fecha}
              eventos={eventosDia}
              onEventoClick={handleEventoDesdeListaDia}
              onCerrar={() => setPanel(null)}
            />
          )}
          {panel?.tipo === 'evento' && (
            <EventDetailPanel
              evento={panel.evento}
              onCerrar={() => setPanel(null)}
              onVolver={panel.origenDia ? handleVolver : undefined}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

export default CalendarView
