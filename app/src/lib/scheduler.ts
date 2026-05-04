import { invoke } from '@tauri-apps/api/core'

/**
 * Programa una notificación nativa para el recordatorio dado.
 * Si ya había una tarea previa para ese id, el backend la cancela y crea una nueva.
 * Si dueAt ya venció, el backend lo ignora silenciosamente.
 */
export async function scheduleReminder(
  id: number,
  dueAt: string,
  title: string,
  description: string | null,
): Promise<void> {
  try {
    await invoke('schedule_reminder', {
      id,
      due_at_iso: dueAt,
      title,
      description,
    })
  } catch (e) {
    console.error('[genesis] fallo al programar notificación del recordatorio', id, e)
  }
}

/**
 * Cancela la notificación programada para el recordatorio dado.
 * Operación idempotente: si no había nada programado, no hace nada.
 */
export async function cancelReminder(id: number): Promise<void> {
  try {
    await invoke('cancel_reminder', { id })
  } catch (e) {
    console.error('[genesis] fallo al cancelar notificación del recordatorio', id, e)
  }
}
