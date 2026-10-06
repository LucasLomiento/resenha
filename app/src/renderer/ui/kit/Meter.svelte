<script lang="ts">
  let {
    level,
    passing = false,
    idle = false,
    threshold = $bindable(null),
    onthreshold,
    label = 'Nível do microfone',
  }: {
    /** 0..1 */
    level: number
    /** Som passando (verde). */
    passing?: boolean
    /** Sem microfone aberto: barra apagada. */
    idle?: boolean
    /** 0..1 ou null. Com valor, aparece a marca arrastável do limiar. */
    threshold?: number | null
    onthreshold?: (value: number) => void
    label?: string
  } = $props()
</script>

<div class={['meter', { passing, idle, adjustable: threshold !== null }]}>
  <div class="track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={level}>
    <div class="fill" style:width="{level * 100}%"></div>
  </div>
  {#if threshold !== null}
    <input
      type="range"
      min="0"
      max="1"
      step="0.0125"
      aria-label="Sensibilidade"
      bind:value={threshold}
      oninput={() => onthreshold?.(threshold ?? 0)}
    />
  {/if}
</div>

<style>
  .meter {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: 20px;
  }

  .track {
    position: relative;
    flex: 1;
    height: 8px;
    border-radius: var(--r-full);
    background: rgb(255 255 255 / 0.08);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: inherit;
    background: rgb(255 255 255 / 0.28);
    transition: width 60ms linear;
  }

  .passing .fill {
    background: linear-gradient(90deg, #22c08a, var(--green));
  }

  .idle .track {
    opacity: 0.5;
  }

  /* A própria barra é o controle do limiar: a marca branca arrasta por cima dela. */
  input {
    appearance: none;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    background: transparent;
    cursor: ew-resize;
  }

  input::-webkit-slider-runnable-track {
    height: 20px;
    background: transparent;
  }

  input::-webkit-slider-thumb {
    appearance: none;
    width: 6px;
    height: 20px;
    border-radius: 3px;
    background: #fff;
    box-shadow:
      0 0 0 2px var(--bg-raised),
      0 1px 4px rgb(0 0 0 / 0.5);
  }

  input:focus-visible {
    outline: none;
  }

  input:focus-visible::-webkit-slider-thumb {
    box-shadow:
      0 0 0 2px var(--bg-raised),
      0 0 0 4px var(--accent-fg);
  }
</style>
