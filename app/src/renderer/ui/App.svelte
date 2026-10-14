<script lang="ts">
  import { onMount } from 'svelte'
  import { client } from '../lib/client.svelte'
  import { ui } from '../lib/ui.svelte'
  import { closeTopLayer } from './kit'
  import Login from './Login.svelte'
  import Shell from './Shell.svelte'
  import Toasts from './Toasts.svelte'

  /**
   * Protótipos das telas (ui/proto): abra com #proto (ou #proto/<tela>) na URL,
   * ?proto na query, ou VITE_PROTO=1 no build. Não liga no servidor: dá pra ver
   * até num navegador comum, pelo `npm run dev:app`.
   */
  function readProto(): string | null {
    const hash = location.hash.replace(/^#/, '')
    if (hash === 'proto' || hash.startsWith('proto/')) return hash.slice(6)
    const query = new URLSearchParams(location.search)
    if (query.has('proto')) return query.get('proto') ?? ''
    if (import.meta.env.VITE_PROTO === '1') return ''
    return null
  }

  let proto = $state(readProto())

  // Botão voltar do celular: fecha a camada de cima (como o Esc); sem nenhuma, volta do
  // conteúdo pra lista.
  window.resenha.onBack?.(() => {
    if (closeTopLayer()) return true
    if (ui.compact && ui.pane === 'main' && client.phase === 'app') {
      ui.pane = 'nav'
      return true
    }
    return false
  })

  onMount(() => {
    const onhash = () => (proto = readProto())
    window.addEventListener('hashchange', onhash)
    if (proto === null) client.boot()
    return () => window.removeEventListener('hashchange', onhash)
  })
</script>

{#if proto !== null}
  {#await import('./proto/Proto.svelte') then { default: Proto }}
    <Proto screen={proto} />
  {/await}
{:else if client.phase === 'login'}
  <Login />
{:else if client.phase === 'app'}
  <Shell />
{/if}
<Toasts />
