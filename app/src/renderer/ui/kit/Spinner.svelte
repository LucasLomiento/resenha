<script lang="ts">
  let { size = 16, class: className }: { size?: number; class?: string } = $props()
</script>

<svg class={['spinner', className]} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.2" stroke-width="2.5" />
  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
</svg>

<style>
  .spinner {
    animation: rs-spin 0.8s linear infinite;
  }
</style>
