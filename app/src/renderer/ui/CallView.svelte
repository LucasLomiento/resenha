<script lang="ts">
  import { plural, userColor } from '../lib/format'
  import { client } from '../lib/client.svelte'
  import { badgeOf } from '../lib/profile'
  import { Avatar, Badge, Button, UserBadge, Icon } from './kit'
  import VideoTile from './VideoTile.svelte'

  const call = client.call
  const place = $derived(client.callPlace)
  const members = $derived(client.callMembers)
  // Até 1 pessoa: bloco grande; até 4: 2 colunas; mais que isso: 3.
  const cols = $derived(members.length <= 1 ? 1 : members.length <= 4 ? 2 : 3)
  const rows = $derived(Math.max(1, Math.ceil(members.length / cols)))

  function watch(connId: string) {
    call.watch(connId)
    client.view = 'stream'
  }
</script>

<!-- Só os blocos: os controles da call ficam no painel da barra lateral, sempre no mesmo lugar. -->
<section aria-label="Call">
  <header>
    <Icon name="volume" size={20} class="header-icon" />
    <h1>{place?.name ?? ''}</h1>
    <span class="count">{members.length <= 1 ? 'só você por aqui' : plural(members.length, 'pessoa', 'pessoas')}</span>
  </header>

  <div class="stage">
    <div class="grid" style:--cols={cols} style:--rows={rows}>
      {#each members as member (member.connId)}
        {@const self = member.connId === client.callConnId}
        {@const user = client.user(member.userId, call.guildId)}
        {@const stream = self ? call.camera : call.cameras[member.connId]}
        <div class="tile" class:speaking={call.speaking[member.connId]} style:--tint={userColor(member.userId)}>
          {#if stream}
            <VideoTile {stream} mirror={self} />
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
            {#if self}<span class="you">você</span>{/if}
          </div>

          {#if member.sharing}
            <div class="watch">
              <Badge tone="live">AO VIVO</Badge>
              <Button size="sm" variant="secondary" icon="eye" onclick={() => watch(member.connId)}>
                {self ? 'Ver minha tela' : 'Assistir'}
              </Button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
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
    font-size: var(--text-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .count {
    color: var(--fg-3);
    font-size: var(--text-sm);
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
    border-radius: var(--r-xl);
    overflow: hidden;
    background:
      radial-gradient(120% 90% at 50% 40%, color-mix(in srgb, var(--tint) 16%, transparent), transparent 70%),
      #17171e;
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight);
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .tile.speaking {
    box-shadow:
      0 0 0 2px var(--green),
      0 0 24px -4px rgb(52 211 153 / 0.45);
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
    height: 26px;
    padding: 0 10px;
    border-radius: var(--r-md);
    background: rgb(8 8 12 / 0.6);
    backdrop-filter: blur(8px);
    color: #f2f2f6;
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
    color: rgb(242 242 246 / 0.55);
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
