<script lang="ts">
  import { onMount } from 'svelte'
  import type { AdminPanel, AdminUser } from '../../lib/api'
  import { client } from '../../lib/client.svelte'
  import { formatSize } from '../../lib/format'
  import { fmt, m } from '../../lib/i18n.svelte'
  import { badgeOf } from '../../lib/profile'
  import { confirmAction } from '../../lib/ui.svelte'
  import { Avatar, Badge, Button, Icon, PageHeader, RadioGroup, Row, Section, Spinner, TextField, UserBadge } from '../kit'

  const GB = 1024 ** 3
  /** O dono mexe em tudo; o melhor amigo dele só vê os números. */
  const owner = $derived(!!client.me?.staff)
  const t = $derived(m.settings.platform)

  const bytes = (n: number) => (n >= GB ? `${fmt.number(n / GB, { maximumFractionDigits: 1 })} GB` : formatSize(n))
  /** Data curta: no português, "5 de out. de 2026" vira "5 out 2026" (os outros idiomas já vêm curtos). */
  const date = (ms: number) => fmt.date(ms, { day: 'numeric', month: 'short', year: 'numeric' }).replaceAll(' de ', ' ').replace('.', '')

  // ---------- Números e cadastro ----------

  let panel = $state<AdminPanel | null>(null)
  let panelError = $state<string | null>(null)
  let signupError = $state<string | null>(null)

  const fraction = (used: number, limit: number) => Math.min(1, used / Math.max(1, limit))
  /** Cor do medidor pelo quanto falta: violeta, amarelo perto do fim, vermelho cheio. */
  const tone = (part: number) => (part >= 1 ? 'full' : part >= 0.9 ? 'warn' : 'ok')
  const storage = $derived(panel ? fraction(panel.storageUsed, panel.storageLimit) : 0)
  const media = $derived(panel ? fraction(panel.mediaUsed ?? 0, panel.mediaLimit ?? 1) : 0)

  async function loadPanel() {
    const api = client.api
    if (!api) return
    panelError = null
    try {
      panel = await api.admin()
    } catch (err) {
      panelError = (err as Error).message
    }
  }

  onMount(loadPanel)

  async function setSignup(mode: 'invite' | 'open') {
    const api = client.api
    if (!api || !panel || mode === panel.signup) return
    const previous = panel.signup
    panel.signup = mode
    signupError = null
    try {
      await api.adminSignup(mode)
    } catch (err) {
      // 409: falta configurar o anti-robô (Turnstile) no servidor.
      panel.signup = previous
      signupError = (err as Error).message
    }
  }

  // ---------- Contas ----------

  let query = $state('')
  let users = $state<AdminUser[] | null>(null)
  let usersError = $state<string | null>(null)
  let busyUser = $state<string | null>(null)
  let seq = 0

  async function search(q: string) {
    const api = client.api
    if (!api) return
    const mine = ++seq
    try {
      const found = await api.adminUsers(q)
      if (mine !== seq) return
      users = found
      usersError = null
    } catch (err) {
      if (mine === seq) usersError = (err as Error).message
    }
  }

  // Busca enquanto digita, esperando uma pausa.
  $effect(() => {
    if (!owner) return
    const q = query.trim()
    const timer = setTimeout(() => search(q), q ? 300 : 0)
    return () => clearTimeout(timer)
  })

  async function apply(user: AdminUser, banned: boolean) {
    const api = client.api
    if (!api) return
    busyUser = user.id
    try {
      await api.adminBan(user.id, banned)
      user.banned = banned
    } catch (err) {
      client.toast((err as Error).message)
    } finally {
      busyUser = null
    }
  }

  /** O Pioneiro é a primeira conta depois da sua; dá pra trocar se o selo foi pra pessoa errada. */
  function makePioneer(user: AdminUser) {
    confirmAction({
      title: t.pioneer.title(user.name),
      description: t.pioneer.description,
      confirm: t.pioneer.confirm,
      onconfirm: async () => {
        const api = client.api
        if (!api) return
        busyUser = user.id
        try {
          await api.adminSetPioneer(user.id)
          await search(query.trim())
        } catch (err) {
          client.toast((err as Error).message)
        } finally {
          busyUser = null
        }
      },
    })
  }

  function setBanned(user: AdminUser, banned: boolean) {
    // Reativar não precisa de confirmação: dá pra suspender de novo.
    if (!banned) return apply(user, false)
    confirmAction({
      title: t.ban.title(user.name),
      description: t.ban.description,
      confirm: t.ban.confirm,
      onconfirm: () => apply(user, true),
    })
  }
</script>

<PageHeader title={m.settings.pages.platform} description={owner ? t.ownerDescription : t.viewerDescription} />

{#if panel}
  <div class="stats">
    <div class="stat">
      <span class="stat-label">{t.stats.accounts}</span>
      <span class="stat-value">{fmt.number(panel.users)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">{t.stats.servers}</span>
      <span class="stat-value">{fmt.number(panel.guilds)}</span>
    </div>
    <div class="stat" data-setting="platform.invites">
      <span class="stat-label">{t.stats.invites}</span>
      <span class="stat-value">{fmt.number(panel.invites ?? 0)}</span>
    </div>
    <div class="stat wide" data-setting="platform.storage">
      <span class="stat-label">{t.stats.storage}</span>
      <span class="stat-value">{bytes(panel.storageUsed)} <small>{t.stats.of(bytes(panel.storageLimit))}</small></span>
      {@render meter(t.stats.storage, storage)}
      {#if tone(storage) === 'full'}
        <span class="stat-note tone-full"><Icon name="circle-alert" size={14} />{t.storageFull}</span>
      {:else if tone(storage) === 'warn'}
        <span class="stat-note tone-warn"><Icon name="triangle-alert" size={14} />{t.storageWarn(Math.round(storage * 100))}</span>
      {/if}
    </div>
    <div class="stat wide" data-setting="platform.media">
      <span class="stat-label">{t.stats.media}</span>
      <span class="stat-value">{bytes(panel.mediaUsed ?? 0)} <small>{t.stats.of(bytes(panel.mediaLimit ?? 0))}</small></span>
      {@render meter(t.stats.media, media)}
      {#if tone(media) === 'full'}
        <span class="stat-note tone-full"><Icon name="circle-alert" size={14} />{t.mediaFull}</span>
      {:else}
        <span class="stat-note tone-{tone(media)}">{t.mediaNote}</span>
      {/if}
    </div>
  </div>

  {#snippet meter(label: string, part: number)}
    {@const percent = Math.round(part * 100)}
    <div class="meter tone-{tone(part)}" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext="{percent}%">
      <div class="fill" style:width="{part * 100}%"></div>
    </div>
  {/snippet}

  {#if owner}
    <Section title={t.signup.title} setting="platform.signup">
      <RadioGroup
        label={t.signup.title}
        bind:value={() => panel!.signup, (mode) => setSignup(mode)}
        options={[
          { value: 'invite', label: t.signup.invite, description: t.signup.inviteDescription },
          { value: 'open', label: t.signup.open, description: t.signup.openDescription },
        ]}
      />
    </Section>
    {#if signupError}
      <p class="error" role="alert"><Icon name="circle-alert" size={14} />{signupError}</p>
    {/if}
  {/if}
{:else if panelError}
  <Section>
    <Row label={t.loadError} description={panelError}>
      <Button icon="restart" onclick={loadPanel}>{m.common.retry}</Button>
    </Row>
  </Section>
{:else}
  <div class="loading" role="status" aria-label={m.common.loading}><Spinner size={20} /></div>
{/if}

{#if owner}
  <div class="accounts">
    <Section setting="platform.accounts" title={t.accounts.title}>
      {#snippet actions()}
        <div class="search">
          <TextField icon="search" placeholder={t.accounts.placeholder} aria-label={t.accounts.search} bind:value={query} spellcheck={false} />
        </div>
      {/snippet}
      {#if usersError}
        <Row label={t.accounts.searchError} description={usersError}>
          <Button icon="restart" onclick={() => search(query.trim())}>{m.common.retry}</Button>
        </Row>
      {:else if users === null}
        <Row><div class="row-loading"><Spinner size={18} /></div></Row>
      {:else}
        {#each users as user (user.id)}
          {@const self = user.id === client.me?.id}
          {@const badge = badgeOf(user)}
          <Row label={user.name} description={t.accounts.since(user.username, date(user.createdAt))}>
            {#snippet leading()}
              <Avatar id={user.id} name={user.name} size={32} src={client.api?.avatar(user) ?? null} cutout="var(--bg-raised)" />
            {/snippet}
            {#if badge}<UserBadge {badge} size={18} />{/if}
            {#if badge === 'pioneer'}
              <Badge tone="accent">{t.accounts.pioneer}</Badge>
            {:else if !self && !user.banned}
              <Button size="sm" variant="ghost" disabled={!!busyUser} onclick={() => makePioneer(user)}>{t.accounts.makePioneer}</Button>
            {/if}
            {#if self}
              <Badge tone="accent">{m.common.you}</Badge>
            {:else if user.banned}
              <Badge tone="danger">{t.accounts.banned}</Badge>
              <Button size="sm" loading={busyUser === user.id} disabled={!!busyUser} onclick={() => setBanned(user, false)}>{t.accounts.unban}</Button>
            {:else}
              <Button size="sm" loading={busyUser === user.id} disabled={!!busyUser} onclick={() => setBanned(user, true)}>{t.accounts.ban}</Button>
            {/if}
          </Row>
        {:else}
          <Row description={query.trim() ? t.accounts.noMatch : t.accounts.none} />
        {/each}
      {/if}
    </Section>
  </div>
{/if}

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: var(--s-8);
  }

  .stat.wide {
    grid-column: 1 / -1;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding: 14px 16px;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight);
  }

  .stat-label {
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .stat-value {
    font-size: var(--text-2xl);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  .stat-value small {
    color: var(--fg-3);
    font-size: var(--text-sm);
    font-weight: 500;
    letter-spacing: 0;
  }

  .meter {
    height: 8px;
    margin-top: 6px;
    border-radius: var(--r-full);
    background: var(--accent-soft);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    min-width: 4px;
    border-radius: inherit;
    background: var(--accent);
    transition: width var(--t-slow) var(--ease);
  }

  .meter.tone-warn {
    background: var(--yellow-soft);
  }

  .meter.tone-warn .fill {
    background: var(--yellow);
  }

  .meter.tone-full {
    background: var(--red-soft);
  }

  .meter.tone-full .fill {
    background: var(--red);
  }

  .stat-note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .stat-note.tone-warn {
    color: var(--yellow);
  }

  .stat-note.tone-full {
    color: var(--red);
  }

  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 0 2px;
    color: var(--red);
    font-size: var(--text-xs);
  }

  .loading {
    display: grid;
    place-items: center;
    height: 120px;
    color: var(--fg-3);
    animation: rs-fade-in var(--t) var(--ease) 300ms both;
  }

  .accounts {
    margin-top: var(--s-8);
  }

  .search {
    width: 220px;
  }

  .row-loading {
    display: grid;
    place-items: center;
    width: 100%;
    color: var(--fg-3);
  }
</style>
