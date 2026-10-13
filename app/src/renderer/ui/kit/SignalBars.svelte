<script lang="ts">
  import { m } from '../../lib/i18n.svelte'
  import { tooltip } from './tooltip'

  let {
    rtt,
    route = null,
    family = null,
    other = null,
    class: className,
  }: {
    /** Ping em ms (null = ainda medindo). */
    rtt: number | null | undefined
    route?: 'direto' | 'relay' | null
    /** Família de IP do caminho direto em uso. */
    family?: 'ipv4' | 'ipv6' | null
    /** Ping recente pela outra família (quando os dois PCs têm as duas). */
    other?: number | null
    class?: string
  } = $props()

  const label = (f: 'ipv4' | 'ipv6') => (f === 'ipv4' ? 'IPv4' : 'IPv6')
  const level = $derived(rtt == null ? 0 : rtt < 80 ? 3 : rtt < 160 ? 2 : 1)
  const tone = $derived(level === 3 ? 'good' : level === 2 ? 'ok' : level === 1 ? 'bad' : 'idle')
  const text = $derived.by(() => {
    const t = m.kit.signal
    if (rtt == null) return t.measuring
    if (route === 'relay') return t.relay(rtt)
    if (!family) return t.direct(rtt)
    const via = t.directVia(rtt, label(family))
    return other == null ? via : `${via} · ${t.other(label(family === 'ipv4' ? 'ipv6' : 'ipv4'), other)}`
  })
</script>

<!-- Qualidade da conexão: três barras com a cor do ping; o número fica na dica. -->
<span class={['signal', tone, className]} use:tooltip={text} role="img" aria-label={text}>
  <i class:on={level >= 1}></i><i class:on={level >= 2}></i><i class:on={level >= 3}></i>
  <span class="sr-only">{text}</span>
</span>

<style>
  .signal {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    flex: none;
    width: 14px;
    height: 12px;
    color: var(--fg-4);
  }

  i {
    flex: 1;
    border-radius: 1px;
    background: rgb(255 255 255 / 0.14);
  }

  i:nth-child(1) {
    height: 40%;
  }

  i:nth-child(2) {
    height: 70%;
  }

  i:nth-child(3) {
    height: 100%;
  }

  .good i.on {
    background: var(--green);
  }

  .ok i.on {
    background: var(--yellow);
  }

  .bad i.on {
    background: var(--red);
  }
</style>
