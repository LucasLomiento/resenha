// Dica flutuante no lugar do `title` nativo (que tem cara de app antigo e demora).
// Uso: <button use:tooltip={'Mutar'}> ou use:tooltip={{ text: 'Mutar', shortcut: 'Ctrl M', placement: 'right' }}

import { boxOf, place, type Placement } from './position'

export interface TooltipOptions {
  text: string
  placement?: Placement
  /** Atalho mostrado à direita, em fonte mono. */
  shortcut?: string | null
}

export type TooltipParam = string | TooltipOptions | null | undefined | false

/** Depois de uma dica aparecer, as próximas (logo em seguida) aparecem sem espera. */
let warmUntil = 0

function normalize(param: TooltipParam): TooltipOptions | null {
  if (!param) return null
  return typeof param === 'string' ? { text: param } : param
}

export function tooltip(node: HTMLElement, param: TooltipParam) {
  let options = normalize(param)
  let timer: ReturnType<typeof setTimeout> | null = null
  let el: HTMLDivElement | null = null

  function render() {
    if (!el || !options) return
    el.textContent = options.text
    if (options.shortcut) {
      const kbd = document.createElement('kbd')
      kbd.textContent = options.shortcut
      el.append(kbd)
    }
    const { x, y, side } = place(boxOf(node), el.getBoundingClientRect(), options.placement ?? 'top', 8)
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.setProperty('--rs-tooltip-shift', side === 'top' ? '3px' : side === 'bottom' ? '-3px' : '0px')
  }

  function show() {
    timer = null
    if (!options?.text || el || !node.isConnected) return
    el = document.createElement('div')
    el.className = 'rs-tooltip'
    el.setAttribute('role', 'tooltip')
    document.body.append(el)
    render()
  }

  function hide() {
    if (timer) clearTimeout(timer)
    timer = null
    if (!el) return
    el.remove()
    el = null
    warmUntil = Date.now() + 500
  }

  function enter() {
    if (!options) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(show, Date.now() < warmUntil ? 0 : 420)
  }

  function focus() {
    if (node.matches(':focus-visible')) show()
  }

  node.addEventListener('pointerenter', enter)
  node.addEventListener('pointerleave', hide)
  node.addEventListener('pointerdown', hide)
  node.addEventListener('focus', focus)
  node.addEventListener('blur', hide)

  return {
    update(next: TooltipParam) {
      options = normalize(next)
      if (!options) hide()
      else render()
    },
    destroy() {
      hide()
      node.removeEventListener('pointerenter', enter)
      node.removeEventListener('pointerleave', hide)
      node.removeEventListener('pointerdown', hide)
      node.removeEventListener('focus', focus)
      node.removeEventListener('blur', hide)
    },
  }
}
