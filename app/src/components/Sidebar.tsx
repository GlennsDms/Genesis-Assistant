import type { Vista } from '../types'

// Lista de todos los ítems del menú.
// Definirlos aquí como constante evita repetir código en el JSX.
const ITEMS: { id: Vista; label: string }[] = [
  { id: 'hoy',           label: 'HOY' },
  { id: 'calendario',    label: 'CALENDARIO' },
  { id: 'recordatorios', label: 'RECORDATORIOS' },
  { id: 'horarios',      label: 'HORARIOS' },
  { id: 'chat',          label: 'CHAT' },
  { id: 'ajustes',       label: 'AJUSTES' },
]

// Props que recibe Sidebar desde App.tsx:
//   vistaActiva    → la vista que está seleccionada ahora
//   onCambiarVista → función para cambiar la vista al hacer clic
interface Props {
  vistaActiva: Vista
  onCambiarVista: (vista: Vista) => void
}

function Sidebar({ vistaActiva, onCambiarVista }: Props) {
  return (
    <aside className="sidebar">
      {/* Logo abreviado */}
      <div className="sidebar-logo">GNS</div>

      <nav className="sidebar-nav">
        {/* .map() recorre el array ITEMS y crea un botón por cada ítem */}
        {ITEMS.map((item) => (
          <button
            key={item.id}  // React necesita key único para rastrear cada elemento
            // Si el ítem es el activo, añade la clase 'activo' para aplicar el estilo rojo
            className={`sidebar-item ${vistaActiva === item.id ? 'activo' : ''}`}
            onClick={() => onCambiarVista(item.id)} // cambia la vista al hacer clic
          >
            {/* El span extra permite el contra-skew en el texto cuando está activo */}
            <span className="item-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar
