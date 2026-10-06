<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { ChannelKind } from '../../../../shared/protocol'
  import type { ShortcutAction } from '../../preload/api'
  import { getMicTrack } from '../lib/media'
  import { MicPipeline } from '../lib/mic'
  import { PRESETS, settings, type ScreenPreset, type VideoCodec } from '../lib/settings.svelte'
  import { ACTIONS, acceleratorFrom, describeAccelerator } from '../lib/shortcuts'
  import { playSound } from '../lib/sounds'
  import { store } from '../lib/store.svelte'
  import { ui, type SettingsTab } from '../lib/ui.svelte'
  import Icon from './Icon.svelte'
  import Modal from './Modal.svelte'

  const call = store.call
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'voice', label: 'Voz' },
    { id: 'screen', label: 'Tela' },
    { id: 'shortcuts', label: 'Atalhos' },
    { id: 'app', label: 'App' },
    { id: 'group', label: 'Grupo' },
    { id: 'account', label: 'Conta' },
  ]

  let inputs = $state<MediaDeviceInfo[]>([])
  let outputs = $state<MediaDeviceInfo[]>([])

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
  }

  onMount(() => {
    loadDevices()
    navigator.mediaDevices.addEventListener('devicechange', loadDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices)
  })

  // --- teste do microfone: medidor + sua voz de volta no fone, como no Discord ---
  let testing = $state(false)
  let levelDb = $state(-100)
  let passing = $state(false)
  let testMic: MicPipeline | null = null
  let testAudio: HTMLAudioElement | null = null

  // Medidor ao vivo: do teste, ou da call se você estiver numa.
  const METER_MIN = -80
  const meterPos = (db: number) => Math.min(1, Math.max(0, (db - METER_MIN) / -METER_MIN))
  const hasMic = $derived(testing || !!call.mic)

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
      // O teste passa pelo mesmo processamento da call: você ouve o RNNoise e o limiar funcionando.
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
    if (settings.noiseReduction === mode) return
    settings.noiseReduction = mode
    // Trocar pro filtro do Chromium (ou sair dele) precisa reabrir o microfone.
    micChanged()
  }

  // --- grupo ---
  let newChannel = $state('')
  let newKind = $state<ChannelKind>('text')
  let renaming = $state<Record<string, string>>({})
  let copied = $state(false)

  function createChannel(event: SubmitEvent) {
    event.preventDefault()
    if (newChannel.trim().length < 2) return
    store.send({ t: 'channel.create', name: newChannel.trim(), kind: newKind })
    newChannel = ''
  }

  function rename(id: string) {
    const name = renaming[id]?.trim()
    if (name) store.send({ t: 'channel.rename', id, name })
    delete renaming[id]
  }

  // --- atalhos ---
  let recording = $state<ShortcutAction | null>(null)
  let failed = $state<ShortcutAction[]>([])

  function record(action: ShortcutAction) {
    recording = action
    ui.recordingShortcut = true
  }

  function stopRecording() {
    recording = null
    ui.recordingShortcut = false
  }

  async function setShortcut(action: ShortcutAction, accelerator: string | null) {
    if (!store.desktop) return
    // O mesmo atalho não pode ficar em duas ações.
    const shortcuts = { ...store.desktop.shortcuts }
    for (const key of Object.keys(shortcuts) as ShortcutAction[]) if (accelerator && shortcuts[key] === accelerator) shortcuts[key] = null
    shortcuts[action] = accelerator
    failed = await store.setDesktop({ shortcuts })
  }

  function onRecordKey(event: KeyboardEvent) {
    if (!recording) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') return stopRecording()
    const accelerator = acceleratorFrom(event)
    if (!accelerator) return // só modificador até agora: espera a tecla de verdade
    const action = recording
    stopRecording()
    setShortcut(action, accelerator)
  }

  onDestroy(() => (ui.recordingShortcut = false))

  async function copyInvite() {
    await navigator.clipboard.writeText(
      `Bora pro Resenha! Baixa aqui: https://github.com/LucasLomiento/resenha/releases/latest\nNa hora de criar a conta, usa o convite: ${store.invite}`,
    )
    copied = true
    setTimeout(() => (copied = false), 1500)
  }
</script>

<svelte:window onkeydowncapture={onRecordKey} />

<Modal title="Configurações" width={680} onclose={() => (recording ? stopRecording() : (ui.settings = null))}>
  <div class="tabs">
    {#each tabs as tab (tab.id)}
      <button class:on={ui.settings === tab.id} onclick={() => (ui.settings = tab.id)}>{tab.label}</button>
    {/each}
  </div>

  {#if ui.settings === 'voice'}
    <div class="grid">
      <label>
        <span class="label">Microfone</span>
        <select class="field" bind:value={settings.inputDevice} onchange={micChanged}>
          <option value="default">Padrão do sistema</option>
          {#each inputs.filter((d) => d.deviceId && d.deviceId !== 'default') as d (d.deviceId)}
            <option value={d.deviceId}>{d.label || 'Microfone'}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="label">Saída de áudio</span>
        <select class="field" bind:value={settings.outputDevice} onchange={() => call.applyOutput()}>
          <option value="default">Padrão do sistema</option>
          {#each outputs.filter((d) => d.deviceId && d.deviceId !== 'default') as d (d.deviceId)}
            <option value={d.deviceId}>{d.label || 'Alto-falante'}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="meter-row">
      <button class="btn secondary" onclick={() => (testing ? stopTest() : startTest())}>
        <Icon name="mic" size={16} />{testing ? 'Parar teste' : 'Testar microfone'}
      </button>
      <span class="hint inline">No teste você se ouve de volta. Use fone, senão dá microfonia.</span>
    </div>

    <span class="label">Redução de ruído</span>
    <div class="segmented">
      <button class:on={settings.noiseReduction === 'rnnoise'} onclick={() => setNoise('rnnoise')}>RNNoise</button>
      <button class:on={settings.noiseReduction === 'browser'} onclick={() => setNoise('browser')}>Do Chromium</button>
      <button class:on={settings.noiseReduction === 'off'} onclick={() => setNoise('off')}>Desligada</button>
    </div>
    <p class="hint">
      {#if settings.noiseReduction === 'rnnoise'}
        O mesmo filtro do noise-suppression-for-voice: tira teclado, ventilador e barulho de fundo e deixa a voz. Se o seu
        microfone já passa por ele no sistema, deixe desligado aqui pra não filtrar duas vezes.
      {:else if settings.noiseReduction === 'browser'}
        O filtro que vem no Chromium: mais leve, mas tira menos ruído que o RNNoise.
      {:else}
        Sem filtro nenhum: a voz sai como o microfone entrega.
      {/if}
    </p>

    <label class="check">
      <input type="checkbox" bind:checked={settings.gate.enabled} onchange={processingChanged} />
      <span>Limiar do microfone <small>Só transmite quando você fala; o resto vira silêncio.</small></span>
    </label>
    {#if settings.gate.enabled}
      <div class="segmented gate-mode">
        <button
          class:on={settings.gate.auto}
          onclick={() => {
            settings.gate.auto = true
            processingChanged()
          }}>Automático (detecta voz)</button
        >
        <button
          class:on={!settings.gate.auto}
          onclick={() => {
            settings.gate.auto = false
            processingChanged()
          }}>Manual (por volume)</button
        >
      </div>
    {/if}

    <div class="level" class:passing class:idle={!hasMic}>
      <div class="level-fill" style:width="{meterPos(levelDb) * 100}%"></div>
      {#if settings.gate.enabled && !settings.gate.auto}
        <div class="threshold" style:left="{meterPos(settings.gate.thresholdDb) * 100}%"></div>
      {/if}
    </div>
    {#if settings.gate.enabled && !settings.gate.auto}
      <div class="row tight">
        <input
          type="range"
          class="threshold-range"
          min={METER_MIN}
          max="0"
          step="1"
          bind:value={settings.gate.thresholdDb}
          oninput={processingChanged}
        />
        <span class="db">{settings.gate.thresholdDb} dB</span>
      </div>
    {/if}
    <p class="hint">
      {#if !hasMic}Clique em Testar microfone pra ver o nível.
      {:else if !settings.gate.enabled}Barra verde: tem som saindo.
      {:else if settings.gate.auto}Verde quando o RNNoise reconhece voz; fora disso, silêncio.
      {:else}Arraste a marca: acima dela (verde) passa, abaixo é cortado. Deixe a marca logo acima do barulho de fundo.{/if}
    </p>

    <div class="toggles">
      <label class="check">
        <input type="checkbox" bind:checked={settings.echoCancellation} onchange={micChanged} />
        <span>Cancelamento de eco <small>Deixe ligado se usa caixa de som; com fone dá pra desligar.</small></span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={settings.autoGainControl} onchange={micChanged} />
        <span>Ganho automático <small>Ajusta o volume da voz sozinho. Não mexe no volume do sistema.</small></span>
      </label>
    </div>
  {:else if ui.settings === 'screen'}
    <div class="grid">
      <label>
        <span class="label">Qualidade padrão</span>
        <select class="field" bind:value={settings.screenPreset} onchange={() => call.updateShare()}>
          {#each Object.entries(PRESETS) as [key, preset] (key)}
            <option value={key as ScreenPreset}>{preset.label} · 60 fps · até {preset.bitrate / 1_000_000} Mbps</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="label">Codec de vídeo</span>
        <select class="field" bind:value={settings.codec} onchange={() => call.updateShare()}>
          {#each ['VP9', 'VP8', 'H264', 'AV1'] as codec (codec)}<option value={codec as VideoCodec}>{codec}</option>{/each}
        </select>
      </label>
    </div>
    <p class="hint">
      No P2P, cada pessoa assistindo é uma codificação a mais no seu PC e uma cópia a mais no seu upload. Se a CPU apertar,
      VP8 e H264 pesam menos que VP9 e AV1. Muda na hora, mesmo com a transmissão rolando.
    </p>
    <div class="toggles">
      <label class="check">
        <input type="checkbox" checked={settings.screenMode === 'motion'} onchange={(e) => {
            settings.screenMode = e.currentTarget.checked ? 'motion' : 'detail'
            call.updateShare()
          }} />
        <span>Priorizar fluidez <small>Com a rede apertada, baixa a resolução e mantém 60 fps.</small></span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={settings.screenAudio} />
        <span>Compartilhar o áudio por padrão</span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={settings.showStats} />
        <span>Mostrar estatísticas na transmissão <small>Resolução, fps, bitrate, codec, ping e buffer.</small></span>
      </label>
    </div>
  {:else if ui.settings === 'shortcuts' && store.desktop}
    <p class="hint first">
      Funcionam mesmo com o Resenha minimizado. Clique no atalho e aperte a combinação nova; Esc cancela.
    </p>
    <ul class="shortcuts">
      {#each ACTIONS as action (action.id)}
        {@const value = store.desktop.shortcuts[action.id]}
        <li>
          <span>{action.label}</span>
          <button class="key" class:recording={recording === action.id} onclick={() => record(action.id)}>
            {recording === action.id ? 'Aperte as teclas…' : describeAccelerator(value, store.platform?.platform ?? '')}
          </button>
          <button class="icon-btn" title="Remover atalho" disabled={!value} onclick={() => setShortcut(action.id, null)}>
            <Icon name="x" size={16} />
          </button>
        </li>
        {#if failed.includes(action.id)}
          <li class="warn">O sistema não deixou usar esse atalho globalmente (já está em uso?). Dentro do app ele funciona.</li>
        {/if}
      {/each}
    </ul>
    {#if store.platform?.hyprland}
      <p class="hint">
        No Hyprland, atalho que funciona com o app em segundo plano é um bind no seu config rodando
        <code class="selectable">resenha --action=toggle-mute</code> (ou <code>toggle-deafen</code>, <code>toggle-share</code>,
        <code>leave-call</code>, <code>show-window</code>). Os de cima valem com a janela em foco.
      </p>
    {/if}
  {:else if ui.settings === 'app' && store.desktop}
    {@const desktop = store.desktop}
    <div class="toggles first">
      <label class="check">
        <input type="checkbox" checked={desktop.autostart} onchange={(e) => store.setDesktop({ autostart: e.currentTarget.checked })} />
        <span>Abrir junto com o computador</span>
      </label>
      <label class="check sub" class:disabled={!desktop.autostart}>
        <input
          type="checkbox"
          checked={desktop.startHidden}
          disabled={!desktop.autostart}
          onchange={(e) => store.setDesktop({ startHidden: e.currentTarget.checked })}
        />
        <span>Começar escondido <small>Na bandeja (ou minimizado, se a bandeja estiver desligada).</small></span>
      </label>
      <label class="check">
        <input type="checkbox" checked={desktop.tray} onchange={(e) => store.setDesktop({ tray: e.currentTarget.checked })} />
        <span>Ícone na bandeja do sistema <small>Ao lado do relógio, com mutar, ensurdecer e sair da call.</small></span>
      </label>
      <label class="check sub" class:disabled={!desktop.tray}>
        <input
          type="checkbox"
          checked={desktop.closeToTray}
          disabled={!desktop.tray}
          onchange={(e) => store.setDesktop({ closeToTray: e.currentTarget.checked })}
        />
        <span>Fechar a janela só esconde <small>A call continua; pra sair de vez, use a bandeja.</small></span>
      </label>
    </div>

    <div class="row">
      <span class="label">Tamanho da interface</span>
      <div class="zoom">
        <button class="icon-btn" title="Diminuir (Ctrl -)" onclick={() => store.setDesktop({ zoom: Math.round((desktop.zoom - 0.1) * 10) / 10 })}>−</button>
        <span>{Math.round(desktop.zoom * 100)}%</span>
        <button class="icon-btn" title="Aumentar (Ctrl +)" onclick={() => store.setDesktop({ zoom: Math.round((desktop.zoom + 0.1) * 10) / 10 })}>+</button>
        <button class="btn secondary small" onclick={() => store.setDesktop({ zoom: 1 })}>Padrão</button>
      </div>
    </div>

    <div class="toggles">
      <label class="check">
        <input type="checkbox" bind:checked={settings.sounds} />
        <span>Sons <small>Entrar e sair da call, mutar, ensurdecer, alguém começando a transmitir.</small></span>
      </label>
      <div class="row sub" class:disabled={!settings.sounds}>
        <input type="range" min="0" max="1" step="0.05" bind:value={settings.soundVolume} disabled={!settings.sounds} />
        <button class="btn secondary small" disabled={!settings.sounds} onclick={() => playSound('self-join')}>Ouvir</button>
      </div>
      <label class="check sub" class:disabled={!settings.sounds}>
        <input type="checkbox" bind:checked={settings.messageSound} disabled={!settings.sounds} />
        <span>Som de mensagem nova</span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={settings.compressImages} />
        <span>Comprimir imagens ao enviar <small>No máximo 2560 px, em WebP. Economiza espaço no servidor.</small></span>
      </label>
    </div>

    <span class="label">Atualizações</span>
    <div class="updates">
      <span>
        Versão {store.platform?.version}
        {#if store.update.status === 'none'}· é a mais nova
        {:else if store.update.status === 'checking'}· procurando…
        {:else if store.update.status === 'available'}· a {store.update.version} saiu
        {:else if store.update.status === 'downloading'}· baixando {store.update.version} ({store.update.percent}%)
        {:else if store.update.status === 'ready'}· {store.update.version} pronta pra instalar
        {:else if store.update.status === 'installing'}· instalando…
        {:else if store.update.status === 'unsupported'}· este jeito de instalar não se atualiza sozinho
        {:else if store.update.status === 'error'}· erro: {store.update.message}{/if}
      </span>
      {#if store.update.status === 'available'}
        <button class="btn" onclick={() => window.resenha.update.download()}>Baixar</button>
      {:else if store.update.status === 'ready'}
        <button class="btn" onclick={() => window.resenha.update.install()}>Reiniciar e atualizar</button>
      {:else if store.update.status !== 'unsupported'}
        <button
          class="btn secondary"
          disabled={store.update.status === 'checking' || store.update.status === 'downloading' || store.update.status === 'installing'}
          onclick={() => window.resenha.update.check()}>Procurar atualização</button
        >
      {/if}
    </div>
  {:else if ui.settings === 'group'}
    <span class="label">Pessoas</span>
    <ul class="people">
      {#each Object.values(store.users) as user (user.id)}
        <li><span class="online" class:on={store.online[user.id]}></span>{user.name}{#if user.admin}<small>admin</small>{/if}</li>
      {/each}
    </ul>

    {#if store.me?.admin}
      <span class="label">Convidar</span>
      <div class="invite">
        <button class="btn secondary" onclick={() => store.send({ t: 'invite.create' })}>Gerar convite</button>
        {#if store.invite}
          <code class="selectable">{store.invite}</code>
          <button class="icon-btn" title="Copiar mensagem com o link e o convite" onclick={copyInvite}>
            <Icon name={copied ? 'check' : 'copy'} />
          </button>
        {/if}
      </div>
      <p class="hint">Cada convite vale pra uma conta e vence em 7 dias.</p>

      <span class="label">Canais</span>
      <ul class="channels">
        {#each store.channels as channel (channel.id)}
          <li>
            <Icon name={channel.kind === 'text' ? 'hash' : 'volume'} size={16} />
            {#if channel.id in renaming}
              <input
                class="field small"
                bind:value={renaming[channel.id]}
                onkeydown={(e) => e.key === 'Enter' && rename(channel.id)}
                onblur={() => rename(channel.id)}
              />
            {:else}
              <span class="channel-name">{channel.name}</span>
              <button class="icon-btn" title="Renomear" onclick={() => (renaming[channel.id] = channel.name)}><Icon name="pencil" size={15} /></button>
              <button class="icon-btn" title="Apagar canal e mensagens" onclick={() => store.send({ t: 'channel.delete', id: channel.id })}>
                <Icon name="trash" size={15} />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
      <form class="new-channel" onsubmit={createChannel}>
        <input class="field" bind:value={newChannel} placeholder="Nome do canal" maxlength="32" />
        <select class="field" bind:value={newKind}>
          <option value="text">Texto</option>
          <option value="voice">Voz</option>
        </select>
        <button class="btn" type="submit">Criar</button>
      </form>
    {/if}
  {:else if ui.settings === 'account'}
    <p>Conectado como <b>{store.me?.name}</b>.</p>
    <p class="hint">Resenha {store.platform?.version} · {store.platform?.platform}</p>
    <button class="btn danger" onclick={() => store.logout()}><Icon name="logout" size={16} />Sair da conta</button>
  {/if}
</Modal>

<style>
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 18px;
    border-bottom: 1px solid var(--border);
  }

  .tabs button {
    padding: 8px 12px;
    color: var(--text-dim);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }

  .tabs button.on {
    color: var(--text);
    border-color: var(--accent);
    font-weight: 600;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .meter-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 0 6px;
  }

  .hint.inline {
    margin: 0;
  }

  .segmented {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 3px;
    padding: 3px;
    margin: 6px 0 0;
    border-radius: 8px;
    background: var(--bg-deep);
  }

  .segmented button {
    padding: 6px 8px;
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 13px;
  }

  .segmented button.on {
    background: var(--bg-active);
    color: var(--text);
    font-weight: 600;
  }

  .gate-mode {
    margin: 8px 0 0 26px;
  }

  .level {
    position: relative;
    height: 10px;
    margin-top: 12px;
    border-radius: 5px;
    background: var(--bg-deep);
    overflow: hidden;
  }

  .level-fill {
    height: 100%;
    background: #5a5c66;
    transition: width 50ms linear;
  }

  .level.passing .level-fill {
    background: var(--green);
  }

  .level.idle {
    opacity: 0.5;
  }

  .threshold {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 3px;
    margin-left: -1px;
    background: var(--yellow);
  }

  .row.tight {
    margin: 6px 0 0;
  }

  .threshold-range {
    flex: 1;
    max-width: none !important;
  }

  .db {
    min-width: 56px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }

  .toggles {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;
  }

  .check {
    flex-direction: row;
    gap: 10px;
    align-items: flex-start;
    cursor: pointer;
  }

  .check input {
    margin-top: 3px;
    accent-color: var(--accent);
  }

  .check span {
    display: flex;
    flex-direction: column;
  }

  small {
    color: var(--text-faint);
  }

  .hint {
    color: var(--text-faint);
    font-size: 13px;
    margin: 10px 0;
  }

  .people,
  .channels {
    list-style: none;
    margin: 8px 0 18px;
    padding: 0;
  }

  .people li,
  .channels li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }

  .people small {
    margin-left: 4px;
    color: var(--accent);
  }

  .online {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-faint);
  }

  .online.on {
    background: var(--green);
  }

  .channel-name {
    flex: 1;
  }

  .field.small {
    padding: 4px 8px;
  }

  .invite {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }

  .invite code {
    font: 15px var(--mono);
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--bg-deep);
  }

  .first {
    margin-top: 0;
  }

  .sub {
    margin-left: 26px;
  }

  .disabled {
    opacity: 0.5;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 0 4px;
  }

  .row.sub {
    margin-top: -4px;
  }

  .row input[type='range'] {
    flex: 1;
    max-width: 260px;
    accent-color: var(--accent);
  }

  .zoom {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .zoom span {
    min-width: 48px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .btn.small {
    padding: 4px 10px;
    font-size: 12px;
  }

  .shortcuts {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
  }

  .shortcuts li {
    display: grid;
    grid-template-columns: 1fr 200px 32px;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
  }

  .shortcuts li.warn {
    display: block;
    color: var(--yellow);
    font-size: 12px;
    padding-top: 0;
  }

  .key {
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--bg-deep);
    border: 1px solid var(--border);
    font: 13px var(--mono);
    text-align: center;
  }

  .key.recording {
    border-color: var(--accent);
    color: var(--accent);
  }

  .updates {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 8px;
    color: var(--text-dim);
  }

  .new-channel {
    display: grid;
    grid-template-columns: 1fr 110px auto;
    gap: 8px;
  }
</style>
