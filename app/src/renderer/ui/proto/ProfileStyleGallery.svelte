<script lang="ts">
  import { DECORATIONS, type Presence, type ProfileStyle } from '../../../../../shared/protocol'
  import { DECORATION_LABEL, badgeOf, nameStyle } from '../../lib/profile'
  import { Avatar, UserBadge } from '../kit'
  import ProfilePreview from '../settings/ProfilePreview.svelte'

  // Personalização do perfil com dados de exemplo: cartões, molduras e nomes,
  // pra conferir de olho (e nas capturas) sem servidor.

  const banner = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#1d1b4a"/><stop offset=".6" stop-color="#6a5cf6"/><stop offset="1" stop-color="#ff7ab6"/></linearGradient></defs><rect width="600" height="240" fill="url(#g)"/><circle cx="470" cy="70" r="46" fill="#ffd36b" opacity=".85"/><path d="M0 200 Q150 120 300 190 T600 170 V240 H0Z" fill="#0b0b10" opacity=".55"/></svg>`,
  )}`

  const online: Presence = { status: 'online', text: null }
  const cards: { id: string; name: string; username: string; bio: string; accent: number | null; banner?: string; style: ProfileStyle; presence: Presence }[] = [
    {
      id: 'u-lucas',
      name: 'Lucas',
      username: 'lucas',
      bio: 'Fiz o Resenha.',
      accent: null,
      banner,
      style: { theme: [0x6a5cf6, 0xff7ab6], effect: 'sparkles', decoration: 'founder', nameEffect: 'holo', pronouns: 'ele/dele', badge: 'founder' },
      presence: { status: 'online', text: 'na call' },
    },
    {
      id: 'u-duarte',
      name: 'Duarte',
      username: 'duarte',
      bio: 'Cheguei primeiro.',
      accent: null,
      style: { theme: [0x2e8bff, 0x2ad4b0], effect: 'bubbles', decoration: 'pioneer', nameEffect: 'horizon', pronouns: 'ele/dele', badge: 'pioneer' },
      presence: online,
    },
    {
      id: 'u-bia',
      name: 'Bia',
      username: 'bia',
      bio: 'Desenho, café e jogo de terror com a luz apagada.',
      accent: null,
      banner,
      style: { theme: [0x6a5cf6, 0xff7ab6], effect: 'sparkles', decoration: 'aurora', nameFont: 'serif', nameEffect: 'gradient', pronouns: 'ela/dela' },
      presence: { status: 'online', text: 'desenhando' },
    },
    {
      id: 'u-rafa',
      name: 'Rafa',
      username: 'rafa',
      bio: 'Sempre na call.',
      accent: null,
      style: { theme: [0x2e8bff, 0x2ad4b0], effect: 'bubbles', decoration: 'headset', nameFont: 'rounded', nameEffect: 'neon', pronouns: 'ele/dele' },
      presence: online,
    },
    {
      id: 'u-thiago',
      name: 'Thiago',
      username: 'thiago',
      bio: 'Ranqueada só depois das 22h.',
      accent: null,
      style: { theme: [0xe8452c, 0xffc34d], effect: 'confetti', decoration: 'flames', nameFont: 'pixel' },
      presence: { status: 'dnd', text: null },
    },
    {
      id: 'u-duda',
      name: 'Duda',
      username: 'duda',
      bio: '',
      accent: 0x48b9ff,
      style: { effect: 'snow', decoration: 'crown', nameFont: 'script', nameEffect: 'gradient', pronouns: 'ela' },
      presence: { status: 'idle', text: null },
    },
    {
      id: 'u-leo',
      name: 'Leonardo Zé',
      username: 'leo',
      bio: 'Fã de bolha.',
      accent: null,
      style: { theme: [0xff9ccf, 0x8ec5ff], effect: 'hearts', decoration: 'cat' },
      presence: online,
    },
    {
      id: 'u-mari',
      name: 'Mari',
      username: 'mari',
      bio: 'Planta, livro e noite.',
      accent: null,
      style: { theme: [0x2f9e62, 0xc8e05a], effect: 'fireflies', decoration: 'flowers', nameEffect: 'neon' },
      presence: online,
    },
  ]

  const people = cards.map((c) => ({ id: c.id, accent: c.accent, style: c.style }))
  const messages = [
    'alguém online pra jogar?',
    'bora, entra na call',
    'tô terminando uma coisa aqui, já vou',
    'trouxe o café',
    'quem roubou meu lanche',
    'boa noite, galera',
  ]
</script>

<div class="gallery">
  <h1>Personalização do perfil</h1>

  <h2>Cartões</h2>
  <div class="cards">
    {#each cards as c (c.id)}
      <ProfilePreview
        id={c.id}
        name={c.name}
        username={c.username}
        bio={c.bio}
        accent={c.accent}
        avatar={null}
        banner={c.banner ?? null}
        style={c.style}
        presence={c.presence}
        since={Date.UTC(2025, 2, 14)}
      />
    {/each}
  </div>

  <h2>Molduras (80 animada · 36 e 32 paradas)</h2>
  <div class="decos">
    {#each DECORATIONS as kind (kind)}
      <div class="deco">
        <Avatar id="u-{kind}" name={DECORATION_LABEL[kind]} size={80} decoration={kind} play status="online" cutout="var(--bg-panel)" />
        <Avatar id="u-{kind}" name={DECORATION_LABEL[kind]} size={36} decoration={kind} cutout="var(--bg-panel)" />
        <Avatar id="u-{kind}" name={DECORATION_LABEL[kind]} size={32} decoration={kind} status="online" cutout="var(--bg-panel)" />
        <span>{DECORATION_LABEL[kind]}</span>
      </div>
    {/each}
  </div>

  <div class="decos big">
    {#each DECORATIONS as kind (kind)}
      <Avatar id="u-{kind}" name={DECORATION_LABEL[kind]} size={128} decoration={kind} cutout="var(--bg-panel)" />
    {/each}
  </div>

  <h2>Nomes no chat e na lista de membros</h2>
  <div class="chat">
    <div>
      {#each cards as c, i (c.id)}
        {@const styled = nameStyle(people[i])}
        <article>
          <Avatar id={c.id} name={c.name} size={36} decoration={c.style.decoration} cutout="var(--bg-panel)" />
          <div class="body">
            <div class="head">
              <span class="author"><span class={styled.class} style={styled.style}>{c.name}</span></span>
              <UserBadge badge={badgeOf(people[i])} size={15} />
              <time>14:3{i}</time>
            </div>
            <p>{messages[i]}</p>
          </div>
        </article>
      {/each}
    </div>
    <aside class="members">
      {#each cards as c, i (c.id)}
        {@const styled = nameStyle(people[i])}
        <div class="member">
          <Avatar id={c.id} name={c.name} size={32} decoration={c.style.decoration} status={c.presence.status} cutout="var(--bg-panel)" />
          <span class="mname"><span class={styled.class} style={styled.style}>{c.name}</span></span>
          <UserBadge badge={badgeOf(people[i])} size={14} />
        </div>
      {/each}
    </aside>
  </div>
</div>

<style>
  .gallery {
    height: 100%;
    padding: 32px 40px 64px;
    overflow-y: auto;
    background: var(--bg-panel);
  }

  h1 {
    font-size: var(--text-2xl);
    font-weight: 650;
  }

  h2 {
    margin: 28px 0 14px;
    color: var(--fg-3);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(3, 320px);
    gap: 24px;
    align-items: start;
  }

  .decos {
    display: flex;
    flex-wrap: wrap;
    gap: 28px;
  }

  .decos.big {
    gap: 40px 36px;
    margin-top: 36px;
  }

  .deco {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100px;
    color: var(--fg-2);
    font-size: var(--text-xs);
  }

  .chat {
    display: grid;
    grid-template-columns: minmax(0, 560px) 248px;
    gap: 32px;
  }

  article {
    display: flex;
    gap: 14px;
    margin-top: 14px;
    padding: 3px 0;
  }

  .body {
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 1px;
  }

  .author {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }

  time {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  article p {
    font-size: var(--text-lg);
    line-height: 1.5;
  }

  .member {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 44px;
    padding: 0 8px;
  }

  .mname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-block: -3px;
    padding-block: 3px;
    color: var(--fg-2);
    font-size: var(--text-md);
    font-weight: 500;
  }
</style>
