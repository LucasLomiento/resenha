<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'size'> {
    checked?: boolean
    size?: 'sm' | 'md'
  }

  let { checked = $bindable(false), size = 'md', class: className, ...rest }: Props = $props()
</script>

<!-- Um checkbox de verdade (teclado, rótulo e leitor de tela funcionam), com cara de interruptor. -->
<input type="checkbox" role="switch" class={['switch', size, className]} bind:checked {...rest} />

<style>
  .switch {
    appearance: none;
    position: relative;
    flex: none;
    width: 36px;
    height: 20px;
    margin: 0;
    border-radius: var(--r-full);
    background: rgb(255 255 255 / 0.14);
    cursor: pointer;
    transition: background-color var(--t) var(--ease);
  }

  .switch::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
    transition: transform var(--t) var(--ease);
  }

  .switch:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.2);
  }

  .switch:checked {
    background: var(--accent);
  }

  .switch:checked:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .switch:checked::before {
    transform: translateX(16px);
  }

  .switch:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .sm {
    width: 30px;
    height: 17px;
  }

  .sm::before {
    width: 13px;
    height: 13px;
  }

  .sm:checked::before {
    transform: translateX(13px);
  }
</style>
