<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'value'> {
    value?: number
    min?: number
    max?: number
    step?: number
    /** Nome pra leitor de tela (o slider quase nunca tem rótulo visível ao lado). */
    label?: string
  }

  let { value = $bindable(0), min = 0, max = 1, step = 0.01, label, class: className, ...rest }: Props = $props()

  const fill = $derived(max > min ? ((Number(value) - min) / (max - min)) * 100 : 0)
</script>

<input
  type="range"
  class={['slider', className]}
  bind:value
  {min}
  {max}
  {step}
  aria-label={label}
  style:--fill="{fill}%"
  {...rest}
/>

<style>
  .slider {
    appearance: none;
    width: 100%;
    min-width: 60px;
    height: 20px;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }

  .slider::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: var(--r-full);
    background: linear-gradient(to right, var(--accent-fg) var(--fill), rgb(255 255 255 / 0.12) var(--fill));
  }

  .slider::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -5px;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.15),
      0 1px 4px rgb(0 0 0 / 0.5);
    transition: transform var(--t-fast) var(--ease);
  }

  .slider:hover:not(:disabled)::-webkit-slider-thumb {
    transform: scale(1.12);
  }

  .slider:focus-visible {
    outline: none;
  }

  .slider:focus-visible::-webkit-slider-thumb {
    box-shadow:
      0 0 0 3px rgb(122 108 255 / 0.45),
      0 1px 4px rgb(0 0 0 / 0.5);
  }

  .slider:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
