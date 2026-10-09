<script lang="ts">
  import { untrack } from 'svelte'
  import { m } from '../../lib/i18n.svelte'
  import { Button } from '../kit'

  let {
    saving = false,
    nudge = 0,
    disabled = false,
    onreset,
    onsave,
  }: {
    saving?: boolean
    /** Muda quando a pessoa tenta sair com alteração pendente: a barra chacoalha e avisa. */
    nudge?: number
    /** Algo inválido (nome vazio, por exemplo): não dá pra salvar ainda. */
    disabled?: boolean
    onreset: () => void
    onsave: () => void
  } = $props()

  let alert = $state(false)
  let bar = $state<HTMLDivElement>()
  let seen = untrack(() => nudge)

  // Tentou sair sem salvar: chacoalha e troca o texto por um instante.
  $effect(() => {
    if (nudge === seen) return
    seen = nudge
    alert = true
    untrack(shake)
    const timer = setTimeout(() => (alert = false), 2400)
    return () => clearTimeout(timer)
  })

  function shake() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const steps = [0, -6, 5, -3, 0].map((x) => ({ transform: `translateX(${x}px)` }))
    bar?.animate(steps, { duration: 320, easing: 'ease-out' })
  }
</script>

<!-- Alteração pendente: fica presa embaixo da página até salvar ou desfazer. -->
<div class="savebar" class:alert bind:this={bar} role="status">
  <span>{alert ? m.server.saveBar.blocked : m.server.saveBar.pending}</span>
  <Button variant="ghost" size="sm" onclick={onreset} disabled={saving}>{m.common.undo}</Button>
  <Button variant="primary" size="sm" onclick={onsave} loading={saving} {disabled}>{m.common.save}</Button>
</div>

<style>
  .savebar {
    position: sticky;
    /* Nas configurações, gruda a 16 px da borda da janela (e não acima do padding da página). */
    bottom: calc(var(--s-4) - var(--settings-pad-bottom, 0px));
    z-index: 2;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-top: var(--s-6);
    padding: 10px 10px 10px 16px;
    border-radius: var(--r-xl);
    background: var(--bg-overlay);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    font-size: var(--text-sm);
    animation: rs-pop-in var(--t) var(--ease);
    transition:
      background-color var(--t) var(--ease),
      box-shadow var(--t) var(--ease);
  }

  .savebar span {
    flex: 1;
    min-width: 0;
  }

  .alert {
    background: color-mix(in srgb, var(--red) 16%, var(--bg-overlay));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--red) 45%, transparent),
      var(--highlight),
      var(--shadow-lg);
  }

  .alert span {
    color: var(--fg);
    font-weight: 500;
  }
</style>
