import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

// Props que recibe HomeView desde App.tsx
interface Props {
  userName: string
}

// Tipo que describe un mensaje del chat.
// Un "type" en TS limita los valores posibles: autor solo puede ser 'usuario' o 'genesis'.
type Mensaje = {
  autor: 'usuario' | 'genesis'
  texto: string
}

// Devuelve el saludo según la hora del día
function obtenerSaludo(): string {
  const hora = new Date().getHours()
  if (hora >= 5 && hora < 12) return 'Buenos días'
  if (hora >= 12 && hora < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

// Formatea la fecha como: MIÉRCOLES · 29 ABRIL · 14:32
// toLocaleDateString con 'es-ES' devuelve los nombres en español
function obtenerFecha(): string {
  const ahora = new Date()
  const dia    = ahora.toLocaleDateString('es-ES', { weekday: 'long' }).toUpperCase()
  const numero = ahora.getDate()
  const mes    = ahora.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase()
  const hora   = ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return `${dia} · ${numero} ${mes} · ${hora}`
}

function HomeView({ userName }: Props) {
  // El historial de mensajes empieza con un saludo de GENESIS
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    { autor: 'genesis', texto: 'Sistema activo. ¿En qué te ayudo hoy?' }
  ])

  // El texto que hay ahora mismo en el input del chat
  const [inputTexto, setInputTexto] = useState('')

  // Se ejecuta cuando el usuario pulsa Enter en el input del chat
  async function enviarMensaje(e: React.FormEvent) {
    e.preventDefault()
    const texto = inputTexto.trim()
    if (!texto) return // no enviamos mensajes vacíos

    // 1. Añadimos el mensaje del usuario al historial
    const mensajeUsuario: Mensaje = { autor: 'usuario', texto }
    // prev => [...prev, mensajeUsuario] crea un array nuevo con todos los anteriores + el nuevo
    setMensajes(prev => [...prev, mensajeUsuario])
    setInputTexto('') // limpiamos el input

    // ─── PUENTE REACT ↔ RUST ────────────────────────────────────────────
    // invoke("greet", { name }) llama al comando "greet" definido en
    // src-tauri/src/main.rs. Ese comando recibe un string y devuelve otro.
    // En el futuro, aquí llamaremos a la IA real en lugar de "greet".
    // Abre DevTools (Ctrl+Shift+I) para ver la respuesta de Rust en consola.
    try {
      const respuestaRust = await invoke<string>('greet', { name: texto })
      console.log('[GENESIS → Rust devolvió]:', respuestaRust)
    } catch (err) {
      console.error('[GENESIS] Error al invocar Rust:', err)
    }
    // ────────────────────────────────────────────────────────────────────

    // 2. Añadimos la respuesta hardcoded de GENESIS
    const respuestaGenesis: Mensaje = {
      autor: 'genesis',
      texto: 'Operación registrada. Te aviso cuando toque.'
    }
    setMensajes(prev => [...prev, respuestaGenesis])
  }

  return (
    <div className="home-view">

      {/* Cabecera: saludo dinámico y fecha */}
      <header className="home-header">
        <h1 className="home-saludo">
          {obtenerSaludo()},{' '}
          {/* {' '} añade el espacio que JSX elimina entre elementos */}
          <span className="nombre">{userName.toUpperCase()}.</span>
        </h1>
        <p className="home-fecha">{obtenerFecha()}</p>
      </header>

      {/* Tarjetas de resumen diario */}
      <section className="home-cards">
        <div className="card">
          <div className="card-numero">3</div>
          <div className="card-label">Eventos hoy</div>
        </div>
        <div className="card">
          <div className="card-numero">7</div>
          <div className="card-label">Recordatorios</div>
        </div>
        <div className="card">
          <div className="card-numero">2h</div>
          <div className="card-label">Bloque de foco</div>
        </div>
      </section>

      {/* Chat con GENESIS */}
      <section className="chat-section">

        {/* Historial de mensajes */}
        <div className="chat-historial">
          {mensajes.map((msg, i) => (
            // key={i} le da a React un identificador único para cada mensaje
            <div key={i} className="chat-mensaje">
              {msg.autor === 'usuario' ? (
                <><span className="prefijo-usr">USR ▸</span> {msg.texto}</>
              ) : (
                <><span className="prefijo-gen">GEN ▸</span> {msg.texto}</>
              )}
            </div>
          ))}
        </div>

        {/* Input del chat: al pulsar Enter llama a enviarMensaje */}
        <form className="chat-input-area" onSubmit={enviarMensaje}>
          <span className="chat-prompt-symbol">▸</span>
          <input
            className="chat-input"
            type="text"
            value={inputTexto}
            onChange={(e) => setInputTexto(e.target.value)}
            placeholder="Escribe un mensaje y pulsa Enter..."
          />
        </form>

      </section>
    </div>
  )
}

export default HomeView
