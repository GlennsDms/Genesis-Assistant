import Database from '@tauri-apps/plugin-sql'

// Claves tipadas para evitar strings sueltos dispersos por el código.
// Añadir aquí cualquier setting futuro.
export const SETTING_KEYS = {
  GEMINI_API_KEY: 'gemini.api_key',
  USER_NAME: 'user.name',
} as const

// Canal de invalidación equivalente a remindersChanged / eventsChanged.
// Los consumidores (SettingsView, gemini.ts) suscriben 'change' para
// reaccionar sin acoplarse directamente al módulo de BD.
export const settingsChanged = new EventTarget()

let _db: Database | null = null

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:genesis.db')
  }
  return _db
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb()
  const rows = await db.select<{ value: string }[]>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key]
  )
  return rows.length > 0 ? rows[0].value : null
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb()
  // INSERT OR REPLACE actualiza updated_at automáticamente gracias al DEFAULT.
  await db.execute(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value]
  )
  settingsChanged.dispatchEvent(new Event('change'))
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM app_settings WHERE key = ?', [key])
  settingsChanged.dispatchEvent(new Event('change'))
}
