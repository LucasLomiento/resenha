<script lang="ts">
  import { ui } from '../lib/ui.svelte'
  import { Button, Modal } from './kit'

  const request = $derived(ui.confirm!)

  function close() {
    ui.confirm = null
  }

  function confirm() {
    const action = request.onconfirm
    close()
    action()
  }
</script>

<Modal title={request.title} description={request.description} size="sm" onclose={close}>
  {#snippet footer()}
    <Button variant="ghost" onclick={close}>Cancelar</Button>
    <Button variant="danger" onclick={confirm} autofocus>{request.confirm}</Button>
  {/snippet}
</Modal>
