<script lang="ts">
  import type { Presence } from '../../../../../shared/protocol'
  import { userGradient } from '../../lib/format'
  import { Avatar, Icon, STATUS_LABEL } from '../kit'

  let {
    id,
    name,
    username,
    bio,
    accent,
    avatar,
    presence,
    since,
  }: {
    id: string
    name: string
    username: string
    bio: string
    /** 0xRRGGBB, ou null pro degradê automático. */
    accent: number | null
    avatar: string | null
    presence: Presence
    /** Quando a conta foi criada (ms). */
    since: number
  } = $props()

  const sinceFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })

  const color = $derived(accent === null ? null : `#${accent.toString(16).padStart(6, '0')}`)
  const banner = $derived(
    color ? `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 45%, var(--bg-canvas)))` : userGradient(id),
  )
  // "5 de out. de 2026" vira "5 out 2026", igual ao cartão de perfil.
  const sinceText = $derived(sinceFmt.format(since).replaceAll(' de ', ' ').replace('.', ''))
</script>

<!-- Prévia do cartão de perfil (como os outros te veem), sem os botões. -->
<div class="card" aria-label="Prévia do perfil" role="group">
  <div class="banner" style:background={banner}></div>
  <div class="top">
    <Avatar {id} name={name || username} size={80} src={avatar} status={presence.status} cutout="var(--bg-raised)" />
  </div>

  <div class="body">
    <h2 class="truncate">{name.trim() || username}</h2>
    <p class="username">{username}</p>
    {#if presence.text}
      <p class="custom"><span class="bubble">{presence.text}</span></p>
    {:else}
      <p class="custom muted">{STATUS_LABEL[presence.status]}</p>
    {/if}

    {#if bio.trim()}
      <section>
        <h3>Sobre mim</h3>
        <p class="bio">{bio.trim()}</p>
      </section>
    {/if}

    <section>
      <h3>No Resenha desde</h3>
      <p class="since"><Icon name="calendar" size={14} />{sinceText}</p>
    </section>
  </div>
</div>

<style>
  .card {
    width: 100%;
    max-width: 320px;
    border-radius: var(--r-2xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    overflow: hidden;
  }

  .banner {
    height: 96px;
    opacity: 0.75;
  }

  .top {
    display: flex;
    margin-top: -44px;
    padding: 0 16px;
  }

  .top :global(.avatar) {
    box-shadow: 0 0 0 6px var(--bg-raised);
  }

  .body {
    padding: 12px 16px 16px;
  }

  h2 {
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.015em;
  }

  .username {
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .custom {
    margin-top: 10px;
    font-size: var(--text-sm);
  }

  .bubble {
    display: inline-block;
    padding: 6px 10px;
    border-radius: 12px 12px 12px 4px;
    background: rgb(255 255 255 / 0.06);
    color: var(--fg);
  }

  .custom.muted {
    color: var(--fg-3);
  }

  section {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  h3 {
    margin-bottom: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  section p {
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .bio {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .since {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .since :global(svg) {
    color: var(--fg-3);
  }
</style>
