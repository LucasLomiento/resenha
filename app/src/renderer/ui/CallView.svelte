<script lang="ts">
  import { store } from '../lib/store.svelte'
  import Avatar from './Avatar.svelte'
  import Icon from './Icon.svelte'
  import VideoTile from './VideoTile.svelte'

  const call = store.call
  const channel = $derived(store.channels.find((c) => c.id === call.channelId))
  const members = $derived(call.channelId ? store.membersOf(call.channelId) : [])
  // Até 1 pessoa: bloco grande; até 4: 2 colunas; mais que isso: 3.
  const cols = $derived(members.length <= 1 ? 1 : members.length <= 4 ? 2 : 3)

  function watch(connId: string) {
    call.watch(connId)
    store.view = 'stream'
  }
</script>

<section>
  <header>
    <Icon name="volume" size={20} />
    <span class="title">{channel?.name ?? ''}</span>
    <span class="count">{members.length === 1 ? 'só você por aqui' : `${members.length} na call`}</span>
  </header>

  <div class="grid" style:--cols={cols}>
    {#each members as member (member.connId)}
      {@const self = member.connId === store.connId}
      {@const user = store.users[member.userId]}
      {@const stream = self ? call.camera : call.cameras[member.connId]}
      <div class="tile" class:speaking={call.speaking[member.connId]}>
        {#if stream}
          <VideoTile {stream} mirror={self} />
        {:else}
          <div class="avatar"><Avatar id={member.userId} name={user?.name ?? '?'} size={88} /></div>
        {/if}
        <div class="name-tag">
          <span>{user?.name ?? '?'}{self ? ' (você)' : ''}</span>
          {#if member.deafened}<Icon name="headphones-off" size={14} />
          {:else if member.muted}<Icon name="mic-off" size={14} />{/if}
        </div>
        {#if member.sharing}
          <button class="watch" onclick={() => watch(member.connId)}>
            <span class="live">AO VIVO</span>{self ? 'Ver minha tela' : 'Assistir'}
          </button>
        {/if}
      </div>
    {/each}
  </div>

  <div class="actions">
    <button class="btn" class:secondary={!call.camera} onclick={() => call.toggleCamera()}>
      <Icon name={call.camera ? 'camera-off' : 'camera'} size={16} />{call.camera ? 'Desligar câmera' : 'Ligar câmera'}
    </button>
  </div>
</section>

<style>
  section {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    background: var(--bg-deep);
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 52px;
    padding: 0 18px;
    border-bottom: 1px solid var(--border);
    color: var(--text-faint);
    flex: none;
  }

  .title {
    color: var(--text);
    font-weight: 700;
    font-size: 15px;
  }

  .count {
    margin-left: 6px;
    font-size: 13px;
  }

  .grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    align-content: center;
    gap: 12px;
    padding: 16px;
  }

  .tile {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    overflow: hidden;
    background: var(--bg-raised);
    box-shadow: 0 0 0 2px transparent;
    transition: box-shadow 80ms;
  }

  .tile.speaking {
    box-shadow: 0 0 0 3px var(--green);
  }

  .avatar {
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
    padding: 3px 9px;
    border-radius: 6px;
    background: rgb(0 0 0 / 0.55);
    font-size: 13px;
    font-weight: 600;
    color: #f1f1f4;
  }

  .name-tag :global(svg) {
    color: var(--red);
  }

  .watch {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px 4px 4px;
    border-radius: 8px;
    background: rgb(0 0 0 / 0.6);
    color: #f1f1f4;
    font-size: 13px;
    font-weight: 600;
  }

  .watch:hover {
    background: rgb(0 0 0 / 0.8);
  }

  .actions {
    display: flex;
    justify-content: center;
    padding: 0 16px 16px;
    flex: none;
  }
</style>
