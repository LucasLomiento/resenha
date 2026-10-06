<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    tone = 'neutral',
    dot,
    class: className,
    children,
  }: {
    /**
     * neutral/accent/success/warning/danger: etiquetas ("Admin", "Você").
     * count: contador de menções. live: "AO VIVO".
     */
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'count' | 'live'
    /** Bolinha colorida antes do texto (cor de cargo). */
    dot?: string
    class?: string
    children: Snippet
  } = $props()
</script>

<span class={['badge', tone, className]}>
  {#if tone === 'live'}<span class="pulse" aria-hidden="true"></span>{/if}
  {#if dot}<span class="role-dot" style:background={dot}></span>{/if}
  {@render children()}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    height: 20px;
    padding: 0 7px;
    border-radius: var(--r-sm);
    font-size: var(--text-2xs);
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
  }

  .neutral {
    background: rgb(255 255 255 / 0.07);
    color: var(--fg-2);
  }

  .accent {
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  .success {
    background: var(--green-soft);
    color: var(--green);
  }

  .warning {
    background: var(--yellow-soft);
    color: var(--yellow);
  }

  .danger {
    background: var(--red-soft);
    color: var(--red);
  }

  .count {
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--r-full);
    background: var(--red);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .live {
    height: 18px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--red);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  .pulse {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #fff;
    animation: rs-pulse 1.6s ease-in-out infinite;
  }

  .role-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
</style>
