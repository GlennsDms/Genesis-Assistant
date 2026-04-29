import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css' // importamos el CSS global aquí para que Vite lo empaquete

// ReactDOM.createRoot es el punto de partida de React.
// Busca el <div id="root"> en index.html y monta <App /> dentro de él.
// A partir de aquí, React controla todo el DOM de la aplicación.
ReactDOM.createRoot(document.getElementById('root')!).render(
  // StrictMode no cambia el comportamiento visible, pero activa advertencias
  // útiles durante el desarrollo para detectar problemas potenciales.
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
