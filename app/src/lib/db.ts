import Database from '@tauri-apps/plugin-sql'
import type { Reminder, NewReminder, CalendarEvent, NewCalendarEvent } from './types'

// La instancia se inicializa una vez y se reutiliza. Las migraciones
// se ejecutan automáticamente en el primer arranque gracias al plugin.
let _db: Database | null = null

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:genesis.db')
  }
  return _db
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

// ─── Eventos de calendario ───────────────────────────────────────────────────

/**
 * Devuelve eventos ordenados por start_at.
 * El rango es opcional: si se omite se devuelven todos los eventos.
 */
export async function listEvents(rango?: { from: string; to: string }): Promise<CalendarEvent[]> {
  const db = await getDb()
  if (rango) {
    return db.select<CalendarEvent[]>(
      'SELECT * FROM events WHERE start_at >= ? AND start_at <= ? ORDER BY start_at ASC',
      [rango.from, rango.to]
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
  return rows[0]
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
}

export async function deleteEvent(id: number): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM events WHERE id = ?', [id])
  eventsChanged.dispatchEvent(new Event('change'))
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
