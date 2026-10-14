<script lang="ts">
  import { m } from '../lib/i18n.svelte'
  import { ui } from '../lib/ui.svelte'
  import { IconButton } from './kit'

  let { variant = 'ghost' }: { variant?: 'ghost' | 'glass' } = $props()
</script>

<!-- Celular: volta do conteúdo pra lista (o botão voltar do Android faz o mesmo). -->
{#if ui.compact}
  <IconButton class="back-button" icon="arrow-left" label={m.common.back} {variant} tip={false} onclick={() => (ui.pane = 'nav')} />
{/if}
