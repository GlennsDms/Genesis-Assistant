import { useState, useRef, useEffect } from 'react'
import { streamChat, MissingApiKeyError, InvalidApiKeyError } from '../lib/gemini'
import type { GeminiMensaje } from '../lib/gemini'
import { GENESIS_TOOLS } from '../lib/tools'
import MissingApiKeyMessage from '../components/MissingApiKeyMessage'
import { getDashboardStats } from '../lib/db'
import type { DashboardStats } from '../lib/db'

interface Props {
  userName: string
  onIrAjustes: () => void
}

type MensajeVisible = {
  autor: 'usuario' | 'genesis'
  texto: string
}

type ToolStatus =
  | { estado: 'ejecutando'; nombre: string }
  | { estado: 'exito'; nombre: string }
  | { estado: 'error'; mensaje: string }
  | null

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

function HomeView({ userName, onIrAjustes }: Props) {
  const [mensajes, setMensajes] = useState<MensajeVisible[]>([
    { autor: 'genesis', texto: 'Sistema activo. ¿En qué te ayudo hoy?' },
  ])

  // historialAPI mantiene los mensajes en el formato que espera Gemini (role/content).
  // Gemini usa 'model' donde Ollama usaba 'assistant'.
  const [historialAPI, setHistorialAPI] = useState<GeminiMensaje[]>([])

  const [inputTexto, setInputTexto]     = useState('')
  const [respondiendo, setRespondiendo] = useState(false)
  const [toolStatus, setToolStatus]     = useState<ToolStatus>(null)
  // null = sin comprobar aún; true/false = resultado de la comprobación asíncrona.
  const [sinKey, setSinKey]             = useState<boolean | null>(null)

  // null mientras cargan; objeto con conteos una vez resueltos.
  const [stats, setStats] = useState<DashboardStats | null>(null)

  const textoStreamRef   = useRef('')
  const historialRef     = useRef<HTMLDivElement>(null)
  const toolTimeoutRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const el = historialRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensajes])

  // Comprobar si hay key al montar y cuando cambia la configuración.
  // Usamos un import lazy para no crear dependencia circular con settings.ts.
  useEffect(() => {
    let activo = true
    async function comprobarKey() {
      const { getSetting, SETTING_KEYS, settingsChanged } = await import('../lib/settings')
      const verificar = async () => {
        const key = await getSetting(SETTING_KEYS.GEMINI_API_KEY)
        if (activo) setSinKey(!key)
      }
      await verificar()
      settingsChanged.addEventListener('change', verificar)
      return () => settingsChanged.removeEventListener('change', verificar)
    }
    const cleanupPromise = comprobarKey()
    return () => {
      activo = false
      cleanupPromise.then(fn => fn?.())
    }
  }, [])

  // Carga las estadísticas del día al montar la vista.
  // La bandera `cancelado` evita actualizar el estado si el componente se desmontó
  // antes de que resolviera la consulta (race condition de React Strict Mode).
  // Como HomeView se desmonta al cambiar de sección, las stats se refrescan
  // automáticamente al volver; no se necesita pub/sub global por ahora.
  useEffect(() => {
    let cancelado = false

    async function cargarStats() {
      try {
        const datos = await getDashboardStats()
        if (!cancelado) setStats(datos)
      } catch (e) {
        console.error('[genesis] error al cargar estadísticas del dashboard:', e)
      }
    }

    cargarStats()

    return () => { cancelado = true }
  }, [])

  function handleToolCall(
    nombre: string,
    estado: 'ejecutando' | 'exito' | 'error',
    detalle?: string
  ): void {
    if (estado === 'ejecutando') {
      setToolStatus({ estado: 'ejecutando', nombre })
    } else if (estado === 'exito') {
      setToolStatus({ estado: 'exito', nombre })
      if (toolTimeoutRef.current) clearTimeout(toolTimeoutRef.current)
      toolTimeoutRef.current = setTimeout(() => {
        setToolStatus(null)
        toolTimeoutRef.current = null
      }, 2000)
    } else {
      setToolStatus({ estado: 'error', mensaje: detalle ?? 'Error desconocido' })
    }
  }

  async function enviarMensaje(e: React.FormEvent) {
    e.preventDefault()
    const texto = inputTexto.trim()
    if (!texto || respondiendo) return

    if (toolTimeoutRef.current) {
      clearTimeout(toolTimeoutRef.current)
      toolTimeoutRef.current = null
    }
    setToolStatus(null)

    const mensajeUsuario: GeminiMensaje = { role: 'user', content: texto }
    const nuevoHistorial = [...historialAPI, mensajeUsuario]

    setMensajes(prev => [...prev, { autor: 'usuario', texto }])
    setHistorialAPI(nuevoHistorial)
    setInputTexto('')
    setRespondiendo(true)
    textoStreamRef.current = ''

    setMensajes(prev => [...prev, { autor: 'genesis', texto: '' }])

    abortControllerRef.current = new AbortController()

    try {
      await streamChat(
        nuevoHistorial,
        (chunk) => {
          textoStreamRef.current += chunk
          setMensajes(prev => {
            const copia  = [...prev]
            const ultimo = copia[copia.length - 1]
            copia[copia.length - 1] = { ...ultimo, texto: textoStreamRef.current }
            return copia
          })
        },
        {
          tools: GENESIS_TOOLS,
          onToolCall: handleToolCall,
          signal: abortControllerRef.current.signal,
        }
      )
    } catch (err) {
      if (err instanceof MissingApiKeyError) {
        setSinKey(true)
        setMensajes(prev => prev.slice(0, -1)) // quitar el mensaje vacío de genesis
        setRespondiendo(false)
        return
      }
      if (err instanceof InvalidApiKeyError) {
        const textoError = 'API key inválida. Revisa la configuración en Ajustes.'
        textoStreamRef.current = textoError
        setMensajes(prev => {
          const copia = [...prev]
          copia[copia.length - 1] = { ...copia[copia.length - 1], texto: textoError }
          return copia
        })
        setRespondiendo(false)
        return
      }
      // Error genérico inesperado.
      const textoError = 'Algo salió mal. Inténtalo de nuevo.'
      textoStreamRef.current = textoError
      setMensajes(prev => {
        const copia = [...prev]
        copia[copia.length - 1] = { ...copia[copia.length - 1], texto: textoError }
        return copia
      })
      setRespondiendo(false)
      return
    }

    // Defensa contra JSON-as-text: Gemini es más fiable que llama3.2:3b, pero
    // si por algún motivo filtra un functionCall como texto plano, lo detectamos.
    const textoGenerado = textoStreamRef.current
    const esJsonLeak =
      textoGenerado.trimStart().startsWith('{') &&
      textoGenerado.includes('"name"') &&
      (textoGenerado.includes('"parameters"') || textoGenerado.includes('"arguments"') || textoGenerado.includes('"args"'))

    if (esJsonLeak) {
      console.warn('[genesis-tools] JSON-as-text detectado, contenido:', textoGenerado)
      const mensajeCorregido = 'He intentado responder pero algo salió mal. ¿Puedes reformular?'
      textoStreamRef.current = mensajeCorregido
      setMensajes(prev => {
        const copia = [...prev]
        copia[copia.length - 1] = { ...copia[copia.length - 1], texto: mensajeCorregido }
        return copia
      })
    }

    // Registrar la respuesta completa en el historial con rol 'model' (Gemini).
    setHistorialAPI(prev => [
      ...prev,
      { role: 'model', content: textoStreamRef.current },
    ])

    setRespondiendo(false)
  }

  // Mientras se comprueba si hay key, no renderizamos el chat para evitar flash.
  if (sinKey === null) {
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
            <div className="card-numero">{stats?.eventosHoy ?? '—'}</div>
            <div className="card-label">Eventos hoy</div>
          </div>
          <div className="card">
            <div className="card-numero">{stats?.recordatoriosHoy ?? '—'}</div>
            <div className="card-label">Recordatorios</div>
          </div>
          {/* Tarjeta "Bloque de foco" oculta: la sección Horarios no existe todavía
              y mostrar un valor inventado o cero sería engañoso. Se reactivará
              cuando se implemente la vista Horarios. */}
        </section>
      </div>
    )
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
          <div className="card-numero">{stats?.eventosHoy ?? '—'}</div>
          <div className="card-label">Eventos hoy</div>
        </div>
        <div className="card">
          <div className="card-numero">{stats?.recordatoriosHoy ?? '—'}</div>
          <div className="card-label">Recordatorios</div>
        </div>
        {/* Tarjeta "Bloque de foco" oculta: la sección Horarios no existe todavía
            y mostrar un valor inventado o cero sería engañoso. Se reactivará
            cuando se implemente la vista Horarios. */}
      </section>

      <section className="chat-section">
        {sinKey ? (
          <MissingApiKeyMessage onIrAjustes={onIrAjustes} />
        ) : (
          <>
            <div className="chat-historial" ref={historialRef}>
              {mensajes.map((msg, i) => (
                <div key={i} className="chat-mensaje">
                  {msg.autor === 'usuario' ? (
                    <><span className="prefijo-usr">USR ▸</span> {msg.texto}</>
                  ) : (
                    <>
                      <span className="prefijo-gen">GEN ▸</span>{' '}
                      {msg.texto}
                      {respondiendo && i === mensajes.length - 1 && (
                        <span className="cursor-stream">█</span>
                      )}
                      {i === mensajes.length - 1 && toolStatus !== null && (
                        <div className={`tool-badge tool-badge--${toolStatus.estado}`}>
                          {toolStatus.estado === 'ejecutando' &&
                            `▸ EJECUTANDO ${toolStatus.nombre.toUpperCase()}...`}
                          {toolStatus.estado === 'exito' &&
                            `✓ ${toolStatus.nombre === 'crear_recordatorio' ? 'RECORDATORIO CREADO' : 'EVENTO CREADO'}`}
                          {toolStatus.estado === 'error' && `✕ ERROR: ${toolStatus.mensaje}`}
                        </div>
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
          </>
        )}
      </section>
    </div>
  )
}

export default HomeView
