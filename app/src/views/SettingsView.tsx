import { useState, useEffect } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { importIcsFile, type ImportStats } from '../lib/calendarImport'
import { getSetting, setSetting, deleteSetting, SETTING_KEYS } from '../lib/settings'

// Valida la key haciendo una llamada mínima a Gemini (sin tools, sin historial).
// Devuelve true si 200 OK, lanza error con mensaje legible si no.
async function validarApiKey(key: string): Promise<void> {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
    }),
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error('API key inválida. Comprueba que la copiaste correctamente.')
  }
  if (res.status === 429) {
    // Rate limit cuenta como key válida — simplemente hay demasiadas peticiones.
    return
  }
  if (!res.ok) {
    throw new Error(`Error ${res.status} al verificar la key. Inténtalo de nuevo.`)
  }
}

// Ofusca la key mostrando solo los últimos 4 caracteres.
function ofuscarKey(key: string): string {
  if (key.length <= 4) return key
  return '••••••••••••' + key.slice(-4)
}

function SettingsView() {
  // ── Estado: importación .ics ──────────────────────────────────────────────
  const [stats, setStats]         = useState<ImportStats | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // ── Estado: API key ───────────────────────────────────────────────────────
  const [keyGuardada, setKeyGuardada]   = useState<string | null>(null)
  const [inputKey, setInputKey]         = useState('')
  const [mostrarKey, setMostrarKey]     = useState(false)
  const [guardando, setGuardando]       = useState(false)
  const [keyFeedback, setKeyFeedback]   = useState<
    { tipo: 'ok' | 'error'; mensaje: string } | null
  >(null)

  // Carga la key guardada al montar.
  useEffect(() => {
    getSetting(SETTING_KEYS.GEMINI_API_KEY).then(k => setKeyGuardada(k))
  }, [])

  async function handleImportIcs() {
    setImporting(true)
    setStats(null)
    setImportError(null)
    try {
      const result = await importIcsFile()
      if (result !== null) setStats(result)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  async function handleGuardarKey() {
    const key = inputKey.trim()
    if (!key) return
    setGuardando(true)
    setKeyFeedback(null)
    try {
      await validarApiKey(key)
      await setSetting(SETTING_KEYS.GEMINI_API_KEY, key)
      setKeyGuardada(key)
      setInputKey('')
      setKeyFeedback({ tipo: 'ok', mensaje: '✓ Key guardada y verificada.' })
    } catch (e) {
      setKeyFeedback({
        tipo: 'error',
        mensaje: e instanceof Error ? e.message : 'Error desconocido.',
      })
    } finally {
      setGuardando(false)
    }
  }

  async function handleEliminarKey() {
    await deleteSetting(SETTING_KEYS.GEMINI_API_KEY)
    setKeyGuardada(null)
    setInputKey('')
    setKeyFeedback(null)
  }

  return (
    <div className="settings-view">
      {/* ── Sección: API Key de Gemini ──────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <div className="settings-acento" />
          <h2 className="settings-titulo">API KEY DE GEMINI</h2>
        </div>

        {keyGuardada ? (
          <div className="settings-key-guardada">
            <span className="settings-key-valor">{ofuscarKey(keyGuardada)}</span>
            <button className="settings-btn settings-btn--danger" onClick={handleEliminarKey}>
              ELIMINAR
            </button>
          </div>
        ) : (
          <div className="settings-key-input-row">
            <input
              className="settings-input"
              type={mostrarKey ? 'text' : 'password'}
              value={inputKey}
              onChange={e => setInputKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleGuardarKey() }}
              placeholder="AIza..."
              disabled={guardando}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              className="settings-btn settings-btn--ghost"
              onClick={() => setMostrarKey(v => !v)}
              type="button"
            >
              {mostrarKey ? 'OCULTAR' : 'MOSTRAR'}
            </button>
            <button
              className="settings-btn settings-btn--primary"
              onClick={handleGuardarKey}
              disabled={guardando || !inputKey.trim()}
              type="button"
            >
              {guardando ? 'VERIFICANDO...' : 'GUARDAR'}
            </button>
          </div>
        )}

        {keyFeedback && (
          <p className={`settings-feedback settings-feedback--${keyFeedback.tipo}`}>
            {keyFeedback.mensaje}
          </p>
        )}

        {/* Instrucciones para obtener la key */}
        <div className="settings-instrucciones">
          <p className="settings-mono">▸ Cómo conseguir tu API key:</p>
          <ol className="settings-mono settings-lista">
            <li>
              Ve a{' '}
              <button
                className="settings-link"
                onClick={() => openUrl('https://aistudio.google.com')}
              >
                aistudio.google.com
              </button>
              {' '}(necesitas una cuenta de Google)
            </li>
            <li>Click en "Get API key" → "Create API key"</li>
            <li>Copia la key (empieza por AIza...) y pégala aquí</li>
          </ol>

          <p className="settings-mono settings-aviso-titulo">▸ Aviso de privacidad</p>
          <p className="settings-mono settings-aviso-texto">
            Genesis envía tus mensajes del chat a Google Gemini API.<br />
            En el tier gratuito, Google puede usar tus prompts para mejorar<br />
            sus modelos. Si esto te preocupa, considera no usar el chat<br />
            o pasar al tier de pago de Google (no gestionado por Genesis).<br />
            Tus recordatorios y eventos siguen siendo 100% locales.
          </p>
        </div>
      </section>

      {/* ── Sección: Importar calendario ───────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <div className="settings-acento" />
          <h2 className="settings-titulo">IMPORTAR CALENDARIO</h2>
        </div>

        <div className="settings-import-row">
          <button
            className="settings-btn settings-btn--primary"
            onClick={handleImportIcs}
            disabled={importing}
          >
            {importing ? 'IMPORTANDO...' : 'IMPORTAR .ICS'}
          </button>

          {stats !== null && (
            <p className="settings-mono">
              {stats.imported} nuevos · {stats.updated} actualizados · {stats.failed} fallidos
            </p>
          )}

          {importError !== null && (
            <p className="settings-feedback settings-feedback--error">Error: {importError}</p>
          )}
        </div>
      </section>
    </div>
  )
}

export default SettingsView
