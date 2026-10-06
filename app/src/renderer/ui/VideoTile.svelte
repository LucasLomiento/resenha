<script lang="ts">
  let { stream, mirror = false }: { stream: MediaStream; mirror?: boolean } = $props()

  let video = $state<HTMLVideoElement>()

  $effect(() => {
    if (!video || video.srcObject === stream) return
    video.srcObject = stream
    video.play().catch(() => {})
  })
</script>

<!-- A câmera não tem áudio (a voz vai pelo microfone); a sua aparece espelhada, como num espelho. -->
<video bind:this={video} class:mirror autoplay playsinline muted></video>

<style>
  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #000;
    animation: rs-fade-in var(--t-slow) var(--ease);
  }

  .mirror {
    transform: scaleX(-1);
  }
</style>
