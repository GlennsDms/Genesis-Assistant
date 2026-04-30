import Database from '@tauri-apps/plugin-sql'
import type { Reminder, NewReminder } from './types'

// La instancia se inicializa una vez y se reutiliza. Las migraciones
// se ejecutan automáticamente en el primer arranque gracias al plugin.
let _db: Database | null = null

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:genesis.db')
  }
  return _db
}

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
}

export async function toggleReminderCompleted(id: number): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE reminders SET completed = CASE WHEN completed = 0 THEN 1 ELSE 0 END WHERE id = ?',
    [id]
  )
}

export async function deleteReminder(id: number): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM reminders WHERE id = ?', [id])
}
