<script lang="ts">
  import { Avatar, Button, Icon, IconButton, STATUS_LABEL, Tabs, TextField } from '../kit'
  import { channels, displayName, friends, guilds, presences, user, voice } from './data'

  let { tab = 'online' }: { tab?: 'online' | 'all' | 'pending' | 'add' } = $props()
  let current = $derived(tab)

  const accepted = friends.filter((f) => f.state === 'friends')
  const online = accepted.filter((f) => presences[f.userId].status !== 'offline')
  const incoming = friends.filter((f) => f.state === 'incoming')
  const outgoing = friends.filter((f) => f.state === 'outgoing')
  const list = $derived(current === 'online' ? online : accepted)

  /** Calls com amigos dentro, pra coluna "Agora". */
  const live = channels
    .filter((c) => c.kind === 'voice')
    .map((c) => ({ channel: c, people: voice.filter((v) => v.channelId === c.id) }))
    .filter((c) => c.people.length)
</script>

<div class="page-box">
<div class="page">
  <section class="main">
    <header>
      <Icon name="users" size={20} class="header-icon" />
      <h1>Amigos</h1>
      <span class="divider"></span>
      <Tabs
        label="Amigos"
        bind:value={current}
        tabs={[
          { value: 'online', label: 'Online' },
          { value: 'all', label: 'Todos' },
          { value: 'pending', label: 'Pendentes', count: incoming.length, alert: true },
        ]}
      />
      <div class="spacer"></div>
      <Button size="sm" variant={current === 'add' ? 'secondary' : 'primary'} icon="user-plus" onclick={() => (current = 'add')}>
        Adicionar amigo
      </Button>
    </header>

    <div class="content">
      {#if current === 'add'}
        <div class="add">
          <h2>Adicionar amigo</h2>
          <p>Pelo nome de usuário. A pessoa recebe o pedido e aceita.</p>
          <form class="add-form" onsubmit={(e) => e.preventDefault()}>
            <TextField size="lg" icon="at" placeholder="nome.de.usuario" value="duda" aria-label="Nome de usuário" spellcheck={false} />
            <Button variant="primary" size="lg" type="submit">Mandar pedido</Button>
          </form>
          <p class="add-ok"><Icon name="circle-check" size={16} /><span>Pedido enviado pra <b>duda</b>.</span></p>
          <div class="share">
            <span>Seu nome de usuário</span>
            <code>lucas</code>
            <IconButton icon="copy" label="Copiar" size="sm" />
          </div>
        </div>
      {:else if current === 'pending'}
        <TextField icon="search" placeholder="Buscar" aria-label="Buscar pedidos" />
        <div class="label">Recebidos — {incoming.length}</div>
        {#each incoming as f (f.userId)}
          {@const person = user(f.userId)}
          <div class="person">
            <Avatar id={person.id} name={person.name} size={36} />
            <span class="text">
              <span class="name">{person.name}</span>
              <span class="sub">{person.username} · quer ser seu amigo</span>
            </span>
            <IconButton icon="check" label="Aceitar" variant="subtle" tone="success" active />
            <IconButton icon="x" label="Recusar" variant="subtle" />
          </div>
        {/each}
        <div class="label">Enviados — {outgoing.length}</div>
        {#each outgoing as f (f.userId)}
          {@const person = user(f.userId)}
          <div class="person">
            <Avatar id={person.id} name={person.name} size={36} />
            <span class="text">
              <span class="name">{person.name}</span>
              <span class="sub">{person.username} · aguardando</span>
            </span>
            <IconButton icon="x" label="Cancelar pedido" variant="subtle" />
          </div>
        {/each}
      {:else}
        <TextField icon="search" placeholder="Buscar amigos" aria-label="Buscar amigos" />
        <div class="label">{current === 'online' ? 'Online' : 'Todos'} — {list.length}</div>
        {#each list as f, i (f.userId)}
          {@const person = user(f.userId)}
          {@const presence = presences[f.userId]}
          <div class="person" class:hovered={i === 1}>
            <Avatar id={person.id} name={person.name} size={36} status={presence.status} cutout={i === 1 ? '#18181f' : 'var(--bg-panel)'} />
            <span class="text">
              <span class="name">{displayName(person.id)} <span class="username">{person.username}</span></span>
              <span class="sub">{presence.text ?? STATUS_LABEL[presence.status]}</span>
            </span>
            <IconButton icon="message" label="Mensagem" variant={i === 1 ? 'subtle' : 'ghost'} />
            <IconButton icon="ellipsis" label="Mais" variant={i === 1 ? 'subtle' : 'ghost'} />
          </div>
        {/each}
      {/if}
    </div>
  </section>

  <aside class="now">
    <h2>Agora</h2>
    {#each live as call (call.channel.id)}
      <div class="now-card">
        <div class="now-head">
          <span class="now-server"><Avatar id={guilds[0].id} name={guilds[0].name} size={20} square /> {guilds[0].name}</span>
          <span class="now-channel"><Icon name="volume" size={13} />{call.channel.name}</span>
        </div>
        <div class="now-people">
          {#each call.people as p (p.userId)}
            <Avatar id={p.userId} name={user(p.userId).name} size={28} cutout="var(--bg-raised)" />
          {/each}
          <span class="now-names">{call.people.map((p) => user(p.userId).name).join(', ')}</span>
        </div>
        {#if call.people.some((p) => p.sharing)}
          <span class="now-live">● {user(call.people.find((p) => p.sharing)!.userId).name} está ao vivo</span>
        {/if}
        <Button size="sm" full icon="phone">Entrar</Button>
      </div>
    {/each}
  </aside>
</div>
</div>

<style>
  .page-box {
    height: 100%;
    container-type: inline-size;
  }

  .page {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    height: 100%;
  }

  /* Janela pequena: a coluna "Agora" sai. */
  @container (max-width: 820px) {
    .page {
      grid-template-columns: minmax(0, 1fr);
    }

    .page .now {
      display: none;
    }
  }

  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    height: var(--header-h);
    padding: 0 12px 0 20px;
    border-bottom: 1px solid var(--line);
  }

  header :global(.header-icon) {
    color: var(--fg-3);
  }

  h1 {
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .divider {
    width: 1px;
    height: 18px;
    background: var(--line-strong);
  }

  .spacer {
    flex: 1;
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .label {
    margin: 18px 0 6px;
    padding: 0 8px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .person {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 60px;
    padding: 0 8px;
    border-top: 1px solid var(--line);
    border-radius: var(--r-md);
  }

  .person:hover,
  .person.hovered {
    background: var(--hover);
    border-top-color: transparent;
  }

  .person :global(.icon-btn) {
    opacity: 0.85;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.35;
  }

  .name {
    font-weight: 600;
  }

  .username {
    margin-left: 4px;
    color: var(--fg-3);
    font-weight: 400;
    font-size: var(--text-sm);
    opacity: 0;
  }

  .person:hover .username,
  .person.hovered .username {
    opacity: 1;
  }

  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .add {
    max-width: 560px;
  }

  .add h2 {
    font-size: var(--text-xl);
    font-weight: 650;
  }

  .add > p {
    margin-top: 4px;
    color: var(--fg-2);
  }

  .add-form {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }

  .add-form :global(.field) {
    flex: 1;
  }

  .add-ok {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    color: var(--green);
    font-size: var(--text-sm);
  }

  .share {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 28px;
    padding: 12px 14px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.035);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .share span {
    flex: 1;
  }

  .share code {
    font: 500 14px var(--mono);
    color: var(--fg);
  }

  .now {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    padding: 16px;
    border-left: 1px solid var(--line);
    overflow-y: auto;
  }

  .now h2 {
    font-size: var(--text-md);
    font-weight: 600;
  }

  .now-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight);
  }

  .now-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .now-server {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: var(--text-sm);
  }

  .now-channel {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .now-people {
    display: flex;
    align-items: center;
  }

  .now-people :global(.avatar + .avatar) {
    margin-left: -8px;
  }

  .now-people :global(.avatar) {
    box-shadow: 0 0 0 2px var(--bg-raised);
  }

  .now-names {
    margin-left: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
    font-size: var(--text-xs);
  }

  .now-live {
    color: var(--red);
    font-size: var(--text-xs);
    font-weight: 600;
  }
</style>
