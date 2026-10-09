<script lang="ts">
  import { m } from '../lib/i18n.svelte'
  import { ui } from '../lib/ui.svelte'
  import { Button, Modal } from './kit'

  // Vira null ao confirmar (a janela fecha antes de rodar a ação).
  const request = $derived(ui.confirm)

  function close() {
    ui.confirm = null
  }

  function confirm() {
    if (!request) return
    const action = request.onconfirm
    close()
    action()
  }
</script>

{#if request}
<Modal title={request.title} description={request.description} size="sm" onclose={close}>
  {#snippet footer()}
    <Button variant="ghost" onclick={close}>{m.common.cancel}</Button>
    <Button variant="danger" onclick={confirm} autofocus>{request.confirm}</Button>
  {/snippet}
</Modal>
{/if}
