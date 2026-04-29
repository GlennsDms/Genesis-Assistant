import type { Vista } from '../types'

const ITEMS: { id: Vista; label: string }[] = [
  { id: 'hoy',           label: 'HOY' },
  { id: 'calendario',    label: 'CALENDARIO' },
  { id: 'recordatorios', label: 'RECORDATORIOS' },
  { id: 'horarios',      label: 'HORARIOS' },
  { id: 'chat',          label: 'CHAT' },
  { id: 'ajustes',       label: 'AJUSTES' },
]

interface Props {
  vistaActiva: Vista
  onCambiarVista: (vista: Vista) => void
}

function Sidebar({ vistaActiva, onCambiarVista }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">GNS</div>
      <nav className="sidebar-nav">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item ${vistaActiva === item.id ? 'activo' : ''}`}
            onClick={() => onCambiarVista(item.id)}
          >
            <span className="item-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar
