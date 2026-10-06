<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import Icon, { type IconName } from './Icon.svelte'
  import type { Placement } from './position'
  import { tooltip } from './tooltip'

  interface Props extends HTMLButtonAttributes {
    icon: IconName
    /** Nome do botão: vira o aria-label e a dica. Obrigatório, porque o ícone sozinho não fala. */
    label: string
    /** 28 · 32 · 36 · 40 px */
    size?: 'sm' | 'md' | 'lg' | 'xl'
    /** ghost: só o ícone. subtle: com fundo. glass: sobre vídeo. */
    variant?: 'ghost' | 'subtle' | 'glass'
    /** Cor quando ligado (active) ou, no caso de danger, também no hover. */
    tone?: 'neutral' | 'accent' | 'danger' | 'live' | 'success'
    /** Estado ligado (mutado, câmera ligada, ao vivo...). */
    active?: boolean
    /** Onde a dica aparece; false = sem dica. */
    tip?: Placement | false
    shortcut?: string | null
  }

  let {
    icon,
    label,
    size = 'md',
    variant = 'ghost',
    tone = 'neutral',
    active = false,
    tip = 'top',
    shortcut = null,
    type = 'button',
    class: className,
    ...rest
  }: Props = $props()

  const iconSize = $derived(({ sm: 16, md: 18, lg: 18, xl: 20 } as const)[size])
</script>

<button
  {type}
  class={['icon-btn', size, variant, `tone-${tone}`, className, { active }]}
  aria-label={label}
  use:tooltip={tip === false ? null : { text: label, placement: tip, shortcut }}
  {...rest}
>
  <Icon name={icon} size={iconSize} />
</button>

<style>
  .icon-btn {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: var(--r-md);
    color: var(--fg-2);
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }

  .icon-btn:active:not(:disabled) {
    transform: scale(0.94);
  }

  .icon-btn:disabled {
    opacity: 0.4;
  }

  .sm {
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm);
  }

  .lg {
    width: 36px;
    height: 36px;
    border-radius: var(--r-lg);
  }

  .xl {
    width: 40px;
    height: 40px;
    border-radius: 12px;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--hover);
    color: var(--fg);
  }

  .subtle {
    background: rgb(255 255 255 / 0.06);
    color: var(--fg);
  }

  .subtle:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.1);
  }

  .glass {
    color: #f2f2f6;
  }

  .glass:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.14);
    color: #fff;
  }

  /* ---- Ligado ---- */

  .active.tone-neutral {
    background: var(--selected);
    color: var(--fg);
  }

  .active.tone-accent {
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  .active.tone-success {
    background: var(--green-soft);
    color: var(--green);
  }

  .active.tone-danger,
  .active.tone-live {
    background: var(--red-soft);
    color: var(--red);
  }

  .active.tone-accent:hover:not(:disabled) {
    background: rgb(122 108 255 / 0.22);
    color: var(--accent-fg);
  }

  .active.tone-danger:hover:not(:disabled),
  .active.tone-live:hover:not(:disabled) {
    background: rgb(255 92 114 / 0.22);
    color: var(--red-hover);
  }

  .active.tone-success:hover:not(:disabled) {
    background: rgb(52 211 153 / 0.2);
    color: var(--green);
  }

  /* Ação destrutiva (sair da call): fica vermelha no hover. */
  .tone-danger:not(.active):hover:not(:disabled) {
    background: var(--red-soft);
    color: var(--red);
  }
</style>
