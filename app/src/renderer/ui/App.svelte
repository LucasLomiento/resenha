<script lang="ts">
  import { onMount } from 'svelte'
  import { store } from '../lib/store.svelte'
  import Login from './Login.svelte'
  import Shell from './Shell.svelte'
  import Toasts from './Toasts.svelte'

  onMount(() => {
    store.boot()
  })
</script>

{#if store.phase === 'login'}
  <Login />
{:else if store.phase === 'app'}
  <Shell />
{/if}
<Toasts />
