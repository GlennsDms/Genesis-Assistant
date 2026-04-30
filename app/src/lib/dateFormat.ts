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
