<script lang="ts">
  import { userGradient } from '../../lib/format'
  import { Avatar, Badge, Button, Icon, IconButton, STATUS_LABEL } from '../kit'
  import { date, displayName, guilds, member, presences, roles, user } from './data'

  /**
   * flat: sem sombra nem borda, na largura toda (painel do lado da conversa privada).
   * actions: botões de Mensagem e Ligar (somem na conversa privada e na prévia do próprio perfil).
   */
  let { userId, flat = false, actions = true }: { userId: string; flat?: boolean; actions?: boolean } = $props()

  const profile = $derived(user(userId))
  const presence = $derived(presences[userId])
  const own = $derived(member(userId))
  const ownRoles = $derived(roles.filter((r) => own?.roles.includes(r.id)).sort((a, b) => b.position - a.position))
</script>

<!-- Cartão de perfil (popout): abre ao clicar no nome ou no avatar, em qualquer lugar. -->
<div class="card" class:flat>
  <div
    class="banner"
    style:background={profile.accent
      ? `linear-gradient(135deg, ${profile.accent}, color-mix(in srgb, ${profile.accent} 45%, #0b0b10))`
      : userGradient(profile.id)}
  ></div>
  <div class="top">
    <Avatar id={profile.id} name={profile.name} size={80} status={presence.status} cutout={flat ? 'var(--bg-panel)' : 'var(--bg-raised)'} />
    <div class="top-actions">
      <IconButton icon="ellipsis" label="Mais" size="sm" variant="subtle" />
    </div>
  </div>

  <div class="body">
    <h2>{displayName(userId)}</h2>
    <p class="username">{profile.username}{#if own?.nick}<span> · {profile.name}</span>{/if}</p>
    {#if presence.text}
      <p class="custom"><span class="bubble">{presence.text}</span></p>
    {:else}
      <p class="custom muted">{STATUS_LABEL[presence.status]}</p>
    {/if}

    {#if profile.bio}
      <section>
        <h3>Sobre mim</h3>
        <p>{profile.bio}</p>
      </section>
    {/if}

    {#if flat}
      <!-- Fora de servidor (conversa privada): no lugar de cargos, o que vocês têm em comum. -->
      <section>
        <h3>No Resenha desde</h3>
        <p class="since"><Icon name="calendar" size={14} />{date(profile.createdAt)}</p>
      </section>
      <section>
        <h3>Servidores em comum</h3>
        <div class="mutual">
          {#each guilds.slice(0, 2) as guild (guild.id)}
            <span class="mutual-item"><Avatar id={guild.id} name={guild.name} size={24} square />{guild.name}</span>
          {/each}
        </div>
      </section>
    {:else}
      <section>
        <h3>Membro desde</h3>
        <p class="since">
          <Icon name="calendar" size={14} />{date(own?.joinedAt ?? profile.createdAt)}
        </p>
      </section>

      <section>
        <h3>Cargos</h3>
        <div class="roles">
          {#each ownRoles as role (role.id)}
            <Badge dot={role.color ?? undefined}>{role.name}</Badge>
          {/each}
          <button class="add-role" aria-label="Dar cargo"><Icon name="plus" size={14} /></button>
        </div>
      </section>
    {/if}

    {#if actions}
      <div class="actions">
        <Button variant="primary" icon="message">Mensagem</Button>
        <IconButton icon="phone" label="Ligar" variant="subtle" size="lg" />
      </div>
    {/if}
  </div>
</div>

<style>
  .card {
    width: 320px;
    border-radius: var(--r-2xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    overflow: hidden;
  }

  .card.flat {
    width: 100%;
    height: 100%;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    overflow-y: auto;
  }

  .flat .top :global(.avatar) {
    box-shadow: 0 0 0 6px var(--bg-panel);
  }

  .banner {
    height: 96px;
    opacity: 0.75;
  }

  .top {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-top: -44px;
    padding: 0 16px;
  }

  .top :global(.avatar) {
    box-shadow: 0 0 0 6px var(--bg-raised);
  }

  .top-actions {
    padding-bottom: 6px;
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

  .username span {
    color: var(--fg-3);
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

  .since {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .since :global(svg) {
    color: var(--fg-3);
  }

  .roles {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .add-role {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: var(--r-sm);
    background: rgb(255 255 255 / 0.07);
    color: var(--fg-2);
  }

  .mutual {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mutual-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }

  .actions :global(.btn) {
    flex: 1;
    height: 36px;
  }
</style>
