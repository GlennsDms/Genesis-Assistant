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
