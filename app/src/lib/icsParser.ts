import ICAL from 'ical.js'
import type { NewCalendarEvent } from './types'

// Ventana de expansión para eventos recurrentes (RRULE).
// Sin este límite, un FREQ=DAILY sin UNTIL/COUNT generaría decenas de miles
// de filas en la BD. 30 días al pasado captura eventos en curso; 365 al futuro
// es suficiente para planificación anual sin explotar el almacenamiento.
export const RECURRENCE_EXPANSION_PAST_DAYS = 30
export const RECURRENCE_EXPANSION_FUTURE_DAYS = 365

// ical.js tiene sus propios tipos internos. Usamos los que provee el paquete.
type ICALTime = InstanceType<typeof ICAL.Time>
type ICALEvent = InstanceType<typeof ICAL.Event>

// ─── Helpers de conversión de fecha ─────────────────────────────────────────

function timedToIso(time: ICALTime): string {
  // toJSDate() convierte al momento UTC equivalente; toISOString() lo serializa
  // siempre con sufijo Z, que es ISO 8601 con offset UTC. Los clientes que
  // necesiten mostrar hora local harán la conversión desde este valor.
  return time.toJSDate().toISOString()
}

function allDayToIso(time: ICALTime): string {
  // Para eventos de día completo solo nos importa la fecha; normalizamos la
  // hora a medianoche UTC para que el almacenamiento sea uniforme con el resto.
  const mm = String(time.month).padStart(2, '0')
  const dd = String(time.day).padStart(2, '0')
  return `${time.year}-${mm}-${dd}T00:00:00Z`
}

function addOneHour(isoStart: string): string {
  const d = new Date(isoStart)
  d.setTime(d.getTime() + 60 * 60 * 1000)
  return d.toISOString()
}

// ─── Conversión de evento/ocurrencia a NewCalendarEvent ──────────────────────

function buildEvent(
  icalEvent: ICALEvent,
  uid: string,
  startTime: ICALTime,
  endTime: ICALTime | null
): NewCalendarEvent {
  const isAllDay = startTime.isDate
  const start_at = isAllDay ? allDayToIso(startTime) : timedToIso(startTime)

  let end_at: string
  if (endTime !== null) {
    end_at = isAllDay ? allDayToIso(endTime) : timedToIso(endTime)
  } else {
    // Evento sin DTEND ni DURATION explícitos: asumimos 1h, igual que hacen
    // Google Calendar y Apple Calendar con archivos .ics no conformes.
    console.warn(`[icsParser] Evento ${uid} sin DTEND, asumiendo duración de 1h.`)
    end_at = addOneHour(start_at)
  }

  return {
    uid,
    title: icalEvent.summary?.trim() || '(sin título)',
    description: icalEvent.description?.trim() || null,
    location: icalEvent.location?.trim() || null,
    start_at,
    end_at,
    all_day: isAllDay ? 1 : 0,
    source: 'ics_import',
  }
}

// ─── Parser principal ─────────────────────────────────────────────────────────

/**
 * Convierte el texto crudo de un archivo .ics en un array de NewCalendarEvent
 * listos para pasarse a upsertEventByUid.
 *
 * Garantías:
 * - Los caracteres escapados del RFC 5545 (\, \; \n) los resuelve ical.js.
 * - Los eventos con error de parseo individual se omiten (con console.warn)
 *   sin abortar el import completo.
 * - Las recurrencias se expanden solo dentro de la ventana definida por las
 *   constantes RECURRENCE_EXPANSION_*_DAYS exportadas arriba.
 */
export function parseIcsToEvents(rawIcs: string): NewCalendarEvent[] {
  // Parseo del calendario completo. Un error aquí significa archivo corrupto.
  let jcal: ReturnType<typeof ICAL.parse>
  try {
    jcal = ICAL.parse(rawIcs)
  } catch (e) {
    console.warn('[icsParser] Error al parsear el archivo .ics:', e)
    return []
  }

  const vcalendar = new ICAL.Component(jcal)
  const vevents = vcalendar.getAllSubcomponents('vevent')
  const results: NewCalendarEvent[] = []

  const now = Date.now()
  const windowStartMs = now - RECURRENCE_EXPANSION_PAST_DAYS  * 24 * 60 * 60 * 1000
  const windowEndMs   = now + RECURRENCE_EXPANSION_FUTURE_DAYS * 24 * 60 * 60 * 1000

  for (const vevent of vevents) {
    try {
      const icalEvent = new ICAL.Event(vevent)
      // Algunos .ics generan VEVENTs sin UID (no conformes al RFC). Generamos
      // un UUID estable basado en los datos del evento para no duplicar en
      // reimportaciones del mismo archivo.
      const uid = icalEvent.uid || null

      if (icalEvent.isRecurring()) {
        // Recurrencias: expandimos una ocurrencia a la vez dentro de la ventana.
        // El iterador de ical.js respeta EXDATE y excepciones (RECURRENCE-ID).
        const iter = icalEvent.iterator()
        let nextTime: ICALTime | null = null

        // iter.complete se pone a true cuando se agota el RRULE (UNTIL/COUNT).
        while (!iter.complete) {
          nextTime = iter.next()
          if (!nextTime) break

          const startMs = nextTime.toJSDate().getTime()
          // Saltamos ocurrencias antes de la ventana; cuando superamos el límite
          // superior salimos: el iterador es siempre ascendente.
          if (startMs > windowEndMs) break
          if (startMs < windowStartMs) continue

          const details = icalEvent.getOccurrenceDetails(nextTime)
          // UID derivado: UID maestro + timestamp de inicio de la ocurrencia.
          // Esto permite upsert idempotente por ocurrencia en reimportaciones.
          const occUid = uid ? `${uid}_${nextTime.toICALString()}` : null
          results.push(buildEvent(icalEvent, occUid ?? crypto.randomUUID(), details.startDate, details.endDate))
        }
      } else {
        // Evento simple: detectamos si DTEND o DURATION están presentes antes
        // de acceder a event.endDate, porque ical.js devuelve startDate como
        // fallback cuando ninguno existe (enmascarando el dato ausente).
        const hasDtend    = vevent.hasProperty('dtend')
        const hasDuration = vevent.hasProperty('duration')
        const endTime     = (hasDtend || hasDuration) ? icalEvent.endDate : null

        results.push(buildEvent(icalEvent, uid ?? crypto.randomUUID(), icalEvent.startDate, endTime))
      }
    } catch (e) {
      console.warn('[icsParser] Evento omitido por error de parseo:', e)
    }
  }

  return results
}
