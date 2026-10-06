<script lang="ts">
  import logo from '../../../../build/icon.svg?url'
  import { Avatar, Icon, tooltip } from '../kit'
  import { guilds } from './data'

  /** 'home' ou o id do servidor aberto. */
  let { active }: { active: string } = $props()
</script>

<!-- Trilho de servidores: início no topo, servidores, e no fim criar/entrar. -->
<nav class="rail" aria-label="Servidores">
  <div class="slot" class:active={active === 'home'}>
    <span class="indicator"></span>
    <button class="home" aria-label="Início" use:tooltip={{ text: 'Início', placement: 'right' }}>
      <img src={logo} alt="" width="44" height="44" draggable="false" />
    </button>
  </div>

  <span class="sep"></span>

  {#each guilds as guild (guild.id)}
    <div class="slot" class:active={active === guild.id} class:unread={guild.unread}>
      <span class="indicator"></span>
      <button class="guild" aria-label={guild.name} use:tooltip={{ text: guild.name, placement: 'right' }}>
        <Avatar id={guild.id} name={guild.name} size={44} square />
      </button>
      {#if guild.mentions}<span class="mentions">{guild.mentions}</span>{/if}
    </div>
  {/each}

  <div class="slot">
    <span class="indicator"></span>
    <button class="add" aria-label="Criar ou entrar num servidor" use:tooltip={{ text: 'Criar ou entrar num servidor', placement: 'right' }}>
      <Icon name="plus" size={22} />
    </button>
  </div>
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 0;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .slot {
    position: relative;
    display: grid;
    place-items: center;
    width: 72px;
  }

  /* Marquinha na borda: 8 px = novidade, 20 px = hover, 36 px = aberto. */
  .indicator {
    position: absolute;
    left: 0;
    top: 50%;
    width: 4px;
    height: 0;
    border-radius: 0 4px 4px 0;
    background: var(--fg);
    translate: 0 -50%;
    transition: height var(--t) var(--ease);
  }

  .slot.unread .indicator {
    height: 8px;
  }

  .slot:hover .indicator {
    height: 20px;
  }

  .slot.active .indicator {
    height: 36px;
  }

  button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    transition:
      border-radius var(--t) var(--ease),
      transform var(--t-fast) var(--ease),
      background-color var(--t) var(--ease);
  }

  button:active {
    transform: translateY(1px);
  }

  .home img {
    width: 44px;
    height: 44px;
    border-radius: 14px;
  }

  .guild :global(.avatar),
  .guild :global(.face) {
    border-radius: 16px !important;
    transition: border-radius var(--t) var(--ease);
  }

  .slot:hover .guild :global(.face),
  .slot.active .guild :global(.face) {
    border-radius: 13px !important;
  }

  .slot:not(.active) .guild {
    filter: saturate(0.8) brightness(0.92);
  }

  .slot:hover .guild {
    filter: none;
  }

  .sep {
    width: 28px;
    height: 2px;
    margin: 2px 0;
    border-radius: 1px;
    background: var(--line-strong);
  }

  .add {
    background: rgb(255 255 255 / 0.05);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--green);
  }

  .add:hover {
    background: var(--green);
    color: #062419;
  }

  .mentions {
    position: absolute;
    right: 10px;
    bottom: -2px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--r-full);
    background: var(--red);
    box-shadow: 0 0 0 3px var(--bg-canvas);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }
</style>
