<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
  let shown = $state(false)
</script>

<!-- Texto escondido até alguém clicar (||assim||). -->
<button class="spoiler" class:shown aria-label={shown ? undefined : 'Spoiler: clique pra ver'} onclick={() => (shown = true)}
  >{@render children()}</button
>

<style>
  .spoiler {
    padding: 0 2px;
    border-radius: var(--r-xs);
    background: #2a2a35;
    color: transparent;
    font: inherit;
    text-align: inherit;
    cursor: pointer;
    transition: background-color var(--t) var(--ease);
  }

  .spoiler :global(*) {
    visibility: hidden;
  }

  .spoiler:hover:not(.shown) {
    background: #33333f;
  }

  .spoiler.shown {
    background: rgb(255 255 255 / 0.07);
    color: inherit;
    cursor: text;
    user-select: text;
  }

  .spoiler.shown :global(*) {
    visibility: visible;
  }
</style>
