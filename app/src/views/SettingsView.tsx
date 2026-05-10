import { useState } from 'react'
import { importIcsFile, type ImportStats } from '../lib/calendarImport'

function SettingsView() {
  const [stats, setStats]     = useState<ImportStats | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleImportIcs() {
    setImporting(true)
    setStats(null)
    setError(null)
    try {
      const result = await importIcsFile()
      if (result !== null) setStats(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="placeholder-view">
      <div className="placeholder-linea" />
      <h2 className="placeholder-titulo">Ajustes</h2>
      <p className="placeholder-subtitulo">— próximamente —</p>

      <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
        <button
          onClick={handleImportIcs}
          disabled={importing}
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.8rem',
            padding: '0.5rem 1.25rem',
            background: 'var(--blood)',
            color: 'var(--bone)',
            border: 'none',
            cursor: importing ? 'not-allowed' : 'pointer',
            opacity: importing ? 0.6 : 1,
          }}
        >
          {importing ? 'Importando…' : '[DEV] Importar .ics'}
        </button>

        {stats !== null && (
          <p style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', color: 'var(--bone-dim)' }}>
            {stats.imported} nuevos · {stats.updated} actualizados · {stats.failed} fallidos
          </p>
        )}

        {error !== null && (
          <p style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', color: 'var(--blood)' }}>
            Error: {error}
          </p>
        )}
      </div>

      <div className="placeholder-linea" />
    </div>
  )
}

export default SettingsView
