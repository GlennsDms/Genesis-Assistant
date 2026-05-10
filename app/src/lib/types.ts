export interface Reminder {
  id: number
  title: string
  description: string | null
  due_at: string | null
  completed: number   // SQLite no tiene booleanos nativos; 0 = pendiente, 1 = completado
  created_at: string
}

export interface NewReminder {
  title: string
  description: string | null
  due_at: string | null
}

// Payload del evento Tauri "reminder-due" emitido por el scheduler de Rust.
export interface AlarmPayload {
  id: number
  title: string
  description: string | null
}

// CalendarEvent (no Event) para no colisionar con el Event global del DOM.
export interface CalendarEvent {
  id: number
  uid: string | null
  title: string
  description: string | null
  location: string | null
  start_at: string       // ISO 8601 con offset (UTC = '...Z')
  end_at: string         // ISO 8601 con offset (UTC = '...Z')
  all_day: number        // 0 | 1, igual que completed en Reminder
  source: 'manual' | 'ics_import'
  created_at: string
}

export interface NewCalendarEvent {
  uid: string | null
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string
  all_day: number
  source: 'manual' | 'ics_import'
}
