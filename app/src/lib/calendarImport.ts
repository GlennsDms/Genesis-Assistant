import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { parseIcsToEvents } from './icsParser'
import { upsertEventByUid } from './db'

export interface ImportStats {
  imported: number
  updated: number
  failed: number
}

/**
 * Flujo completo de importación desde un archivo .ics local:
 *   1. Abre el diálogo nativo del SO filtrado por .ics.
 *   2. Lee el contenido vía comando Rust (validación de extensión y tamaño en backend).
 *   3. Parsea el texto a NewCalendarEvent[].
 *   4. Hace upsert por UID: cuenta insertados, actualizados y fallidos.
 *
 * Retorna null si el usuario cancela el diálogo sin seleccionar archivo.
 */
export async function importIcsFile(): Promise<ImportStats | null> {
  const selectedPath = await open({
    title: 'Importar calendario',
    filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    multiple: false,
    directory: false,
  })

  // El usuario cerró el diálogo sin seleccionar.
  if (!selectedPath) return null

  // open() con multiple:false devuelve string | null en Tauri 2.
  // La guardia de array cubre versiones del plugin que puedan devolver string[].
  const path = Array.isArray(selectedPath) ? selectedPath[0] : selectedPath

  const rawIcs: string = await invoke('read_text_file', { path })
  const events = parseIcsToEvents(rawIcs)

  const stats: ImportStats = { imported: 0, updated: 0, failed: 0 }

  for (const event of events) {
    try {
      const { isNew } = await upsertEventByUid(event)
      if (isNew) {
        stats.imported++
      } else {
        stats.updated++
      }
    } catch (e) {
      console.warn('[calendarImport] Fallo al persistir evento:', event.uid, e)
      stats.failed++
    }
  }

  return stats
}
