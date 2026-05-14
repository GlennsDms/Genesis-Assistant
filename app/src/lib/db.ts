import Database from '@tauri-apps/plugin-sql'
import type { Reminder, NewReminder, CalendarEvent, NewCalendarEvent } from './types'
import { scheduleReminder, cancelReminder } from './scheduler'

// La instancia se inicializa una vez y se reutiliza. Las migraciones
// se ejecutan automáticamente en el primer arranque gracias al plugin.
let _db: Database | null = null

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:genesis.db')
    // PRAGMA foreign_keys debe activarse por conexión: no persiste entre sesiones
    // y no puede ir en una migración porque sqlx ejecuta cada migración dentro de
    // una transacción y los PRAGMA se ignoran en ese contexto. Activarlo aquí
    // garantiza que ON DELETE CASCADE funcione durante toda la vida del singleton.
    await _db.execute('PRAGMA foreign_keys = ON', [])
  }
  return _db
}

// tauri-plugin-sql abre la conexión de forma lazy: DbInstances (estado Rust del
// plugin) no registra la BD hasta que el frontend llama a Database.load() por
// primera vez. rehydrate_alarms necesita que esa entrada exista para poder
// leer recordatorios. Llamar a openDb() antes de invocar rehydrate_alarms
// garantiza que la conexión está lista y el PRAGMA foreign_keys activado.
export async function openDb(): Promise<void> {
  await getDb()
}

// Canal de invalidación para que acciones externas a RemindersView (alarma,
// futuras integraciones) notifiquen cambios en la BD sin acoplar directamente
// los módulos. Cualquier consumidor suscribe 'change' y refresca su estado.
export const remindersChanged = new EventTarget()

// EventTarget equivalente para eventos de calendario, paralelo a remindersChanged.
//
// Mantenemos EventTargets separados por entidad (remindersChanged, eventsChanged).
// Si en el futuro hay 3+ entidades o consumidores que filtran por tipo, considerar
// unificar a un EventTarget único con discriminador `entity`.
export const eventsChanged = new EventTarget()

/**
 * Devuelve todos los recordatorios: pendientes primero ordenados por due_at
 * (nulos al final), completados al final ordenados por fecha de creación.
 */
export async function listReminders(): Promise<Reminder[]> {
  const db = await getDb()
  return db.select<Reminder[]>(`
    SELECT * FROM reminders
    ORDER BY
      completed ASC,
      CASE WHEN due_at IS NULL THEN 1 ELSE 0 END ASC,
      due_at ASC,
      created_at ASC
  `)
}

export async function createReminder(input: NewReminder): Promise<Reminder> {
  const db = await getDb()
  const result = await db.execute(
    'INSERT INTO reminders (title, description, due_at) VALUES (?, ?, ?)',
    [input.title, input.description, input.due_at]
  )
  // lastInsertId es el id asignado por AUTOINCREMENT.
  const rows = await db.select<Reminder[]>(
    'SELECT * FROM reminders WHERE id = ?',
    [result.lastInsertId]
  )
  remindersChanged.dispatchEvent(new Event('change'))
  return rows[0]
}

export async function updateReminder(
  id: number,
  patch: Partial<Pick<Reminder, 'title' | 'description' | 'due_at'>>
): Promise<void> {
  const db = await getDb()
  const campos = Object.keys(patch) as (keyof typeof patch)[]
  if (campos.length === 0) return

  // Construimos la cláusula SET dinámicamente para actualizar solo los campos provistos.
  const sets   = campos.map(c => `${c} = ?`).join(', ')
  const valores = campos.map(c => patch[c] ?? null)

  await db.execute(`UPDATE reminders SET ${sets} WHERE id = ?`, [...valores, id])
  remindersChanged.dispatchEvent(new Event('change'))
}

export async function toggleReminderCompleted(id: number): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE reminders SET completed = CASE WHEN completed = 0 THEN 1 ELSE 0 END WHERE id = ?',
    [id]
  )
  remindersChanged.dispatchEvent(new Event('change'))
}

// Variante no-toggle para el handler de alarma: siempre fija completed = 1.
// El recordatorio que dispara la alarma era pendiente por definición, así que
// el toggle semántico sería incorrecto. El AND completed = 0 hace la operación
// idempotente: si el handler se ejecuta dos veces (p.ej. por listeners
// duplicados en Strict Mode), la segunda llamada es un no-op y no revierte nada.
export async function markReminderCompleted(id: number): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE reminders SET completed = 1 WHERE id = ? AND completed = 0',
    [id]
  )
  remindersChanged.dispatchEvent(new Event('change'))
}

export async function deleteReminder(id: number): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM reminders WHERE id = ?', [id])
  remindersChanged.dispatchEvent(new Event('change'))
}

// ─── Estadísticas del dashboard ──────────────────────────────────────────────

export type DashboardStats = {
  eventosHoy: number
  recordatoriosHoy: number
}

/**
 * Devuelve el conteo de eventos y recordatorios relevantes para el día actual.
 * Se llama al montar la vista Asistente; React la desmonta al cambiar de sección,
 * así que el refresco al volver es automático sin necesitar pub/sub global.
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const db = await getDb()

  // Aplicamos 'localtime' en ambos lados de la comparación para que SQLite
  // interprete start_at en la zona horaria del sistema en lugar de UTC.
  // Sin el modificador, SQLite normaliza cualquier string ISO 8601 con offset
  // a UTC antes de extraer la fecha, lo que produce off-by-one para eventos
  // cuya hora local cae en un día distinto al UTC (p.ej. 01:30 Madrid = 23:30
  // UTC del día anterior). Con 'localtime' ambos lados usan la misma zona y
  // la comparación es siempre coherente con la intención del usuario.
  const [filaEventos] = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM events WHERE DATE(start_at, 'localtime') = DATE('now', 'localtime')"
  )

  // Mismo razonamiento que el query de eventos: 'localtime' en ambos lados
  // para evitar el mismo off-by-one en recordatorios con due_at cercano a medianoche.
  // Los recordatorios sin due_at (NULL) no aparecen porque DATE(NULL) = NULL.
  const [filaRecordatorios] = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM reminders WHERE DATE(due_at, 'localtime') = DATE('now', 'localtime') AND completed = 0"
  )

  return {
    eventosHoy:       filaEventos?.count       ?? 0,
    recordatoriosHoy: filaRecordatorios?.count ?? 0,
  }
}

// ─── Materialización de eventos como recordatorios ───────────────────────────

// Calcula el due_at que debe tener el recordatorio derivado de un evento.
// Para all-day: 09:00 hora local del día del evento. Usamos la fecha del evento
// (no 'now') para que el cálculo sea correcto si en el futuro se materializan
// días distintos al actual. new Date sin offset trata el string como hora local,
// y toISOString() devuelve el equivalente UTC que acepta el parser RFC 3339 de Rust.
// Para eventos con hora: due_at = start_at del evento, que ya incluye offset.
function calcularDueAt(evento: CalendarEvent): string {
  if (evento.all_day === 1) {
    const fecha = evento.start_at.slice(0, 10) // 'YYYY-MM-DD' sea cual sea el formato original
    return new Date(`${fecha}T09:00:00`).toISOString()
  }
  return evento.start_at
}

// Compara la fecha local de un string ISO con la fecha local actual.
// Equivale a DATE(col, 'localtime') = DATE('now', 'localtime') en SQLite:
// Date() respeta el offset del string, y getFullYear/Month/Date operan en local.
function esHoy(isoDate: string): boolean {
  const d = new Date(isoDate)
  const h = new Date()
  return d.getFullYear() === h.getFullYear() &&
    d.getMonth()         === h.getMonth()    &&
    d.getDate()          === h.getDate()
}

// Crea el recordatorio derivado de un evento si no existe ya uno para él.
// Compartido entre materializeEventsForToday (arranque) y el hook de createEvent,
// así que ambos caminos pasan por la misma lógica sin duplicar código.
async function materializarEvento(db: Database, evento: CalendarEvent): Promise<void> {
  const existentes = await db.select<{ id: number }[]>(
    'SELECT id FROM reminders WHERE source_event_id = ?',
    [evento.id]
  )
  if (existentes.length > 0) return

  const due_at = calcularDueAt(evento)
  // Skip silencioso: si el due_at ya pasó no tiene sentido crear el recordatorio.
  // Aplica tanto a all-day (09:00 fija que ya pasó) como a eventos con hora cuya
  // hora ha transcurrido en el momento de materializar. do_schedule_reminder lo
  // rechazaría de todas formas, pero insertarlo en BD generaría un registro
  // pendiente inutilizable que confundiría la vista de recordatorios.
  if (new Date(due_at) <= new Date()) {
    console.log(`[genesis] materializarEvento: skip evento ${evento.id} — due_at ya pasó (${due_at})`)
    return
  }

  const result = await db.execute(
    'INSERT INTO reminders (title, description, due_at, source_event_id) VALUES (?, ?, ?, ?)',
    [evento.title, evento.description, due_at, evento.id]
  )
  const rows = await db.select<Reminder[]>(
    'SELECT * FROM reminders WHERE id = ?',
    [result.lastInsertId]
  )
  remindersChanged.dispatchEvent(new Event('change'))
  // schedule_reminder cancela internamente cualquier tarea previa para el mismo id
  // (ver lib.rs:92-96), por lo que la llamada es idempotente si se ejecuta más de una vez.
  await scheduleReminder(rows[0].id, due_at, rows[0].title, rows[0].description)
}

/**
 * Lee los eventos cuyo inicio cae en el día local actual y crea un recordatorio
 * derivado por cada uno que aún no lo tenga. Se llama al arranque desde App.tsx,
 * justo después de que rehydrate_alarms ha programado los recordatorios existentes.
 */
export async function materializeEventsForToday(): Promise<void> {
  const db = await getDb()
  const eventosHoy = await db.select<CalendarEvent[]>(
    "SELECT * FROM events WHERE DATE(start_at, 'localtime') = DATE('now', 'localtime')"
  )
  for (const evento of eventosHoy) {
    await materializarEvento(db, evento)
  }
}

// ─── Eventos de calendario ───────────────────────────────────────────────────

/**
 * Devuelve eventos ordenados por start_at.
 * El rango es opcional: si se omite se devuelven todos los eventos.
 */
export async function listEvents(rango?: { from: string; to: string }): Promise<CalendarEvent[]> {
  const db = await getDb()
  if (rango) {
    // Overlap de intervalos: captura eventos cuyo inicio sea anterior al fin
    // del rango Y cuyo fin sea posterior al inicio del rango. Esto incluye
    // eventos que empiezan antes de la ventana pero terminan dentro de ella
    // (p.ej. evento multi-día que cruza el primer lunes de la cuadrícula).
    return db.select<CalendarEvent[]>(
      'SELECT * FROM events WHERE start_at < ? AND end_at > ? ORDER BY start_at ASC',
      [rango.to, rango.from]
    )
  }
  return db.select<CalendarEvent[]>('SELECT * FROM events ORDER BY start_at ASC')
}

export async function createEvent(input: NewCalendarEvent): Promise<CalendarEvent> {
  const db = await getDb()
  const result = await db.execute(
    `INSERT INTO events (uid, title, description, location, start_at, end_at, all_day, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.uid, input.title, input.description, input.location,
     input.start_at, input.end_at, input.all_day, input.source]
  )
  const rows = await db.select<CalendarEvent[]>(
    'SELECT * FROM events WHERE id = ?',
    [result.lastInsertId]
  )
  eventsChanged.dispatchEvent(new Event('change'))

  const evento = rows[0]
  // Si el evento recién creado es de hoy, materializar el recordatorio de inmediato
  // sin esperar al siguiente arranque. esHoy respeta el offset del string ISO.
  if (esHoy(evento.start_at)) {
    await materializarEvento(db, evento)
  }

  return evento
}

export async function updateEvent(id: number, patch: Partial<CalendarEvent>): Promise<void> {
  const db = await getDb()
  // Excluimos campos que nunca deben modificarse externamente.
  const { id: _id, created_at: _ca, ...actualizable } = patch
  const campos = Object.keys(actualizable) as (keyof typeof actualizable)[]
  if (campos.length === 0) return

  const sets    = campos.map(c => `${c} = ?`).join(', ')
  const valores = campos.map(c => actualizable[c] ?? null)

  await db.execute(`UPDATE events SET ${sets} WHERE id = ?`, [...valores, id])
  eventsChanged.dispatchEvent(new Event('change'))

  // Si existe un recordatorio derivado, sincronizar título, descripción y due_at.
  const derivados = await db.select<Reminder[]>(
    'SELECT * FROM reminders WHERE source_event_id = ?',
    [id]
  )
  if (derivados.length > 0) {
    const recordatorio = derivados[0]
    // Releer el evento ya actualizado para calcular el due_at con los datos definitivos.
    const eventoActualizado = await db.select<CalendarEvent[]>(
      'SELECT * FROM events WHERE id = ?',
      [id]
    )
    if (eventoActualizado.length === 0) return
    const evento = eventoActualizado[0]
    const nuevoDueAt = calcularDueAt(evento)

    await db.execute(
      'UPDATE reminders SET title = ?, description = ?, due_at = ? WHERE id = ?',
      [evento.title, evento.description, nuevoDueAt, recordatorio.id]
    )
    remindersChanged.dispatchEvent(new Event('change'))
    // schedule_reminder aborta la tarea anterior para el mismo id antes de crear la nueva
    // (ver lib.rs:92-96), así que no hace falta llamar a cancelReminder por separado.
    await scheduleReminder(recordatorio.id, nuevoDueAt, evento.title, evento.description)
  }
}

export async function deleteEvent(id: number): Promise<void> {
  const db = await getDb()

  // Recuperar el id del recordatorio derivado antes de borrar el evento.
  // El CASCADE borra la fila de BD automáticamente, pero no cancela el tokio task
  // en memoria: sin esta llamada quedaría un timer huérfano que dispararía una
  // notificación de un recordatorio ya inexistente.
  const derivados = await db.select<{ id: number }[]>(
    'SELECT id FROM reminders WHERE source_event_id = ?',
    [id]
  )

  await db.execute('DELETE FROM events WHERE id = ?', [id])
  eventsChanged.dispatchEvent(new Event('change'))

  for (const { id: reminderId } of derivados) {
    await cancelReminder(reminderId)
  }
}

/**
 * Inserta o actualiza un evento identificado por su UID.
 * Clave para reimportaciones idempotentes: si el mismo .ics se importa dos
 * veces, el evento existente se sobreescribe en lugar de duplicarse.
 * Si uid es null, siempre inserta (evento manual sin UID de origen externo).
 *
 * Devuelve el evento resultante junto con isNew para que el llamador pueda
 * distinguir inserciones de actualizaciones (útil para estadísticas de import).
 */
export async function upsertEventByUid(
  input: NewCalendarEvent
): Promise<{ event: CalendarEvent; isNew: boolean }> {
  const db = await getDb()

  if (input.uid !== null) {
    const existing = await db.select<CalendarEvent[]>(
      'SELECT * FROM events WHERE uid = ?',
      [input.uid]
    )
    if (existing.length > 0) {
      await db.execute(
        `UPDATE events
         SET title = ?, description = ?, location = ?, start_at = ?,
             end_at = ?, all_day = ?, source = ?
         WHERE uid = ?`,
        [input.title, input.description, input.location,
         input.start_at, input.end_at, input.all_day, input.source,
         input.uid]
      )
      const rows = await db.select<CalendarEvent[]>(
        'SELECT * FROM events WHERE uid = ?',
        [input.uid]
      )
      eventsChanged.dispatchEvent(new Event('change'))
      return { event: rows[0], isNew: false }
    }
  }

  const event = await createEvent(input)
  return { event, isNew: true }
}
