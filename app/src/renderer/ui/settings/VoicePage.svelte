<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { getCameraStream, getMicTrack } from '../../lib/media'
  import { MicPipeline } from '../../lib/mic'
  import { settings, type VideoCodec } from '../../lib/settings.svelte'
  import { store } from '../../lib/store.svelte'
  import { Button, Icon, Meter, PageHeader, Row, Section, Segmented, Select, Switch } from '../kit'
  import VideoTile from '../VideoTile.svelte'

  const call = store.call

  let inputs = $state<MediaDeviceInfo[]>([])
  let outputs = $state<MediaDeviceInfo[]>([])
  let cameras = $state<MediaDeviceInfo[]>([])

  function options(list: MediaDeviceInfo[], fallback: string) {
    return [
      { value: 'default', label: 'Padrão do sistema' },
      ...list.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => ({ value: d.deviceId, label: d.label || fallback })),
    ]
  }

  async function loadDevices() {
    let devices = await navigator.mediaDevices.enumerateDevices()
    // Sem nenhum acesso ao microfone ainda, o Chromium esconde os nomes: pede uma vez e solta.
    if (!devices.some((d) => d.label)) {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        for (const track of probe.getTracks()) track.stop()
        devices = await navigator.mediaDevices.enumerateDevices()
      } catch {
        // sem permissão: fica a lista sem nomes
      }
    }
    // O microfone virtual do áudio da tela não serve como microfone de voz.
    inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications' && !d.label.includes('vencord-screen-share'))
    outputs = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications')
    cameras = devices.filter((d) => d.kind === 'videoinput')
  }

  onMount(() => {
    loadDevices()
    navigator.mediaDevices.addEventListener('devicechange', loadDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices)
  })

  // --- teste do microfone: medidor + sua voz de volta no fone ---
  let testing = $state(false)
  let levelDb = $state(-100)
  let passing = $state(false)
  let testMic: MicPipeline | null = null
  let testAudio: HTMLAudioElement | null = null

  // Medidor ao vivo: do teste, ou da call se você estiver numa.
  const METER_MIN = -80
  const toMeter = (db: number) => Math.min(1, Math.max(0, (db - METER_MIN) / -METER_MIN))
  const fromMeter = (value: number) => Math.round(METER_MIN + value * -METER_MIN)
  const hasMic = $derived(testing || !!call.mic)
  const manualGate = $derived(settings.gate.enabled && !settings.gate.auto)

  onMount(() => {
    const timer = setInterval(() => {
      const mic = testMic ?? call.mic
      levelDb = mic ? mic.currentDb : -100
      passing = mic ? (settings.gate.enabled ? mic.open : mic.speaking) : false
    }, 50)
    return () => clearInterval(timer)
  })

  async function startTest() {
    stopTest()
    try {
      // O teste passa pelo mesmo processamento da call: você ouve o filtro e o limiar funcionando.
      testMic = await MicPipeline.create(await getMicTrack())
      testAudio = new Audio()
      testAudio.srcObject = new MediaStream([testMic.track])
      await testAudio.setSinkId(settings.outputDevice === 'default' ? '' : settings.outputDevice).catch(() => {})
      await testAudio.play()
      testing = true
      loadDevices()
    } catch (err) {
      stopTest()
      store.toast(`Sem acesso ao microfone: ${(err as Error).message}`)
    }
  }

  function stopTest() {
    testAudio?.pause()
    if (testAudio) testAudio.srcObject = null
    testAudio = null
    testMic?.close()
    testMic = null
    testing = false
  }

  onDestroy(stopTest)

  // --- prévia da câmera ---
  let preview = $state.raw<MediaStream | null>(null)

  async function togglePreview() {
    if (preview) return stopPreview()
    try {
      preview = await getCameraStream()
      loadDevices()
    } catch (err) {
      store.toast(`Não deu pra abrir a câmera: ${(err as Error).message}`)
    }
  }

  function stopPreview() {
    for (const track of preview?.getTracks() ?? []) track.stop()
    preview = null
  }

  onDestroy(stopPreview)

  function cameraChanged() {
    call.reloadCamera()
    if (preview) {
      stopPreview()
      togglePreview()
    }
  }

  function micChanged() {
    call.reloadMic()
    if (testing) startTest()
  }

  /** Limiar mudou: vale na hora, no teste e na call. */
  function processingChanged() {
    call.updateMicProcessing()
    testMic?.update()
  }

  function setNoise(mode: typeof settings.noiseReduction) {
    settings.noiseReduction = mode
    // Trocar pro filtro do Chromium (ou sair dele) precisa reabrir o microfone.
    micChanged()
  }

  let advanced = $state(false)
</script>

<PageHeader title="Voz e vídeo" />

<Section title="Áudio">
  <Row label="Microfone">
    <div class="select"><Select label="Microfone" options={options(inputs, 'Microfone')} bind:value={settings.inputDevice} onchange={micChanged} /></div>
  </Row>
  <Row label="Saída">
    <div class="select"><Select label="Saída de áudio" options={options(outputs, 'Alto-falante')} bind:value={settings.outputDevice} onchange={() => call.applyOutput()} /></div>
  </Row>
  <Row stack description={testing ? 'Você está se ouvindo. Use fone pra não dar eco.' : undefined}>
    <div class="test">
      <Button icon={testing ? 'x' : 'mic'} onclick={() => (testing ? stopTest() : startTest())}>
        {testing ? 'Parar teste' : 'Testar microfone'}
      </Button>
      <Meter
        level={toMeter(levelDb)}
        {passing}
        idle={!hasMic}
        threshold={manualGate ? toMeter(settings.gate.thresholdDb) : null}
        onthreshold={(value) => {
          settings.gate.thresholdDb = fromMeter(value)
          processingChanged()
        }}
      />
    </div>
  </Row>
  <Row label="Redução de ruído" description="Já filtra o ruído no sistema? Deixe desligada.">
    <Segmented
      label="Redução de ruído"
      options={[
        { value: 'rnnoise', label: 'Forte' },
        { value: 'browser', label: 'Leve' },
        { value: 'off', label: 'Desligada' },
      ]}
      value={settings.noiseReduction}
      onchange={setNoise}
    />
  </Row>
  <Row label="Só transmitir quando eu falar" for="voice-gate" description="O resto vira silêncio.">
    <Switch id="voice-gate" bind:checked={settings.gate.enabled} onchange={processingChanged} />
  </Row>
  {#if settings.gate.enabled}
    <Row
      label="Detecção"
      indent
      description={settings.gate.auto ? 'Reconhece a sua voz sozinho.' : 'Arraste a marca branca na barra do teste.'}
    >
      <Segmented
        label="Detecção"
        options={[
          { value: 'auto', label: 'Automática' },
          { value: 'manual', label: 'Manual' },
        ]}
        value={settings.gate.auto ? 'auto' : 'manual'}
        onchange={(value) => {
          settings.gate.auto = value === 'auto'
          processingChanged()
        }}
      />
    </Row>
  {/if}
</Section>

<Section title="Câmera">
  <Row label="Dispositivo">
    <div class="select"><Select label="Câmera" options={options(cameras, 'Câmera')} bind:value={settings.cameraDevice} onchange={cameraChanged} /></div>
  </Row>
  <Row label="Prévia">
    <Button icon={preview ? 'camera-off' : 'camera'} onclick={togglePreview}>{preview ? 'Fechar prévia' : 'Ver prévia'}</Button>
  </Row>
  {#if preview}
    <div class="preview"><VideoTile stream={preview} mirror /></div>
  {/if}
</Section>

<section class="advanced">
  <button class="advanced-toggle" aria-expanded={advanced} onclick={() => (advanced = !advanced)}>
    <Icon name="chevron-right" size={16} />
    Avançado
  </button>
  {#if advanced}
    <Section>
      <Row label="Cancelamento de eco" for="voice-echo" description="Útil pra quem usa caixa de som.">
        <Switch id="voice-echo" bind:checked={settings.echoCancellation} onchange={micChanged} />
      </Row>
      <Row label="Ganho automático" for="voice-agc" description="Ajusta o volume da sua voz sozinho.">
        <Switch id="voice-agc" bind:checked={settings.autoGainControl} onchange={micChanged} />
      </Row>
      <Row label="Codec da transmissão" description="VP8 e H264 pesam menos no computador.">
        <Segmented
          label="Codec da transmissão"
          options={(['VP9', 'VP8', 'H264', 'AV1'] as VideoCodec[]).map((codec) => ({ value: codec, label: codec }))}
          bind:value={settings.codec}
          onchange={() => call.updateShare()}
        />
      </Row>
      <Row label="Estatísticas no player" for="voice-stats" description="Resolução, fps e ping da transmissão.">
        <Switch id="voice-stats" bind:checked={settings.showStats} />
      </Row>
    </Section>
  {/if}
</section>

<style>
  .select {
    width: 260px;
  }

  .test {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
  }

  .test :global(.btn) {
    width: 156px;
  }

  .test :global(.meter) {
    flex: 1;
  }

  .preview {
    width: 320px;
    aspect-ratio: 16 / 9;
    margin: 0 16px 16px;
    border-radius: var(--r-lg);
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--line);
  }

  .advanced {
    margin-top: var(--s-8);
  }

  .advanced-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    padding: 4px 8px 4px 2px;
    border-radius: var(--r-md);
    color: var(--fg-2);
    font-weight: 600;
    transition: color var(--t-fast) var(--ease);
  }

  .advanced-toggle:hover {
    color: var(--fg);
  }

  .advanced-toggle :global(svg) {
    transition: transform var(--t) var(--ease);
  }

  .advanced-toggle[aria-expanded='true'] :global(svg) {
    transform: rotate(90deg);
  }
</style>
