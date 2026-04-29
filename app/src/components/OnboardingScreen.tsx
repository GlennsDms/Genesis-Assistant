import { useState } from 'react'

// Props es la "interfaz" del componente: define qué datos espera recibir.
// onComplete es una función que App.tsx nos pasa para que la llamemos
// cuando el usuario termine de escribir su nombre.
interface Props {
  onComplete: (nombre: string) => void
}

function OnboardingScreen({ onComplete }: Props) {
  // Estado local para el texto que escribe el usuario en el input
  const [nombre, setNombre] = useState('')

  // Se llama cuando el usuario pulsa Enter o el botón INICIAR
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault() // evita que el navegador recargue la página al enviar el form
    const nombreLimpio = nombre.trim() // quita espacios del inicio y final
    if (nombreLimpio) {
      onComplete(nombreLimpio) // avisa a App.tsx con el nombre
    }
  }

  return (
    <div className="onboarding">
      {/* Logo principal */}
      <div className="onboarding-logo">GENESIS</div>

      {/* Línea diagonal decorativa */}
      <div className="onboarding-slash" />

      <p className="onboarding-pregunta">¿Cómo debo llamarte?</p>

      {/* onSubmit se activa al pulsar Enter dentro del input o el botón */}
      <form className="onboarding-form" onSubmit={handleSubmit}>
        <span className="onboarding-prompt">▸</span>
        <input
          className="onboarding-input"
          type="text"
          value={nombre}
          // onChange se llama cada vez que el usuario escribe algo.
          // e.target.value es el texto actual del input.
          onChange={(e) => setNombre(e.target.value)}
          placeholder="TU NOMBRE"
          autoFocus    // pone el cursor en este input automáticamente
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
