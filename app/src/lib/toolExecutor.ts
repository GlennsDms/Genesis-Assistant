import { createEvent, createReminder } from './db'
import { scheduleReminder } from './scheduler'
import type { NewCalendarEvent, NewReminder } from './types'

export type ToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string }
  | { ok: 'silent_skip'; reason: string }

// Normaliza los args antes de cualquier comprobación.
// llama3.2:3b emite a veces el string literal "null" en lugar de null real, y campos
// vacíos como '' en lugar de null. Unificamos ambos a null para que pre-check y
// validador los traten igual sin duplicar lógica de casos edge.
export function normalizarArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    out[k] = v === 'null' || v === '' ? null : v
  }
  return out
}

// Pre-check puro (sin efectos secundarios) para detectar tool calls de ruido.
// Condición mínima por herramienta:
//   crear_evento: title Y start_at ambos nulos.
//   crear_recordatorio: title nulo (es el único campo required; due_at es opcional).
// Espera args ya normalizados por normalizarArgs.
export function esToolCallVacio(name: string, args: Record<string, unknown>): boolean {
  if (name === 'crear_evento') return !args.title && !args.start_at
  if (name === 'crear_recordatorio') return !args.title
  return false
}

interface ValidatedCrearEvento {
  title: string
  start_at: string
  end_at: string
  description: string | null
  location: string | null
  all_day: boolean
}

// Valida los args recibidos del modelo para crear_evento.
// Los mensajes de error están en español legible porque la IA los reformula al usuario.
function validateCrearEventoArgs(
  args: unknown
): { ok: true; data: ValidatedCrearEvento } | { ok: false; error: string } {
  if (typeof args !== 'object' || args === null) {
    return { ok: false, error: 'Los argumentos del evento no son válidos.' }
  }

  const a = args as Record<string, unknown>

  // title
  if (typeof a.title !== 'string' || a.title.trim() === '') {
    return { ok: false, error: 'El título no puede estar vacío.' }
  }
  const title = a.title.trim()

  // start_at
  if (typeof a.start_at !== 'string' || a.start_at.trim() === '') {
    return { ok: false, error: 'Falta la fecha y hora de inicio del evento.' }
  }
  const startMs = Date.parse(a.start_at)
  if (isNaN(startMs)) {
    return {
      ok: false,
      error:
        'La fecha de inicio no tiene un formato válido. Usa ISO 8601, por ejemplo 2026-05-16T17:00:00+02:00.',
    }
  }
  // Margen de 60 s para absorber la latencia entre que el modelo resuelve la fecha
  // y el momento en que la validación se ejecuta.
  if (startMs < Date.now() - 60_000) {
    return {
      ok: false,
      error: 'La fecha está en el pasado. ¿Quieres reagendarla para una fecha futura?',
    }
  }
  // Cota superior de 1 año: el modelo pequeño falla con fechas relativas ambiguas
  // y a veces calcula años incorrectos. Más de 1 año es señal de error de cálculo.
  if (startMs > Date.now() + 365 * 24 * 60 * 60_000) {
    const fechaIso = new Date(startMs).toISOString().split('T')[0]
    return {
      ok: false,
      error: `La fecha ${fechaIso} parece estar fuera de rango razonable (más de un año desde hoy). ¿Es correcta?`,
    }
  }
  const start_at = a.start_at.trim()

  // end_at: opcional — si no llega o está vacío se infiere +1 hora.
  let end_at: string
  if (a.end_at !== undefined && a.end_at !== null && a.end_at !== '') {
    if (typeof a.end_at !== 'string') {
      return { ok: false, error: 'La fecha de fin no tiene un formato válido.' }
    }
    const endMs = Date.parse(a.end_at)
    if (isNaN(endMs)) {
      return {
        ok: false,
        error: 'La fecha de fin no tiene un formato válido. Usa ISO 8601.',
      }
    }
    if (endMs <= startMs) {
      return { ok: false, error: 'La fecha de fin debe ser posterior a la de inicio.' }
    }
    end_at = a.end_at.trim()
  } else {
    end_at = new Date(startMs + 60 * 60_000).toISOString()
  }

  const description = typeof a.description === 'string' ? a.description : null
  const location    = typeof a.location    === 'string' ? a.location    : null
  const all_day     = typeof a.all_day     === 'boolean' ? a.all_day    : false

  return { ok: true, data: { title, start_at, end_at, description, location, all_day } }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  if (name === 'crear_evento') {
    // Normalización defensiva: por si executeTool se invoca sin pasar por ollama.ts.
    const argsNorm = normalizarArgs(args)

    // Defensa en profundidad: si se llama sin pasar por el pre-check de flujoConTools.
    if (esToolCallVacio(name, argsNorm)) {
      return { ok: 'silent_skip', reason: 'tool call vacío del modelo' }
    }

    const validation = validateCrearEventoArgs(argsNorm)
    if (!validation.ok) {
      return { ok: false, error: validation.error }
    }

    const input: NewCalendarEvent = {
      uid: null,
      source: 'manual',
      title: validation.data.title,
      description: validation.data.description,
      location: validation.data.location,
      start_at: validation.data.start_at,
      end_at: validation.data.end_at,
      all_day: validation.data.all_day ? 1 : 0,
    }

    try {
      const event = await createEvent(input)
      return { ok: true, result: event }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido al guardar en la base de datos.'
      return { ok: false, error: `No se pudo guardar el evento: ${msg}` }
    }
  }

  if (name === 'crear_recordatorio') {
    const argsNorm = normalizarArgs(args)

    // Defensa en profundidad: por si se invoca sin pasar por el pre-check.
    if (esToolCallVacio(name, argsNorm)) {
      return { ok: 'silent_skip', reason: 'tool call vacío del modelo' }
    }

    if (typeof argsNorm.title !== 'string' || argsNorm.title.trim() === '') {
      return { ok: false, error: 'El título del recordatorio no puede estar vacío.' }
    }
    const title = argsNorm.title.trim()

    // due_at es opcional: un recordatorio sin fecha queda en BD pero no suena.
    // El schema del tool ya advierte de esto, así que no rechazamos la llamada.
    const due_at = typeof argsNorm.due_at === 'string' && argsNorm.due_at.trim() !== ''
      ? argsNorm.due_at.trim()
      : null

    const description = typeof argsNorm.description === 'string' ? argsNorm.description : null

    const input: NewReminder = { title, description, due_at }

    let creado
    try {
      creado = await createReminder(input)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido al guardar en la base de datos.'
      return { ok: false, error: `No se pudo guardar el recordatorio: ${msg}` }
    }

    // Programar la alarma exactamente como lo hace RemindersView.handleCrear:
    // solo si due_at existe y es futuro. Si scheduleReminder falla (error de IPC
    // con Rust), el recordatorio ya está en BD; lo registramos pero no abortamos.
    if (creado.due_at && new Date(creado.due_at) > new Date()) {
      try {
        await scheduleReminder(creado.id, creado.due_at, creado.title, creado.description)
      } catch (err) {
        console.error('[genesis-tools] fallo al programar alarma del recordatorio', creado.id, err)
      }
    }

    return { ok: true, result: creado }
  }

  return {
    ok: false,
    error: `Herramienta desconocida: "${name}". Solo se admiten crear_evento y crear_recordatorio.`,
  }
}
