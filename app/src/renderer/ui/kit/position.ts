// Posicionamento de flutuantes (tooltip, menu, popover): encosta no alvo,
// vira pro outro lado se não couber e nunca sai da janela.

export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Align = 'start' | 'center' | 'end'
export type Placement = Side | `${Side}-${Exclude<Align, 'center'>}`

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

const MARGIN = 8

function split(placement: Placement): [Side, Align] {
  const [side, align] = placement.split('-') as [Side, Align | undefined]
  return [side, align ?? 'center']
}

function opposite(side: Side): Side {
  return ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[side]
}

function fits(side: Side, target: Box, size: { width: number; height: number }, gap: number) {
  if (side === 'top') return target.top - gap - size.height >= MARGIN
  if (side === 'bottom') return target.top + target.height + gap + size.height <= window.innerHeight - MARGIN
  if (side === 'left') return target.left - gap - size.width >= MARGIN
  return target.left + target.width + gap + size.width <= window.innerWidth - MARGIN
}

/** Onde pôr um flutuante de `size` junto de `target` (retângulo ou ponto). */
export function place(
  target: Box,
  size: { width: number; height: number },
  placement: Placement,
  gap = 8,
): { x: number; y: number; side: Side } {
  let [side, align] = split(placement)
  if (!fits(side, target, size, gap) && fits(opposite(side), target, size, gap)) side = opposite(side)

  let x: number
  let y: number
  if (side === 'top' || side === 'bottom') {
    y = side === 'top' ? target.top - gap - size.height : target.top + target.height + gap
    x =
      align === 'start'
        ? target.left
        : align === 'end'
          ? target.left + target.width - size.width
          : target.left + target.width / 2 - size.width / 2
  } else {
    x = side === 'left' ? target.left - gap - size.width : target.left + target.width + gap
    y =
      align === 'start'
        ? target.top
        : align === 'end'
          ? target.top + target.height - size.height
          : target.top + target.height / 2 - size.height / 2
  }

  x = Math.min(Math.max(x, MARGIN), window.innerWidth - size.width - MARGIN)
  y = Math.min(Math.max(y, MARGIN), window.innerHeight - size.height - MARGIN)
  return { x: Math.round(x), y: Math.round(y), side }
}

export function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** Move o elemento pro fim do <body>: fica por cima de tudo, sem herdar overflow nem transform. */
export function portal(node: HTMLElement) {
  document.body.appendChild(node)
  return {
    destroy() {
      node.remove()
    },
  }
}
