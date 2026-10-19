<script lang="ts">
  import { userColor } from '../lib/format'
  import { client } from '../lib/client.svelte'
  import { m } from '../lib/i18n.svelte'
  import { badgeOf } from '../lib/profile'
  import { ui } from '../lib/ui.svelte'
  import BackButton from './BackButton.svelte'
  import { Avatar, Badge, Button, UserBadge, Icon, IconButton } from './kit'
  import VideoTile from './VideoTile.svelte'

  const call = client.call
  const t = $derived(m.app.call)
  const dock = $derived(m.app.dock)
  const place = $derived(client.callPlace)
  const members = $derived(client.callMembers)
  /** O Spotify de alguém é mais um bloco na call, logo depois de quem pôs. */
  const bots = $derived(Object.entries(call.musicBots))
  const tiles = $derived(members.length + bots.length)
  // Até 1 bloco: grande; até 4: 2 colunas; mais que isso: 3. No celular (em pé): 1 coluna até 2, depois 2.
  const cols = $derived(ui.compact ? (tiles <= 2 ? 1 : 2) : tiles <= 1 ? 1 : tiles <= 4 ? 2 : 3)
  const rows = $derived(Math.max(1, Math.ceil(tiles / cols)))
  const hostName = (connId: string) => {
    const userId = members.find((x) => x.connId === connId)?.userId
    return userId ? (client.user(userId, call.guildId)?.name ?? m.app.someone) : m.app.someone
  }

  function watch(connId: string) {
    call.watch(connId)
    client.view = 'stream'
  }
</script>

<!-- Só os blocos: os controles da call ficam no painel da barra lateral, sempre no mesmo lugar
     (no celular, que não vê a barra lateral junto, eles ficam também embaixo da call). -->
<section aria-label={t.label} class:compact={ui.compact}>
  <header>
    <BackButton />
    <Icon name="volume" size={20} class="header-icon" />
    <h1>{place?.name ?? ''}</h1>
    <span class="count">{members.length <= 1 ? t.alone : t.people(members.length)}</span>
  </header>

  <div class="stage">
    <div class="grid" style:--cols={cols} style:--rows={rows}>
      <!-- A câmera de alguém só aparece com a marca dela ligada (sem "Vídeo" no canal, o servidor não liga). -->
      {#each members as member (member.connId)}
        {@const self = member.connId === client.callConnId}
        {@const user = client.user(member.userId, call.guildId)}
        {@const stream = self ? call.camera : member.camera ? call.cameras[member.connId] : null}
        <div class="tile" class:speaking={call.speaking[member.connId]} style:--tint={userColor(member.userId)}>
          {#if stream}
            <VideoTile {stream} mirror={self && call.cameraFacing === 'user'} />
          {:else}
            <div class="face">
              <Avatar
                id={member.userId}
                name={user?.name ?? '?'}
                size={cols === 1 ? 112 : 88}
                src={client.avatarOf(member.userId, call.guildId)}
                animated={client.animatedAvatarOf(member.userId, call.guildId)}
                decoration={user?.style?.decoration ?? null}
                play
              />
            </div>
          {/if}

          <div class="name-tag">
            {#if member.deafened}<Icon name="headphones-off" size={14} class="state" />
            {:else if member.muted}<Icon name="mic-off" size={14} class="state" />{/if}
            <span>{user?.name ?? '?'}</span>
            <UserBadge badge={badgeOf(user)} size={14} />
            {#if self}<span class="you">{t.you}</span>{/if}
          </div>

          {#if member.sharing}
            <div class="watch">
              <Badge tone="live">{m.app.liveBadge}</Badge>
              <Button size="sm" variant="secondary" icon="eye" onclick={() => watch(member.connId)}>
                {self ? t.watchMine : t.watch}
              </Button>
            </div>
          {/if}
        </div>
      {/each}
      {#each bots as [connId, share] (connId)}
        {@const track = share.player?.track}
        <button
          class="tile music"
          class:speaking={call.musicPlaying[connId]}
          aria-label={m.music.botOf(hostName(connId))}
          onclick={() => (ui.music = { connId })}
        >
          {#if track?.cover}<img class="backdrop" src={track.cover} alt="" />{/if}
          <div class="face">
            <div class="disc">
              {#if track?.cover}<img src={track.cover} alt="" />{:else}<Icon name="music" size={cols === 1 ? 44 : 34} />{/if}
            </div>
          </div>
          <div class="name-tag">
            <Icon name="music" size={14} class="spotify" />
            <span>{m.music.bot}</span>
            {#if track}<span class="song">{track.title} · {track.artists}</span>{/if}
          </div>
        </button>
      {/each}
    </div>
  </div>

  {#if ui.compact}
    <div class="controls">
      <IconButton
        icon={call.muted ? 'mic-off' : 'mic'}
        label={call.muted ? dock.unmute : dock.mute}
        size="xl"
        variant="subtle"
        tone="danger"
        tip={false}
        active={call.muted}
        aria-pressed={call.muted}
        onclick={() => call.toggleMute()}
      />
      <IconButton
        icon={call.deafened ? 'headphones-off' : 'headphones'}
        label={call.deafened ? dock.undeafen : dock.deafen}
        size="xl"
        variant="subtle"
        tone="danger"
        tip={false}
        active={call.deafened}
        aria-pressed={call.deafened}
        onclick={() => call.toggleDeafen()}
      />
      <IconButton
        icon={call.camera ? 'camera' : 'camera-off'}
        label={call.camera ? dock.cameraOff : dock.cameraOn}
        size="xl"
        variant="subtle"
        tone="accent"
        tip={false}
        active={!!call.camera}
        aria-pressed={!!call.camera}
        disabled={call.cameraOpening}
        onclick={() => client.toggleCamera()}
      />
      {#if call.camera && client.platform?.mobile}
        <IconButton icon="repeat" label={t.flipCamera} size="xl" variant="subtle" tip={false} disabled={call.cameraOpening} onclick={() => call.flipCamera()} />
      {/if}
      <IconButton icon="phone-off" label={dock.leave} size="xl" variant="subtle" tone="danger" tip={false} active onclick={() => client.leaveCall()} />
    </div>
  {/if}
</section>

<style>
  section {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    height: var(--header-h);
    padding: 0 20px;
    border-bottom: 1px solid var(--line);
  }

  header :global(.header-icon) {
    color: var(--fg-3);
  }

  h1 {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .count {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .compact header {
    gap: 8px;
    padding: 0 12px 0 6px;
  }

  .compact .stage {
    padding: 12px;
  }

  /* Celular em pé: os blocos são mais altos que largos (16:9 ficaria uma faixa fina). */
  .compact .tile {
    aspect-ratio: 4 / 3;
  }

  .compact .grid {
    max-width: calc((100cqh - (var(--rows) - 1) * 12px) / var(--rows) * 4 / 3 * var(--cols) + (var(--cols) - 1) * 12px);
  }

  .controls {
    display: flex;
    justify-content: center;
    gap: 14px;
    flex: none;
    padding: 12px 16px 16px;
    border-top: 1px solid var(--line);
  }

  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow-y: auto;
    padding: 20px;
    container-type: size;
  }

  /* Os blocos (16:9) crescem até ocupar a área toda, pela largura ou pela altura, o que acabar primeiro. */
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    align-content: center;
    gap: 12px;
    width: 100%;
    max-width: calc((100cqh - (var(--rows) - 1) * 12px) / var(--rows) * 16 / 9 * var(--cols) + (var(--cols) - 1) * 12px);
    margin: auto;
  }

  .tile {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 20px;
    overflow: hidden;
    background:
      radial-gradient(120% 90% at 50% 40%, color-mix(in srgb, var(--tint) 16%, transparent), transparent 70%),
      #161619;
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight);
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .tile.speaking {
    box-shadow:
      0 0 0 2px var(--green),
      0 0 18px -6px rgb(var(--accent-rgb) / 0.3);
  }

  .face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  .name-tag {
    position: absolute;
    left: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 20px);
    height: 28px;
    padding: 0 12px;
    border-radius: var(--r-full);
    background: var(--glass);
    backdrop-filter: blur(8px);
    color: var(--glass-fg);
    font-size: var(--text-sm);
    font-weight: 550;
  }

  .name-tag span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name-tag :global(.state) {
    color: var(--red);
  }

  .you {
    color: rgb(244 244 246 / 0.55);
    font-weight: 450;
  }

  /* Bot do Spotify: a capa grande no meio, borrada no fundo. */
  .tile.music {
    display: block;
    width: 100%;
    background: #0e0e10;
    cursor: pointer;
  }

  .tile.music.speaking {
    box-shadow:
      0 0 0 2px var(--spotify),
      0 0 24px -4px rgb(30 215 96 / 0.45);
  }

  .backdrop {
    position: absolute;
    inset: -20%;
    width: 140%;
    height: 140%;
    object-fit: cover;
    filter: blur(28px) brightness(0.45) saturate(1.2);
  }

  .disc {
    display: grid;
    place-items: center;
    width: 38%;
    aspect-ratio: 1;
    max-width: 180px;
    border-radius: var(--r-lg);
    overflow: hidden;
    background: var(--spotify);
    color: var(--spotify-ink);
    box-shadow: var(--shadow-lg);
  }

  .disc img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .name-tag :global(.spotify) {
    flex: none;
    color: var(--spotify);
  }

  .song {
    color: rgb(244 244 246 / 0.6);
    font-weight: 450;
  }

  .watch {
    position: absolute;
    top: 10px;
    right: 10px;
    left: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
</style>
