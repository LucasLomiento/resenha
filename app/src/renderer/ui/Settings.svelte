<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { ChannelKind } from '../../../../shared/protocol'
  import { getMicTrack, LevelMeter } from '../lib/media'
  import { PRESETS, settings, type ScreenPreset, type VideoCodec } from '../lib/settings.svelte'
  import { store } from '../lib/store.svelte'
  import { ui, type SettingsTab } from '../lib/ui.svelte'
  import Icon from './Icon.svelte'
  import Modal from './Modal.svelte'

  const call = store.call
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'voice', label: 'Voz' },
    { id: 'screen', label: 'Tela' },
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

  // --- teste do microfone ---
  let testing = $state(false)
  let level = $state(0)
  let testTrack: MediaStreamTrack | null = null
  let testMeter: LevelMeter | null = null
  let frame = 0

  async function startTest() {
    stopTest()
    try {
      testTrack = await getMicTrack()
      testMeter = new LevelMeter(testTrack)
      testing = true
      const loop = () => {
        level = Math.min(1, (testMeter?.level() ?? 0) * 6)
        frame = requestAnimationFrame(loop)
      }
      loop()
      loadDevices()
    } catch (err) {
      store.toast(`Sem acesso ao microfone: ${(err as Error).message}`)
    }
  }

  function stopTest() {
    cancelAnimationFrame(frame)
    testMeter?.close()
    testTrack?.stop()
    testMeter = null
    testTrack = null
    testing = false
    level = 0
  }

  onDestroy(stopTest)

  function micChanged() {
    call.reloadMic()
    if (testing) startTest()
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

  async function copyInvite() {
    await navigator.clipboard.writeText(`Servidor: ${store.server}\nConvite: ${store.invite}`)
    copied = true
    setTimeout(() => (copied = false), 1500)
  }
</script>

<Modal title="Configurações" width={640} onclose={() => (ui.settings = null)}>
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
          {#each inputs as d (d.deviceId)}<option value={d.deviceId}>{d.label || 'Microfone'}</option>{/each}
        </select>
      </label>
      <label>
        <span class="label">Saída de áudio</span>
        <select class="field" bind:value={settings.outputDevice} onchange={() => call.applyOutput()}>
          {#each outputs as d (d.deviceId)}<option value={d.deviceId}>{d.label || 'Alto-falante'}</option>{/each}
        </select>
      </label>
    </div>

    <div class="meter-row">
      <button class="btn secondary" onclick={() => (testing ? stopTest() : startTest())}>
        <Icon name="mic" size={16} />{testing ? 'Parar teste' : 'Testar microfone'}
      </button>
      <div class="meter"><div style:width="{level * 100}%"></div></div>
    </div>

    <div class="toggles">
      <label class="check">
        <input type="checkbox" bind:checked={settings.echoCancellation} onchange={micChanged} />
        <span>Cancelamento de eco <small>Deixe ligado se usa caixa de som; com fone dá pra desligar.</small></span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={settings.noiseSuppression} onchange={micChanged} />
        <span>Supressão de ruído <small>Desligue se o microfone já passa por um filtro (ex.: RNNoise).</small></span>
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
        <select class="field" bind:value={settings.screenPreset}>
          {#each Object.entries(PRESETS) as [key, preset] (key)}
            <option value={key as ScreenPreset}>{preset.label} · 60 fps · até {preset.bitrate / 1_000_000} Mbps</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="label">Codec de vídeo</span>
        <select class="field" bind:value={settings.codec}>
          {#each ['VP9', 'VP8', 'H264', 'AV1'] as codec (codec)}<option value={codec as VideoCodec}>{codec}</option>{/each}
        </select>
      </label>
    </div>
    <p class="hint">
      No P2P, cada pessoa assistindo é uma codificação a mais no seu PC e uma cópia a mais no seu upload. Se a CPU apertar,
      VP8 e H264 pesam menos que VP9 e AV1. Vale pra próxima transmissão.
    </p>
    <div class="toggles">
      <label class="check">
        <input type="checkbox" checked={settings.screenMode === 'motion'} onchange={(e) => (settings.screenMode = e.currentTarget.checked ? 'motion' : 'detail')} />
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
          <button class="icon-btn" title="Copiar servidor e convite" onclick={copyInvite}>
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
    <p>Conectado como <b>{store.me?.name}</b> em <code class="selectable">{store.server}</code>.</p>
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

  .meter {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--bg-deep);
    overflow: hidden;
  }

  .meter div {
    height: 100%;
    background: var(--green);
    transition: width 50ms linear;
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

  .new-channel {
    display: grid;
    grid-template-columns: 1fr 110px auto;
    gap: 8px;
  }
</style>
