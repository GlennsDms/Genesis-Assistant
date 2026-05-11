// Definiciones de herramientas en el formato nativo de Gemini API.
// Gemini espera: tools: [{ functionDeclarations: [...] }]
// Esto difiere del formato OpenAI/Ollama (type:'function', function:{name,...}).

export interface GeminiFunctionParameter {
  type: string
  description: string
  enum?: string[]
}

export interface GeminiFunctionDeclaration {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, GeminiFunctionParameter>
    required: string[]
  }
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[]
}

// Estructura del functionCall que devuelve el modelo en parts[].
// El campo id es opcional: Gemini lo emite en llamadas paralelas para empatar
// resultados; con un solo tool activo puede llegar vacío.
export interface GeminiFunctionCall {
  name: string
  id?: string
  args: Record<string, unknown>
}

const crearEventoDeclaration: GeminiFunctionDeclaration = {
  name: 'crear_evento',
  description:
    'Crea un evento en el calendario del usuario. Úsala cuando el usuario pida añadir, crear o agendar algo en su calendario. Si falta el título o la fecha de inicio, pregunta al usuario antes de invocar esta herramienta.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Título del evento. Obligatorio. Debe ser descriptivo y conciso.',
      },
      start_at: {
        type: 'string',
        description:
          'Fecha y hora de inicio en formato ISO 8601 con offset de zona horaria. Ejemplo: 2026-05-16T17:00:00+02:00. Obligatorio.',
      },
      end_at: {
        type: 'string',
        description:
          'Fecha y hora de fin en formato ISO 8601 con offset de zona horaria. Si el usuario no lo especifica, omite este campo — el sistema inferirá automáticamente +1 hora desde el inicio.',
      },
      description: {
        type: 'string',
        description: 'Descripción adicional del evento. Omite el campo si no hay información extra.',
      },
      location: {
        type: 'string',
        description: 'Lugar o dirección del evento. Omite el campo si no se especifica.',
      },
      all_day: {
        type: 'boolean',
        description:
          'true si el evento dura todo el día sin hora específica; false si tiene hora de inicio y fin concretos.',
      },
    },
    required: ['title', 'start_at', 'all_day'],
  },
}

// Único array de tools activo en este sub-hito.
// Gemini lo recibe como: tools: GENESIS_TOOLS
export const GENESIS_TOOLS: GeminiTool[] = [
  { functionDeclarations: [crearEventoDeclaration] },
]
