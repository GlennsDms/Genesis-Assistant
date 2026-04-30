import { useState, useRef, useEffect } from 'react'
import { streamChat } from '../lib/ollama'
import type { OllamaMensaje } from '../lib/ollama'

interface Props {
  userName: string
  pendingCount: number
}

type MensajeVisible = {
  autor: 'usuario' | 'genesis'
  texto: string
}

function obtenerSaludo(): string {
  const hora = new Date().getHours()
  if (hora >= 5 && hora < 12) return 'Buenos días'
  if (hora >= 12 && hora < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function obtenerFecha(): string {
  const ahora  = new Date()
  const dia    = ahora.toLocaleDateString('es-ES', { weekday: 'long' }).toUpperCase()
  const numero = ahora.getDate()
  const mes    = ahora.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase()
  const hora   = ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return `${dia} · ${numero} ${mes} · ${hora}`
}

function HomeView({ userName, pendingCount }: Props) {
  const [mensajes, setMensajes] = useState<MensajeVisible[]>([
    { autor: 'genesis', texto: 'Sistema activo. ¿En qué te ayudo hoy?' },
  ])

  // historialAPI mantiene los mensajes en el formato que espera Ollama (role/content).
  // Se construye en paralelo a mensajes[] y se pasa completo en cada llamada
  // para que el modelo tenga contexto de toda la conversación.
  const [historialAPI, setHistorialAPI] = useState<OllamaMensaje[]>([])

  const [inputTexto, setInputTexto]   = useState('')
  const [respondiendo, setRespondiendo] = useState(false)

  // useRef para acumular el texto del stream sin depender del ciclo de estado.
  // Si usáramos una variable local, el closure de onChunk capturaría su valor
  // inicial y no vería las actualizaciones posteriores.
  const textoStreamRef = useRef('')

  // Referencia al contenedor del historial para forzar el scroll al último mensaje.
  const historialRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = historialRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensajes])

  async function enviarMensaje(e: React.FormEvent) {
    e.preventDefault()
    const texto = inputTexto.trim()
    if (!texto || respondiendo) return

    const mensajeUsuario: OllamaMensaje = { role: 'user', content: texto }
    // Calculamos el historial actualizado aquí para pasárselo directamente a
    // streamChat, evitando depender del estado que React aún no ha aplicado.
    const nuevoHistorial = [...historialAPI, mensajeUsuario]

    setMensajes(prev => [...prev, { autor: 'usuario', texto }])
    setHistorialAPI(nuevoHistorial)
    setInputTexto('')
    setRespondiendo(true)
    textoStreamRef.current = ''

    // Insertamos un mensaje vacío del asistente que se irá completando con cada chunk.
    setMensajes(prev => [...prev, { autor: 'genesis', texto: '' }])

    await streamChat(nuevoHistorial, (chunk) => {
      textoStreamRef.current += chunk
      // Actualizamos el último mensaje del array en lugar de crear uno nuevo
      // por cada token — evita que el historial crezca durante el stream.
      setMensajes(prev => {
        const copia  = [...prev]
        const ultimo = copia[copia.length - 1]
        copia[copia.length - 1] = { ...ultimo, texto: textoStreamRef.current }
        return copia
      })
    })

    // Registramos la respuesta completa en el historial de la API una vez terminado el stream.
    setHistorialAPI(prev => [
      ...prev,
      { role: 'assistant', content: textoStreamRef.current },
    ])

    setRespondiendo(false)
  }

  return (
    <div className="home-view">
      <header className="home-header">
        <h1 className="home-saludo">
          {obtenerSaludo()},{' '}
          <span className="nombre">{userName.toUpperCase()}.</span>
        </h1>
        <p className="home-fecha">{obtenerFecha()}</p>
      </header>

      <section className="home-cards">
        <div className="card">
          <div className="card-numero">3</div>
          <div className="card-label">Eventos hoy</div>
        </div>
        <div className="card">
          <div className="card-numero">{pendingCount}</div>
          <div className="card-label">Recordatorios</div>
        </div>
        <div className="card">
          <div className="card-numero">2h</div>
          <div className="card-label">Bloque de foco</div>
        </div>
      </section>

      <section className="chat-section">
        <div className="chat-historial" ref={historialRef}>
          {mensajes.map((msg, i) => (
            <div key={i} className="chat-mensaje">
              {msg.autor === 'usuario' ? (
                <><span className="prefijo-usr">USR ▸</span> {msg.texto}</>
              ) : (
                <>
                  <span className="prefijo-gen">GEN ▸</span>{' '}
                  {msg.texto}
                  {/* Cursor parpadeante en el último mensaje mientras el modelo genera */}
                  {respondiendo && i === mensajes.length - 1 && (
                    <span className="cursor-stream">█</span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <form className="chat-input-area" onSubmit={enviarMensaje}>
          <span className={`chat-prompt-symbol ${respondiendo ? 'parpadeando' : ''}`}>▸</span>
          <input
            className="chat-input"
            type="text"
            value={inputTexto}
            onChange={(e) => setInputTexto(e.target.value)}
            placeholder={respondiendo ? '' : 'Escribe un mensaje y pulsa Enter...'}
            disabled={respondiendo}
          />
        </form>
      </section>
    </div>
  )
}

export default HomeView
