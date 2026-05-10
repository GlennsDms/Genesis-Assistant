import type { CalendarEvent } from './types'

const UN_DIA = 86_400_000

/**
 * Convierte una fecha ISO 8601 en texto legible en español.
 * Ejemplos: "hoy a las 18:00", "mañana a las 9:00",
 *           "el lunes a las 14:30", "el 5 de mayo a las 9:00".
 */
export function formatearFechaRelativa(isoString: string): string {
  const fecha = new Date(isoString)
  const ahora = new Date()

  // Comparamos días de calendario (ignorando la hora) para "hoy/ayer/mañana".
  const inicioHoy   = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  const inicioFecha = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
  const diffDias    = Math.round((inicioFecha.getTime() - inicioHoy.getTime()) / UN_DIA)

  const horaStr = fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

  if (diffDias === 0)  return `hoy a las ${horaStr}`
  if (diffDias === 1)  return `mañana a las ${horaStr}`
  if (diffDias === -1) return `ayer a las ${horaStr}`

  // Dentro de los próximos 7 días usamos el nombre del día de la semana.
  if (diffDias > 1 && diffDias <= 7) {
    const diaSemana = fecha.toLocaleDateString('es-ES', { weekday: 'long' })
    return `el ${diaSemana} a las ${horaStr}`
  }

  // Para fechas más lejanas (o muy pasadas) mostramos "el 5 de mayo a las HH:MM".
  const dia = fecha.getDate()
  const mes = fecha.toLocaleDateString('es-ES', { month: 'long' })
  return `el ${dia} de ${mes} a las ${horaStr}`
}

/**
 * Devuelve true si la fecha ISO ya pasó respecto al momento actual.
 */
export function estaVencida(isoString: string): boolean {
  return new Date(isoString).getTime() < Date.now()
}

/**
 * Convierte una fecha ISO 8601 al formato que acepta <input type="datetime-local">.
 * El input espera "YYYY-MM-DDTHH:MM" en hora local, no UTC.
 */
export function isoAInputLocal(isoString: string): string {
  const d   = new Date(isoString)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Convierte el valor de un <input type="datetime-local"> a ISO 8601 UTC.
 */
export function inputLocalAIso(localString: string): string {
  return new Date(localString).toISOString()
}

// ─── Helpers para la vista de calendario mensual ─────────────────────────────

/**
 * Formatea una fecha local como "YYYY-MM-DD" para usar como clave de mapa.
 * Usa valores locales (getFullYear/Month/Date) para que la clave coincida
 * con la fecha que el usuario ve en pantalla, independientemente del UTC offset.
 */
export function fechaLocalISO(d: Date): string {
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}

// Convierte los primeros 10 caracteres de un ISO en una fecha local midnight.
// Para eventos de día completo el parser almacena YYYY-MM-DDT00:00:00Z usando
// el año/mes/día del calendario directamente (allDayToIso). Si usáramos
// new Date(iso) el offset local podría cambiar el día (UTC−5 → día anterior).
function parseFechaCalendario(iso: string): Date {
  const [y, m, d] = iso.substring(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Convierte un ISO 8601 UTC al inicio del día local equivalente.
function utcAMedianoche(iso: string): Date {
  const d = new Date(iso)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Devuelve 42 fechas (6 semanas × 7 días) para la cuadrícula mensual,
 * comenzando en el lunes de la semana del primer día del mes.
 *
 * El offset (diaSemana + 6) % 7 convierte getDay() de base-domingo a base-lunes:
 *   dom(0)→6, lun(1)→0, mar(2)→1, mié(3)→2, jue(4)→3, vie(5)→4, sáb(6)→5.
 * setDate(1 − offset) desplaza al lunes de esa semana, que puede ser del mes anterior.
 */
export function obtenerCuadriculaMes(mesActivo: Date): Date[] {
  const primerDia  = new Date(mesActivo.getFullYear(), mesActivo.getMonth(), 1)
  const offset     = (primerDia.getDay() + 6) % 7
  const lunesInicial = new Date(mesActivo.getFullYear(), mesActivo.getMonth(), 1 - offset)

  const celdas: Date[] = []
  for (let i = 0; i < 42; i++) {
    celdas.push(new Date(
      lunesInicial.getFullYear(),
      lunesInicial.getMonth(),
      lunesInicial.getDate() + i,
    ))
  }
  return celdas
}

/**
 * Agrupa eventos en un Map<YYYY-MM-DD, CalendarEvent[]> para cada celda de la
 * cuadrícula. Los eventos multi-día se añaden a cada día que cubren.
 *
 * Convención de fechas:
 * - Eventos de día completo: la fecha proviene directamente del string ISO
 *   (sin conversión de zona horaria) porque allDayToIso del parser la graba como
 *   YYYY-MM-DDT00:00:00Z, usando el día de calendario, no el instante UTC.
 * - Eventos con hora: se convierte UTC → medianoche local.
 *
 * DTEND exclusivo (RFC 5545 §3.6.1): para eventos de día completo el parser
 * almacena el DTEND original sin restar 1 día. Lo restamos aquí para obtener
 * el último día real del evento (p.ej. Lisboa 18-21 mayo → end almacenado =
 * 22 mayo → endLocal = 21 mayo).
 */
export function eventosPorDia(
  eventos: CalendarEvent[],
  dias: Date[],
): Map<string, CalendarEvent[]> {
  const mapa = new Map<string, CalendarEvent[]>()
  dias.forEach(d => mapa.set(fechaLocalISO(d), []))

  eventos.forEach(evento => {
    const esAllDay = evento.all_day === 1

    const startLocal = esAllDay
      ? parseFechaCalendario(evento.start_at)
      : utcAMedianoche(evento.start_at)

    const endLocal = esAllDay
      ? new Date(parseFechaCalendario(evento.end_at).getTime() - UN_DIA)
      : utcAMedianoche(evento.end_at)

    const startMs = startLocal.getTime()
    const endMs   = endLocal.getTime()

    dias.forEach(dia => {
      const diaMs = dia.getTime()
      if (diaMs >= startMs && diaMs <= endMs) {
        mapa.get(fechaLocalISO(dia))!.push(evento)
      }
    })
  })

  return mapa
}

/** Nombre del mes en mayúsculas y año como string, listos para la cabecera. */
export function formatearMesAño(d: Date): { mes: string; año: string } {
  return {
    mes: d.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase(),
    año: String(d.getFullYear()),
  }
}

/** true si dos fechas caen en el mismo día del calendario, ignorando la hora. */
export function mismoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate()
}

/**
 * Formatea el rango horario de un evento para el panel de detalle.
 * Ejemplos: "9:30 — 10:30" | "TODO EL DÍA"
 */
export function formatearHoraEvento(evento: CalendarEvent): string {
  if (evento.all_day === 1) return 'TODO EL DÍA'
  const fmt = (d: Date) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return `${fmt(new Date(evento.start_at))} — ${fmt(new Date(evento.end_at))}`
}
