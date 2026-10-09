<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { m } from '../../lib/i18n.svelte'
  import { getCameraStream, getMicTrack } from '../../lib/media'
  import { MicPipeline } from '../../lib/mic'
  import { settings, type VideoCodec } from '../../lib/settings.svelte'
  import { client } from '../../lib/client.svelte'
  import { ui } from '../../lib/ui.svelte'
  import { Button, Icon, Meter, PageHeader, Row, Section, Segmented, Select, Switch } from '../kit'
  import VideoTile from '../VideoTile.svelte'

  const call = client.call
  const t = $derived(m.settings.voice)

  let inputs = $state<MediaDeviceInfo[]>([])
  let outputs = $state<MediaDeviceInfo[]>([])
  let cameras = $state<MediaDeviceInfo[]>([])

  function options(list: MediaDeviceInfo[], fallback: string) {
    return [
      { value: 'default', label: t.systemDefault },
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
      client.toast(t.noMic((err as Error).message))
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
      client.toast(t.noCamera((err as Error).message))
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
  // A busca (ou o Ctrl+K) achou uma opção que fica no "Avançado": abre ele.
  const ADVANCED = ['voice.echo', 'voice.agc', 'voice.codec', 'voice.stats']
  $effect(() => {
    if (ui.settingsTarget && ADVANCED.includes(ui.settingsTarget)) advanced = true
  })
</script>

<PageHeader title={m.settings.pages.voice} />

<Section title={t.audio.section}>
  <Row label={t.audio.input} setting="voice.input">
    <div class="select">
      <Select label={t.audio.input} options={options(inputs, t.audio.input)} bind:value={settings.inputDevice} onchange={micChanged} />
    </div>
  </Row>
  <Row label={t.audio.output} setting="voice.output">
    <div class="select">
      <Select label={t.audio.outputLabel} options={options(outputs, t.audio.speaker)} bind:value={settings.outputDevice} onchange={() => call.applyOutput()} />
    </div>
  </Row>
  <Row stack setting="voice.test" description={testing ? t.audio.testing : undefined}>
    <div class="test">
      <Button icon={testing ? 'x' : 'mic'} onclick={() => (testing ? stopTest() : startTest())}>
        {testing ? t.audio.stopTest : t.audio.test}
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
  <Row label={t.audio.noise} setting="voice.noise" description={t.audio.noiseDescription}>
    <Segmented
      label={t.audio.noise}
      options={[
        { value: 'rnnoise', label: t.audio.noiseStrong },
        { value: 'browser', label: t.audio.noiseLight },
        { value: 'off', label: t.audio.noiseOff },
      ]}
      value={settings.noiseReduction}
      onchange={setNoise}
    />
  </Row>
  <Row label={t.audio.gate} setting="voice.gate" for="voice-gate" description={t.audio.gateDescription}>
    <Switch id="voice-gate" bind:checked={settings.gate.enabled} onchange={processingChanged} />
  </Row>
  {#if settings.gate.enabled}
    <Row label={t.audio.detection} indent description={settings.gate.auto ? t.audio.detectionAuto : t.audio.detectionManual}>
      <Segmented
        label={t.audio.detection}
        options={[
          { value: 'auto', label: t.audio.auto },
          { value: 'manual', label: t.audio.manual },
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

<Section title={t.camera.section}>
  <Row label={t.camera.device} setting="voice.camera">
    <div class="select">
      <Select label={t.camera.label} options={options(cameras, t.camera.label)} bind:value={settings.cameraDevice} onchange={cameraChanged} />
    </div>
  </Row>
  <Row label={t.camera.preview} setting="voice.preview">
    <Button icon={preview ? 'camera-off' : 'camera'} onclick={togglePreview}>{preview ? t.camera.close : t.camera.open}</Button>
  </Row>
  {#if preview}
    <div class="preview"><VideoTile stream={preview} mirror /></div>
  {/if}
</Section>

<Section title={t.stream.section}>
  <Row label={t.stream.ink} for="voice-ink" setting="voice.ink" description={t.stream.inkDescription}>
    <Switch id="voice-ink" checked={settings.inkAllowed} onchange={(e) => call.ink.setEnabled(e.currentTarget.checked)} />
  </Row>
</Section>

<section class="advanced">
  <button class="advanced-toggle" aria-expanded={advanced} onclick={() => (advanced = !advanced)}>
    <Icon name="chevron-right" size={16} />
    {t.advanced.section}
  </button>
  {#if advanced}
    <Section>
      <Row label={t.advanced.echo} setting="voice.echo" for="voice-echo" description={t.advanced.echoDescription}>
        <Switch id="voice-echo" bind:checked={settings.echoCancellation} onchange={micChanged} />
      </Row>
      <Row label={t.advanced.agc} setting="voice.agc" for="voice-agc" description={t.advanced.agcDescription}>
        <Switch id="voice-agc" bind:checked={settings.autoGainControl} onchange={micChanged} />
      </Row>
      <Row label={t.advanced.codec} setting="voice.codec" description={t.advanced.codecDescription}>
        <Segmented
          label={t.advanced.codec}
          options={(['VP9', 'VP8', 'H264', 'AV1'] as VideoCodec[]).map((codec) => ({ value: codec, label: codec }))}
          bind:value={settings.codec}
          onchange={() => call.updateShare()}
        />
      </Row>
      <Row label={t.advanced.stats} setting="voice.stats" for="voice-stats" description={t.advanced.statsDescription}>
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

  /* Largura mínima: o botão não pula entre "testar" e "parar", e cabe o texto mais longo (espanhol). */
  .test :global(.btn) {
    flex: none;
    min-width: 156px;
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
