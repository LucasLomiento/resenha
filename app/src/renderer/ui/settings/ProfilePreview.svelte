<script lang="ts">
  import type { Presence, ProfileStyle } from '../../../../../shared/protocol'
  import { isFounder, nameStyle } from '../../lib/profile'
  import { Avatar, FounderBadge, Icon, STATUS_LABEL } from '../kit'
  import ProfileShell from '../profile/ProfileShell.svelte'

  let {
    id,
    name,
    username,
    bio,
    accent,
    avatar,
    banner = null,
    style = undefined,
    presence,
    since,
  }: {
    id: string
    name: string
    username: string
    bio: string
    /** 0xRRGGBB, ou null pro degradê automático. */
    accent: number | null
    /** Foto (a animada, se for). */
    avatar: string | null
    banner?: string | null
    /** Personalização (o rascunho, pra prévia acompanhar na hora). */
    style?: ProfileStyle
    presence: Presence
    /** Quando a conta foi criada (ms). */
    since: number
  } = $props()

  const sinceFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })

  const user = $derived({ id, accent, style })
  const styledName = $derived(nameStyle(user))
  // "5 de out. de 2026" vira "5 out 2026", igual ao cartão de perfil.
  const sinceText = $derived(sinceFmt.format(since).replaceAll(' de ', ' ').replace('.', ''))
</script>

<!-- Prévia do cartão de perfil (como os outros te veem), sem os botões. -->
<ProfileShell {user} {banner} variant="preview" label="Prévia do perfil">
  <div class="top">
    <Avatar {id} name={name || username} size={80} src={avatar} decoration={style?.decoration} play status={presence.status} cutout="var(--card-cut)" />
  </div>

  <div class="body">
    <h2 class="holo-play">
      <span class={styledName.class} style={styledName.style}>{name.trim() || username}</span>
      {#if isFounder(user)}<FounderBadge size={18} />{/if}
    </h2>
    <p class="username">{username}{#if style?.pronouns}<span class="pronouns">{style.pronouns}</span>{/if}</p>
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
</ProfileShell>

<style>
  .top {
    display: flex;
    margin-top: -44px;
    padding: 0 16px;
  }

  .top :global(.avatar) {
    box-shadow: 0 0 0 6px var(--card-cut);
  }

  .body {
    padding: 12px 16px 16px;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.015em;
    overflow-wrap: anywhere;
  }

  h2 :global(.styled-name) {
    line-height: inherit;
  }

  .username {
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .pronouns {
    margin-left: 8px;
    padding: 1px 7px;
    border-radius: var(--r-full);
    background: rgb(255 255 255 / 0.07);
    font-size: var(--text-xs);
    white-space: nowrap;
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
