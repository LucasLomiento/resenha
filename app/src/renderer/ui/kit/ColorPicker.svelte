<script lang="ts">
  import { untrack } from 'svelte'

  /**
   * Escolha de cor livre: quadro de saturação/brilho, matiz e código.
   * Avisa a cada movimento (`onchange`), pra prévia acompanhar enquanto arrasta.
   */
  let { value, onchange, label = 'Cor' }: { value: number; onchange: (value: number) => void; label?: string } = $props()

  type Hsv = [number, number, number]

  function toHsv(color: number): Hsv {
    const r = ((color >> 16) & 255) / 255
    const g = ((color >> 8) & 255) / 255
    const b = (color & 255) / 255
    const max = Math.max(r, g, b)
    const d = max - Math.min(r, g, b)
    let h = 0
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return [(h * 60 + 360) % 360, max ? d / max : 0, max]
  }

  function toColor([h, s, v]: Hsv): number {
    const f = (n: number) => {
      const k = (n + h / 60) % 6
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))))
    }
    return (f(5) << 16) | (f(3) << 8) | f(1)
  }

  const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

  let hsv = $state<Hsv>(toHsv(untrack(() => value)))
  let text = $state(hex(untrack(() => value)))

  // Cor mudou por fora (outro tema escolhido): acompanha sem perder a matiz quando é cinza.
  $effect(() => {
    const next = value
    untrack(() => {
      if (toColor(hsv) === next) return
      const [h, s, v] = toHsv(next)
      hsv = [s ? h : hsv[0], s, v]
      text = hex(next)
    })
  })

  function set(next: Hsv) {
    hsv = next
    const color = toColor(next)
    text = hex(color)
    onchange(color)
  }

  let area = $state<HTMLDivElement>()

  function drag(event: PointerEvent) {
    if (!area || (event.type === 'pointermove' && !area.hasPointerCapture(event.pointerId))) return
    if (event.type === 'pointerdown') area.setPointerCapture(event.pointerId)
    const box = area.getBoundingClientRect()
    const s = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    const v = Math.min(1, Math.max(0, 1 - (event.clientY - box.top) / box.height))
    set([hsv[0], s, v])
  }

  function areaKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.1 : 0.02
    const [h, s, v] = hsv
    const moves: Record<string, Hsv> = {
      ArrowLeft: [h, Math.max(0, s - step), v],
      ArrowRight: [h, Math.min(1, s + step), v],
      ArrowUp: [h, s, Math.min(1, v + step)],
      ArrowDown: [h, s, Math.max(0, v - step)],
    }
    if (!moves[event.key]) return
    event.preventDefault()
    set(moves[event.key])
  }

  function typed() {
    const match = text.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i)
    if (!match) {
      text = hex(toColor(hsv))
      return
    }
    const raw = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1]
    const color = parseInt(raw, 16)
    const [h, s, v] = toHsv(color)
    set([s ? h : hsv[0], s, v])
  }
</script>

<div class="picker" role="group" aria-label={label}>
  <div
    bind:this={area}
    class="area"
    style:--hue={hsv[0]}
    role="slider"
    tabindex="0"
    aria-label="Saturação e brilho"
    aria-valuetext={text}
    aria-valuenow={Math.round(hsv[1] * 100)}
    onpointerdown={drag}
    onpointermove={drag}
    onkeydown={areaKey}
  >
    <span class="knob" style:left="{hsv[1] * 100}%" style:top="{(1 - hsv[2]) * 100}%" style:background={text}></span>
  </div>
  <input
    class="hue"
    type="range"
    min="0"
    max="359"
    step="1"
    aria-label="Matiz"
    value={Math.round(hsv[0])}
    oninput={(e) => set([Number(e.currentTarget.value), hsv[1], hsv[2]])}
  />
  <div class="code">
    <span class="chip" style:background={text}></span>
    <input
      aria-label="Código da cor"
      spellcheck="false"
      maxlength="7"
      bind:value={text}
      onblur={typed}
      onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), typed())}
    />
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }

  .area {
    position: relative;
    height: 132px;
    border-radius: var(--r-md);
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, hsl(var(--hue) 100% 50%));
    box-shadow: inset 0 0 0 1px var(--line-strong);
    cursor: crosshair;
    touch-action: none;
  }

  .knob {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    box-shadow:
      0 0 0 2px #fff,
      0 1px 4px rgb(0 0 0 / 0.6);
    translate: -50% -50%;
    pointer-events: none;
  }

  .hue {
    appearance: none;
    width: 100%;
    height: 14px;
    margin: 0;
    border-radius: var(--r-full);
    background: linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    cursor: pointer;
  }

  .hue::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: transparent;
    box-shadow:
      0 0 0 2px #fff,
      0 1px 4px rgb(0 0 0 / 0.6);
  }

  .hue:focus-visible {
    outline: 2px solid var(--accent-fg);
    outline-offset: 2px;
  }

  .code {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--h-sm);
    padding: 0 8px;
    border-radius: var(--r-md);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .chip {
    width: 14px;
    height: 14px;
    border-radius: var(--r-xs);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.15);
  }

  .code input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: none;
    font-family: var(--mono);
    font-size: var(--text-sm);
    text-transform: uppercase;
    user-select: text;
  }
</style>
