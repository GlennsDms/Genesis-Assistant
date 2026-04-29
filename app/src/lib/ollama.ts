const OLLAMA_URL = 'http://localhost:11434/api/chat'
const MODEL      = 'llama3.2:3b'

// El system prompt define la identidad del asistente y sus restricciones de comportamiento.
// Colocarlo aquí centraliza cualquier ajuste de personalidad en un solo lugar.
const SYSTEM_PROMPT = `Eres Genesis, asistente personal con personalidad ligeramente rebelde y extremadamente eficiente. Estética Persona 5: directo, contundente, sin adornos. Responde siempre en español. Sé conciso — máximo 2-3 oraciones salvo que te pidan más. Cuando el usuario pida algo accionable (recordatorio, evento, tarea), confírmalo verbalmente pero no lo ejecutes — esa lógica se implementa en un hito posterior. Nunca uses emojis. No te disculpes innecesariamente.`

export type OllamaMensaje = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Envía el historial de mensajes a Ollama y llama a `onChunk` con cada
 * fragmento de texto a medida que el modelo lo genera.
 *
 * El system prompt se inyecta internamente — el caller solo gestiona
 * el historial visible (user / assistant).
 */
export async function streamChat(
  mensajes: OllamaMensaje[],
  onChunk: (texto: string) => void
): Promise<void> {
  let response: Response

  try {
    response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...mensajes],
        stream: true,
      }),
    })
  } catch {
    // fetch lanza NetworkError si el host no está disponible (Ollama apagado, puerto incorrecto, etc.)
    onChunk('Conexión con Genesis perdida. ¿Está Ollama corriendo?')
    return
  }

  if (!response.ok) {
    onChunk(`Error del servidor: ${response.status} ${response.statusText}`)
    return
  }

  const reader  = response.body!.getReader()
  const decoder = new TextDecoder()

  // Ollama emite NDJSON (una línea JSON por token generado), pero los límites
  // de los chunks TCP no coinciden necesariamente con los saltos de línea.
  // Un solo read() puede traer varias líneas completas, o una línea cortada a la mitad.
  // El buffer acumula el texto incompleto entre iteraciones hasta tener una línea entera.
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    // { stream: true } indica al decoder que puede haber bytes de continuación
    // de caracteres multibyte (UTF-8) al final del chunk — los retiene en lugar de corromperlos.
    buffer += decoder.decode(value, { stream: true })

    // Separamos las líneas completas y dejamos en el buffer el fragmento final,
    // que puede ser el inicio de una línea que completará el siguiente read().
    const lineas = buffer.split('\n')
    buffer = lineas.pop() ?? ''

    for (const linea of lineas) {
      if (!linea.trim()) continue

      try {
        const json = JSON.parse(linea)
        const fragmento = json.message?.content
        if (fragmento) onChunk(fragmento)
        if (json.done) return
      } catch {
        // Línea no parseable — puede ocurrir en el chunk de cierre del stream.
      }
    }
  }
}
