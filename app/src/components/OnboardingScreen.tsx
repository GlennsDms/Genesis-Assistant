import { useState } from 'react'

interface Props {
  onComplete: (nombre: string) => void
}

function OnboardingScreen({ onComplete }: Props) {
  const [nombre, setNombre] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const nombreLimpio = nombre.trim()
    if (nombreLimpio) onComplete(nombreLimpio)
  }

  return (
    <div className="onboarding">
      <div className="onboarding-logo">GENESIS</div>
      <div className="onboarding-slash" />
      <p className="onboarding-pregunta">¿Cómo debo llamarte?</p>
      <form className="onboarding-form" onSubmit={handleSubmit}>
        <span className="onboarding-prompt">▸</span>
        <input
          className="onboarding-input"
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="TU NOMBRE"
          autoFocus
          maxLength={20}
        />
        <button className="onboarding-btn" type="submit">
          INICIAR
        </button>
      </form>
    </div>
  )
}

export default OnboardingScreen
