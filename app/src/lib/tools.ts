// Definiciones de herramientas en el formato nativo de Gemini API.
// Gemini espera: tools: [{ functionDeclarations: [...] }]
// Esto difiere del formato OpenAI/Ollama (type:'function', function:{name,...}).

export interface GeminiFunctionParameter {
  type: string
  description: string
  enum?: string[]
  // Para parámetros de tipo 'object' con estructura interna conocida.
  properties?: Record<string, GeminiFunctionParameter>
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

const crearRecordatorioDeclaration: GeminiFunctionDeclaration = {
  name: 'crear_recordatorio',
  description:
    'Crea un recordatorio que Genesis avisa al usuario en la fecha y hora indicadas. Úsala cuando el usuario pida que se le recuerde algo o que se le avise a una hora concreta — un aviso puntual que no ocupa franja horaria en el calendario. Si el usuario menciona una hora específica, inclúyela en due_at. Si no da hora, pregúntale antes de invocar.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Título del recordatorio, descriptivo y conciso. Obligatorio.',
      },
      due_at: {
        type: 'string',
        description:
          'Fecha y hora del aviso en formato ISO 8601 con offset de zona horaria. Ejemplo: 2026-05-16T20:00:00+02:00. Sin este campo no hay alarma.',
      },
      description: {
        type: 'string',
        description: 'Contexto o nota adicional. Omite el campo si no hay información extra.',
      },
    },
    required: ['title'],
  },
}

const listarEventosDeclaration: GeminiFunctionDeclaration = {
  name: 'listar_eventos',
  description:
    'Lista los eventos del calendario en un rango de fechas. Úsala cuando el usuario quiera saber qué tiene agendado — "qué tengo esta semana", "mis eventos de mañana", "hay algo el viernes". El resultado incluye el id de cada evento, imprescindible para usar editar_evento y borrar_evento. Si no se especifica rango, devuelve los próximos 30 días.',
  parameters: {
    type: 'object',
    properties: {
      desde: {
        type: 'string',
        description:
          'Inicio del rango en formato ISO 8601 con offset. Si se omite, se usa la fecha y hora actuales.',
      },
      hasta: {
        type: 'string',
        description:
          'Fin del rango en formato ISO 8601 con offset. Si se omite, se usa desde + 30 días.',
      },
    },
    required: [],
  },
}

const editarEventoDeclaration: GeminiFunctionDeclaration = {
  name: 'editar_evento',
  description:
    'Modifica uno o varios campos de un evento existente. Úsala cuando el usuario quiera cambiar algo de un evento — la hora, el título, la descripción, el lugar. Si no conoces el id del evento, llama primero a listar_eventos para localizarlo por nombre y obtener su id. Nunca pidas el id al usuario — es un detalle interno que el usuario no conoce.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'number',
        description: 'Identificador numérico del evento a modificar. Obligatorio.',
      },
      patch: {
        type: 'object',
        description:
          'Campos a actualizar. Incluye solo los que cambian. Campos permitidos: title (string), description (string), location (string), start_at (ISO 8601 con offset), end_at (ISO 8601 con offset), all_day (boolean).',
        properties: {
          title:       { type: 'string',  description: 'Nuevo título del evento.' },
          description: { type: 'string',  description: 'Nueva descripción del evento.' },
          location:    { type: 'string',  description: 'Nuevo lugar del evento.' },
          start_at:    { type: 'string',  description: 'Nueva fecha y hora de inicio en ISO 8601 con offset.' },
          end_at:      { type: 'string',  description: 'Nueva fecha y hora de fin en ISO 8601 con offset.' },
          all_day:     { type: 'boolean', description: 'true si el evento es de todo el día, false si tiene hora concreta.' },
        },
      },
    },
    required: ['id', 'patch'],
  },
}

const borrarEventoDeclaration: GeminiFunctionDeclaration = {
  name: 'borrar_evento',
  description:
    'Elimina permanentemente un evento del calendario. Úsala cuando el usuario quiera borrar o cancelar un evento. SIEMPRE llama primero a listar_eventos para obtener el id — nunca pidas el id al usuario ni lo inventes.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'number',
        description: 'Identificador numérico del evento a eliminar. Obligatorio.',
      },
    },
    required: ['id'],
  },
}

// Único array de tools activo. Todas las declarations van en el mismo objeto GeminiTool
// para que Gemini las trate como un conjunto cohesivo y pueda elegir entre ellas.
export const GENESIS_TOOLS: GeminiTool[] = [
  {
    functionDeclarations: [
      crearEventoDeclaration,
      crearRecordatorioDeclaration,
      listarEventosDeclaration,
      editarEventoDeclaration,
      borrarEventoDeclaration,
    ],
  },
]
