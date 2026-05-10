import { createPortal } from 'react-dom'
import type { TooltipState } from '../hooks/useTooltip'
import './Tooltip.css'

// Renderiza al body vía portal para escapar del overflow:hidden de la cuadrícula.
// Sin portal, las píldoras del borde derecho/inferior verían el tooltip recortado.
function Tooltip({ visible, x, y, titulo, hora }: TooltipState) {
  if (!visible) return null

  return createPortal(
    <div className="genesis-tooltip" style={{ left: x, top: y }}>
      <span className="genesis-tooltip__titulo">{titulo}</span>
      <span className="genesis-tooltip__hora">{hora}</span>
    </div>,
    document.body,
  )
}

export default Tooltip
