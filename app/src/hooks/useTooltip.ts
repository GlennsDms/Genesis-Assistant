import { useState, useCallback, type MouseEvent } from 'react'

// Dimensiones estimadas del tooltip para el cálculo de colisiones con el viewport.
// Si el tooltip real difiere, ajustar aquí.
const TOOLTIP_W = 220
const TOOLTIP_H = 60

export interface TooltipState {
  visible: boolean
  x: number
  y: number
  titulo: string
  hora: string
}

const INICIAL: TooltipState = { visible: false, x: 0, y: 0, titulo: '', hora: '' }

/**
 * Gestiona posición y visibilidad de un tooltip sin librerías externas.
 *
 * Lógica de posicionamiento:
 *   - Prioridad horizontal: a la derecha del target. Si no cabe, a la izquierda.
 *   - Prioridad vertical: alineado al top del target. Si se sale por abajo, sube.
 *     Si aun así queda fuera por arriba, se ancla debajo del target.
 *
 * El componente Tooltip renderiza con createPortal al body, por lo que las
 * coordenadas son viewport-absolutas (position: fixed).
 */
export function useTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState>(INICIAL)

  const mostrar = useCallback((e: MouseEvent, titulo: string, hora: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const vpW  = window.innerWidth
    const vpH  = window.innerHeight

    let x = rect.right + 8
    let y = rect.top

    // Desbordamiento derecho → anclar a la izquierda del target.
    if (x + TOOLTIP_W > vpW - 8) x = rect.left - TOOLTIP_W - 8

    // Desbordamiento inferior → subir el tooltip.
    if (y + TOOLTIP_H > vpH - 8) y = vpH - TOOLTIP_H - 8

    // Aun fuera por arriba (p.ej. primera fila) → debajo del target.
    if (y < 8) y = rect.bottom + 8

    setTooltip({ visible: true, x, y, titulo, hora })
  }, [])

  const ocultar = useCallback(() => setTooltip(INICIAL), [])

  return { tooltip, mostrar, ocultar }
}
