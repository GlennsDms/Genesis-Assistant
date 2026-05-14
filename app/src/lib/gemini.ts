// Cliente Gemini API para Genesis.
//
// Por qué fetch directo desde el frontend:
//   Genesis es BYOK (bring your own key). La API key del usuario se guarda en
//   SQLite local (app_settings) y nunca sale del dispositivo hacia servidores
//   de Genesis — solo viaja en requests directos del frontend a Google. No hay
//   backend propio que actúe de proxy, lo que elimina una superficie de ataque
//   y una dependencia de infraestructura. La deuda técnica asociada (la key
//   vive en SQLite sin cifrado fuerte) está documentada en CLAUDE.md; la
//   migración a tauri-plugin-stronghold se planifica para un hito futuro.
//
// Diferencias clave con Ollama:
//   · Roles: 'user' | 'model'  (Ollama usaba 'user' | 'assistant' | 'system')
//   · System prompt: campo aparte `system_instruction`, no en contents[].
//   · Streaming: SSE estándar (`data: {...}\n\n`), no NDJSON línea a línea.
//   · Function calling: tools van como `tools: [{functionDeclarations:[...]}]`;
//     el modelo devuelve `parts[{functionCall:{name,id?,args}}]`;
//     el resultado se envía como `role:'user', parts:[{functionResponse:{...}}]`.
//   · Auth: header `x-goog-api-key` (no Basic Auth).

import { getSetting, SETTING_KEYS } from './settings'
import { executeTool, esToolCallVacio, normalizarArgs } from './toolExecutor'
import type { GeminiTool, GeminiFunctionCall } from './tools'

// ── Tipos públicos ────────────────────────────────────────────────────────────

// Formato del historial que gestiona el caller (HomeView).
// 'model' es el rol que Gemini usa para el asistente (no 'assistant').
export type GeminiMensaje = {
  role: 'user' | 'model'
  content: string
}

export interface StreamChatOptions {
  tools?: GeminiTool[]
  onToolCall?: (
    nombre: string,
    estado: 'ejecutando' | 'exito' | 'error',
    detalle?: string
  ) => void
  signal?: AbortSignal
}

// Errores tipados para que la UI pueda reaccionar con mensajes específicos.
export class MissingApiKeyError extends Error {
  constructor() {
    super('No hay API key de Gemini configurada.')
    this.name = 'MissingApiKeyError'
  }
}

export class InvalidApiKeyError extends Error {
  constructor() {
    super('La API key de Gemini es inválida o ha expirado.')
    this.name = 'InvalidApiKeyError'
  }
}

// ── Constantes ────────────────────────────────────────────────────────────────

const MODEL = 'gemini-2.5-flash'
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const STREAM_URL = `${BASE_URL}/${MODEL}:streamGenerateContent?alt=sse`
const GENERATE_URL = `${BASE_URL}/${MODEL}:generateContent`

const TOOL_TIMEOUT_MS = 30_000

// ── System prompt ─────────────────────────────────────────────────────────────

const PROMPT_BASE = `Eres Genesis, un asistente personal. Directo, algo rebelde, conciso. Responde siempre en español. Sin emojis. Sin disculpas innecesarias.

HERRAMIENTAS DISPONIBLES:
- crear_evento: úsala cuando el usuario quiera agendar algo que ocupa una franja horaria del calendario — tiene fecha, hora de inicio, opcionalmente duración o lugar. Ejemplos: "reunión con Marta el viernes a las 15", "clase de yoga mañana de 18:00 a 19:00".
- crear_recordatorio: úsala cuando el usuario pida que Genesis le avise o recuerde algo a una hora concreta, sin que eso ocupe espacio en el calendario. Es un aviso puntual, sin duración ni lugar. Ejemplos: "recuérdame llamar a mamá mañana a las 20", "avísame a las 9 de que tengo que enviar el informe". Si el usuario no especifica hora, pregúntale antes de invocar.

EN TODOS LOS DEMÁS CASOS responde con texto natural y útil:
- Saludos, charla casual → conversación amable y breve.
- Preguntas generales, recomendaciones, consejos, opiniones → respóndelas con confianza. No te excuses, no digas "no puedo", no remitas a otras fuentes innecesariamente. Si te piden opinión, dala.
- Cuando el usuario rectifica, cancela o cambia de tema → responde en texto, no invoques nada.

Si dudas entre invocar una herramienta o responder en texto, responde en texto. Un falso negativo es preferible a una invocación no solicitada.

NUNCA inventes nombres de herramientas. Solo existen crear_evento y crear_recordatorio.

INSTRUCCIONES PARA FECHAS RELATIVAS:
- "hoy" = la fecha actual.
- "mañana" = la fecha actual + 1 día.
- "el lunes" / "el próximo lunes" = el siguiente lunes desde hoy. Si hoy ES lunes, se refiere al lunes de la semana siguiente, NO a hoy.
- Calcula siempre desde la fecha actual indicada más abajo. NO uses fechas memorizadas de entrenamiento.

Si el usuario incluye varias peticiones en un mismo mensaje, atiende SOLO la primera o pídele que las separe. No invoques múltiples herramientas en un solo turno.`

function buildSystemPrompt(): string {
  const ahora = new Date()
  const fechaLocal = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(ahora)
  return `${PROMPT_BASE}\n\nFecha y hora actual: ${fechaLocal}. Zona horaria: Europe/Madrid.`
}

// ── Tipos internos de la API de Gemini ───────────────────────────────────────

interface GeminiPart {
  text?: string
  functionCall?: GeminiFunctionCall
  functionResponse?: {
    name: string
    id?: string
    response: Record<string, unknown>
  }
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiRequest {
  system_instruction: { parts: [{ text: string }] }
  contents: GeminiContent[]
  tools?: GeminiTool[]
}

// Respuesta de generateContent (no-streaming).
interface GeminiGenerateResponse {
  candidates?: Array<{
    content: {
      role: string
      parts: GeminiPart[]
    }
    finishReason?: string
  }>
  error?: {
    code: number
    message: string
    status: string
  }
}

// Cada chunk SSE de streamGenerateContent tiene la misma forma que candidates[].
interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[]
    }
  }>
  error?: {
    code: number
    message: string
  }
}

// ── Helper: construir headers ─────────────────────────────────────────────────

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  }
}

// ── Helper: construir contents desde historial público ───────────────────────

function mensajesToContents(mensajes: GeminiMensaje[]): GeminiContent[] {
  return mensajes.map(m => ({
    role: m.role,
    parts: [{ text: m.content }],
  }))
}

// ── Helper: parsear error HTTP de Gemini ─────────────────────────────────────

function handleHttpError(status: number, onChunk: (t: string) => void): void {
  if (status === 401 || status === 403) {
    throw new InvalidApiKeyError()
  }
  if (status === 429) {
    onChunk('Demasiadas peticiones a Gemini. Espera un momento e inténtalo de nuevo.')
    return
  }
  onChunk(`Error del servidor Gemini: ${status}. Inténtalo de nuevo.`)
}

// ── Punto de entrada público ──────────────────────────────────────────────────

/**
 * Envía los mensajes a Gemini y llama a onChunk con cada fragmento de texto.
 * Lanza MissingApiKeyError si no hay key configurada.
 * Lanza InvalidApiKeyError si la key es inválida (401/403).
 *
 * Con tools: primera llamada no-streaming para detectar functionCall,
 * segunda llamada streaming para la respuesta final al usuario.
 * Sin tools: llamada streaming directa.
 */
export async function streamChat(
  mensajes: GeminiMensaje[],
  onChunk: (texto: string) => void,
  opciones?: StreamChatOptions
): Promise<void> {
  const apiKey = await getSetting(SETTING_KEYS.GEMINI_API_KEY)
  if (!apiKey) throw new MissingApiKeyError()

  const systemPrompt = buildSystemPrompt()
  const contents = mensajesToContents(mensajes)

  if (opciones?.tools && opciones.tools.length > 0) {
    await flujoConTools(apiKey, systemPrompt, contents, onChunk, opciones)
  } else {
    await flujoStream(apiKey, systemPrompt, contents, onChunk, opciones?.signal)
  }
}

// ── Flujo estándar: streaming SSE sin tools ───────────────────────────────────

async function flujoStream(
  apiKey: string,
  systemPrompt: string,
  contents: GeminiContent[],
  onChunk: (texto: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const body: GeminiRequest = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
  }

  let response: Response
  try {
    response = await fetch(STREAM_URL, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return
    onChunk('No se pudo conectar con Gemini. Comprueba tu conexión a internet.')
    return
  }

  if (!response.ok) {
    handleHttpError(response.status, onChunk)
    return
  }

  await leerStreamSSE(response, onChunk)
}

// ── Flujo con tools ───────────────────────────────────────────────────────────

async function flujoConTools(
  apiKey: string,
  systemPrompt: string,
  contents: GeminiContent[],
  onChunk: (texto: string) => void,
  opciones: StreamChatOptions
): Promise<void> {
  const { tools, onToolCall, signal } = opciones

  // Primera llamada no-streaming: necesitamos ver la respuesta completa para
  // saber si el modelo emite un functionCall o texto plano. El streaming no
  // permite inspeccionar el tipo de respuesta antes de empezar a procesarla.
  const body: GeminiRequest = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools,
  }

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)
  // Propagar cancelación externa del caller.
  signal?.addEventListener('abort', () => controller.abort())

  let response: Response
  try {
    response = await fetch(GENERATE_URL, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof Error && err.name === 'AbortError') {
      onToolCall?.(tools?.[0]?.functionDeclarations[0]?.name ?? 'tool', 'error', 'TIEMPO AGOTADO')
      return
    }
    onChunk('No se pudo conectar con Gemini. Comprueba tu conexión a internet.')
    return
  }
  clearTimeout(timeoutId)

  if (!response.ok) {
    handleHttpError(response.status, onChunk)
    return
  }

  let data: GeminiGenerateResponse
  try {
    data = await response.json() as GeminiGenerateResponse
  } catch {
    onChunk('Error al procesar la respuesta de Gemini.')
    return
  }

  if (data.error) {
    if (data.error.code === 401 || data.error.code === 403) throw new InvalidApiKeyError()
    onChunk(`Error de Gemini: ${data.error.message}`)
    return
  }

  const candidato = data.candidates?.[0]
  if (!candidato) {
    onChunk('Gemini no devolvió respuesta. Inténtalo de nuevo.')
    return
  }

  const parts = candidato.content.parts

  // ── Caso 1: respuesta de texto, sin functionCall ──
  const textoParts = parts.filter(p => p.text !== undefined)
  const functionCallPart = parts.find(p => p.functionCall !== undefined)

  if (!functionCallPart) {
    const texto = textoParts.map(p => p.text).join('')
    if (texto) onChunk(texto)
    return
  }

  // ── Caso 2: el modelo quiere invocar una herramienta ──
  const fc = functionCallPart.functionCall!
  const toolName = fc.name
  const toolArgs = normalizarArgs(fc.args)

  // Defensa contra nombres inventados.
  const nombresRegistrados = new Set(
    tools?.flatMap(t => t.functionDeclarations.map(d => d.name)) ?? []
  )
  if (!nombresRegistrados.has(toolName)) {
    console.warn(`[genesis-tools] tool no registrado: "${toolName}"`)
    // Enviamos el error de vuelta al modelo para que reformule en texto.
    const mensajesCorreccion: GeminiContent[] = [
      ...contents,
      { role: 'model', parts },
      {
        role: 'user',
        parts: [{
          functionResponse: {
            name: toolName,
            id: fc.id,
            response: {
              error: `La herramienta "${toolName}" no existe. Solo están disponibles crear_evento y crear_recordatorio. Responde al usuario en texto plano.`,
            },
          },
        }],
      },
    ]
    await flujoStream(apiKey, systemPrompt, mensajesCorreccion, onChunk, signal)
    return
  }

  // Pre-check: ignorar silenciosamente si los args son ruido del modelo.
  if (esToolCallVacio(toolName, toolArgs)) {
    console.warn('[genesis-tools] tool call vacío detectado, ignorando, args:', toolArgs)
    const textoRuido = textoParts.map(p => p.text).join('')
    if (textoRuido) {
      onChunk(textoRuido)
    } else {
      await flujoStream(apiKey, systemPrompt, contents, onChunk, signal)
    }
    return
  }

  console.log(`[genesis-tools] tool detectado: ${toolName}, args:`, toolArgs)
  onToolCall?.(toolName, 'ejecutando')

  const resultado = await executeTool(toolName, toolArgs)
  console.log('[genesis-tools] resultado:', resultado)

  // silent_skip defensivo — no debería llegar aquí tras el pre-check.
  if (resultado.ok === 'silent_skip') {
    console.warn('[genesis-tools] silent_skip inesperado tras pre-check')
    await flujoStream(apiKey, systemPrompt, contents, onChunk, signal)
    return
  }

  if (!resultado.ok) {
    onToolCall?.(toolName, 'error', resultado.error)
    // Pasamos el error al modelo para que lo reformule en lenguaje natural.
    const mensajesConError: GeminiContent[] = [
      ...contents,
      { role: 'model', parts },
      {
        role: 'user',
        parts: [{
          functionResponse: {
            name: toolName,
            id: fc.id,
            response: { error: resultado.error },
          },
        }],
      },
    ]
    await flujoStream(apiKey, systemPrompt, mensajesConError, onChunk, signal)
    return
  }

  onToolCall?.(toolName, 'exito')

  // Turno final: el modelo recibe el evento creado y genera la confirmación
  // en lenguaje natural. Esta llamada sí usa streaming — el usuario ve la
  // respuesta en tiempo real.
  const mensajesConResultado: GeminiContent[] = [
    ...contents,
    { role: 'model', parts },
    {
      role: 'user',
      parts: [{
        functionResponse: {
          name: toolName,
          id: fc.id,
          response: { result: resultado.result },
        },
      }],
    },
  ]

  let textoFinal = ''
  await flujoStream(apiKey, systemPrompt, mensajesConResultado, (chunk) => {
    textoFinal += chunk
    onChunk(chunk)
  }, signal)
  console.log('[genesis-tools] respuesta final del modelo:', textoFinal)
}

// ── Helper: leer el stream SSE de Gemini ─────────────────────────────────────

async function leerStreamSSE(
  response: Response,
  onChunk: (texto: string) => void
): Promise<void> {
  const reader  = response.body!.getReader()
  const decoder = new TextDecoder()

  // Gemini emite SSE estándar: cada evento tiene formato
  //   data: {...JSON...}\n\n
  // Los límites de chunk TCP no coinciden con los de evento SSE.
  // El buffer acumula fragmentos parciales hasta tener una línea completa.
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Separamos por salto de línea; la última parte puede ser incompleta.
    const lineas = buffer.split('\n')
    buffer = lineas.pop() ?? ''

    for (const linea of lineas) {
      // Las líneas SSE que no son datos (comentarios, event:, id:) se ignoran.
      if (!linea.startsWith('data: ')) continue
      const raw = linea.slice('data: '.length).trim()
      if (!raw || raw === '[DONE]') continue

      let chunk: GeminiStreamChunk
      try {
        chunk = JSON.parse(raw) as GeminiStreamChunk
      } catch {
        // Línea malformada — habitual en el chunk de cierre.
        continue
      }

      if (chunk.error) {
        if (chunk.error.code === 401 || chunk.error.code === 403) {
          throw new InvalidApiKeyError()
        }
        onChunk(`Error de Gemini durante el stream: ${chunk.error.message}`)
        return
      }

      const texto = chunk.candidates?.[0]?.content?.parts
        ?.filter(p => p.text !== undefined)
        .map(p => p.text)
        .join('') ?? ''

      if (texto) onChunk(texto)
    }
  }
}
