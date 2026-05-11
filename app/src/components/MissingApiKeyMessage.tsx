interface Props {
  onIrAjustes: () => void
}

function MissingApiKeyMessage({ onIrAjustes }: Props) {
  return (
    <div className="missing-key-message">
      <div className="missing-key-icono">🔑</div>
      <p className="missing-key-titulo">▸ ASISTENTE INACTIVO</p>
      <p className="missing-key-texto">
        Configura tu API key de Gemini en Ajustes para activar el chat.<br />
        Es gratis, no requiere tarjeta.
      </p>
      <button className="missing-key-btn" onClick={onIrAjustes}>
        IR A AJUSTES
      </button>
    </div>
  )
}

export default MissingApiKeyMessage
