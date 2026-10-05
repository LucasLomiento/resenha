<script lang="ts">
  import { initials, userColor } from '../lib/format'

  let {
    id,
    name,
    size = 32,
    speaking = false,
  }: { id: string; name: string; size?: number; speaking?: boolean } = $props()
</script>

<span
  class="avatar"
  class:speaking
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.4)}px"
  style:background={userColor(id)}
>
  {initials(name)}
</span>

<style>
  .avatar {
    flex: none;
    display: inline-grid;
    place-items: center;
    border-radius: 50%;
    color: #15161a;
    font-weight: 800;
    box-shadow: 0 0 0 2px transparent;
    transition: box-shadow 80ms;
  }

  .speaking {
    box-shadow:
      0 0 0 2px var(--bg-sidebar),
      0 0 0 4px var(--green);
  }
</style>
