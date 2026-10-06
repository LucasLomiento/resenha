<script lang="ts" module>
  export type Status = 'online' | 'idle' | 'dnd' | 'offline'

  export const STATUS_LABEL: Record<Status, string> = {
    online: 'Online',
    idle: 'Ausente',
    dnd: 'Não perturbe',
    offline: 'Offline',
  }
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
  aria-label={STATUS_LABEL[status]}
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
