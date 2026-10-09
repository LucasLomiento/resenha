<script lang="ts" module>
  import { m } from '../../lib/i18n.svelte'

  export type Status = 'online' | 'idle' | 'dnd' | 'offline'

  /**
   * Nome de cada status no idioma em uso (lido na hora, então acompanha a troca de idioma).
   * O texto fica em `m.common.presence`; isto é só um atalho pra quem já usava a tabela.
   */
  export const STATUS_LABEL: Record<Status, string> = new Proxy({} as Record<Status, string>, {
    get: (_, status) => m.common.presence[status as Status],
  })
</script>

<script lang="ts">
  let {
    status,
    size = 10,
    cutout = 'var(--bg-canvas)',
    class: className,
  }: {
    status: Status
    size?: number
    /** Cor do fundo onde o ponto está: faz o "recorte" em volta dele. */
    cutout?: string
    class?: string
  } = $props()
</script>

<!-- Cada status tem forma própria (não só cor): bolinha, lua, sinal de menos, anel. -->
<span
  class={['status-dot', status, className]}
  style:--d="{size}px"
  style:--cut={cutout}
  role="img"
  aria-label={m.common.presence[status]}
></span>

<style>
  .status-dot {
    display: inline-block;
    flex: none;
    width: var(--d);
    height: var(--d);
    border-radius: 50%;
    box-shadow: 0 0 0 max(2px, calc(var(--d) * 0.2)) var(--cut);
  }

  .online {
    background: var(--green);
  }

  .idle {
    background: radial-gradient(circle at 28% 28%, var(--cut) 0 34%, transparent 35%), var(--yellow);
  }

  .dnd {
    background:
      linear-gradient(var(--cut), var(--cut)) center / 56% 24% no-repeat,
      var(--red);
  }

  .offline {
    background: var(--cut);
    box-shadow:
      inset 0 0 0 max(2px, calc(var(--d) * 0.22)) var(--fg-3),
      0 0 0 max(2px, calc(var(--d) * 0.2)) var(--cut);
  }
</style>
