<script lang="ts">
  import { onMount } from 'svelte'
  import type { AdminIncident, AdminPanel, AdminUsageTarget, AdminUser } from '../../lib/api'
  import { client } from '../../lib/client.svelte'
  import { formatSize } from '../../lib/format'
  import { fmt, m } from '../../lib/i18n.svelte'
  import { badgeOf } from '../../lib/profile'
  import { confirmAction } from '../../lib/ui.svelte'
  import { Avatar, Badge, Button, Icon, IconButton, PageHeader, RadioGroup, Row, Section, Spinner, TextField, UserBadge } from '../kit'

  const GB = 1024 ** 3
  /** A cota de mídia é contada como o Cloudflare cobra: em GB decimais (850 × 10⁹). */
  const GB_DECIMAL = 1e9
  /** O dono mexe em tudo; o melhor amigo dele só vê os números. */
  const owner = $derived(!!client.me?.staff)
  const t = $derived(m.settings.platform)

  const bytes = (n: number) => (n >= GB ? `${fmt.number(n / GB, { maximumFractionDigits: 1 })} GB` : formatSize(n))
  const mediaBytes = (n: number) => (n >= GB_DECIMAL ? `${fmt.number(n / GB_DECIMAL, { maximumFractionDigits: 1 })} GB` : formatSize(n))
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

  // ---------- Pedidos do dia no Cloudflare ----------

  /** Sem as chaves das análises no servidor, não vem: o cartão nem aparece. */
  const usage = $derived(panel?.usage ?? null)
  const usagePart = $derived(usage?.requests != null ? fraction(usage.requests, usage.limit) : 0)
  /** A cota do dia: amarelo a partir do aviso pro dono (60%), vermelho no modo econômico (80%). */
  const usageTone = (part: number) => (part >= 0.8 ? 'full' : part >= 0.6 ? 'warn' : 'ok')
  const time = (ms: number) => fmt.date(ms, { hour: '2-digit', minute: '2-digit' })
  const share = (part: number) => fmt.number(part, { style: 'percent', maximumFractionDigits: part < 0.01 ? 1 : 0 })

  /** De quem é: a conta, a conversa (as duas contas) ou o servidor. */
  function targetName(target: AdminUsageTarget): string {
    if (target.kind === 'dm') return t.usage.dm(target.user?.name ?? '?', target.peer?.name ?? '?')
    if (target.kind === 'user') return target.user?.name ?? t.usage.unknown
    if (target.kind === 'guild') return target.guild?.name || t.usage.kinds.guild
    if (target.kind === 'directory') return t.usage.kinds.directory
    return t.usage.unknown
  }

  const TARGET_ICON = { guild: 'hash', dm: 'message', directory: 'shield', unknown: 'activity', user: 'user' } as const

  // ---------- Barrados pelo servidor e versão do app ----------

  const SYSTEMS: Record<string, string> = { linux: 'Linux', win32: 'Windows', windows: 'Windows', android: 'Android', darwin: 'macOS' }
  const system = (platform?: string | null) => (platform ? (SYSTEMS[platform.toLowerCase()] ?? platform) : '')
  const when = (ms: number) => fmt.date(ms, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  function incidentName(incident: AdminIncident): string {
    const id = incident.userId
    if (!id) return t.incidents.unknown
    return incident.user?.name ?? client.user(id)?.name ?? users?.find((u) => u.id === id)?.name ?? id
  }

  function incidentText(incident: AdminIncident): string {
    // O detalhe (versão do app e contagens por tipo) vai junto: é o que ajuda a achar o bug.
    const kind = incident.kind
    const label =
      kind === 'call-loop' ? t.incidents.callLoop
      : kind === 'voice-loop' ? t.incidents.voiceLoop
      : kind.endsWith(':reconnect') ? t.incidents.reconnect
      : kind.includes(':budget') ? t.incidents.budget
      : kind.startsWith('app:') ? t.incidents.app
      : t.incidents.other
    return incident.detail ? `${label} (${incident.detail})` : label
  }

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

  /** Deixa (ou não) essa pessoa passar uma sala pelo Cloudflare, como o dono (vale na hora, sem ela reconectar). */
  async function toggleRelay(user: AdminUser) {
    const api = client.api
    if (!api) return
    const allowed = !user.relay
    busyUser = user.id
    try {
      await api.adminSetRelay(user.id, allowed)
      user.relay = allowed
      // Liberar e tirar a mesma pessoa: o aviso novo toma o lugar do outro (não aparecem os dois).
      client.toast(allowed ? t.accounts.relayAllowed(user.name) : t.accounts.relayRevoked(user.name), 'info', `relay:${user.id}`)
    } catch (err) {
      client.toast((err as Error).message)
    } finally {
      busyUser = null
    }
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
      <span class="stat-value">{mediaBytes(panel.mediaUsed ?? 0)} <small>{t.stats.of(mediaBytes(panel.mediaLimit ?? 0))}</small></span>
      {@render meter(t.stats.media, media)}
      {#if tone(media) === 'full'}
        <span class="stat-note tone-full"><Icon name="circle-alert" size={14} />{t.mediaFull}</span>
      {:else}
        <span class="stat-note tone-{tone(media)}">{t.mediaNote}</span>
      {/if}
    </div>
    {#if usage}
      <div class="stat wide" data-setting="platform.usage">
        <span class="stat-label">{t.usage.title}</span>
        {#if usage.requests === null || usage.measuredAt === null}
          <span class="stat-value">—</span>
          <span class="stat-note">{t.usage.waiting}</span>
        {:else}
          <span class="stat-value">{fmt.number(usage.requests)} <small>{t.stats.of(fmt.number(usage.limit))}</small></span>
          {@render meter(t.usage.title, usagePart, usageTone(usagePart))}
          {#if usage.economy}
            <span class="stat-note tone-full"><Icon name="circle-alert" size={14} />{t.usage.economy(time(usage.resetAt))}</span>
          {:else if usage.limitAt}
            <span class="stat-note tone-warn"><Icon name="triangle-alert" size={14} />{t.usage.pace(time(usage.limitAt))}</span>
          {/if}
          <span class="stat-note">{t.usage.note(time(usage.resetAt), time(usage.measuredAt))}</span>
        {/if}
      </div>
    {/if}
  </div>

  {#snippet meter(label: string, part: number, level = tone(part))}
    {@const percent = Math.round(part * 100)}
    <div class="meter tone-{level}" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext="{percent}%">
      {#if part > 0}<div class="fill" style:width="{part * 100}%"></div>{/if}
    </div>
  {/snippet}

  {#if usage && usage.top.length > 0}
    <div class="block">
      <Section title={t.usage.topTitle} description={t.usage.topDescription}>
        {#each usage.top.slice(0, 8) as target, i (i)}
          <Row label={targetName(target)} description={target.kind === 'directory' ? t.usage.directory : t.usage.kinds[target.kind]}>
            {#snippet leading()}
              {#if target.kind === 'user' && target.user}
                <Avatar id={target.user.id} name={target.user.name} size={32} src={client.api?.avatar(target.user) ?? null} cutout="var(--bg-raised)" />
              {:else}
                <span class="target-icon"><Icon name={TARGET_ICON[target.kind]} size={16} /></span>
              {/if}
            {/snippet}
            <span class="count">{t.usage.requests(fmt.number(target.requests), share(target.requests / Math.max(1, usage.requests ?? 0)))}</span>
          </Row>
        {/each}
      </Section>
    </div>
  {/if}

  {#if panel.incidents?.length}
    <div class="block">
      <Section title={t.incidents.title} description={t.incidents.description}>
        {#each panel.incidents.slice(0, 20) as incident, i (i)}
          <Row label={incidentName(incident)} description={t.incidents.when(when(incident.at), incidentText(incident))}>
            {#snippet leading()}
              <span class="target-icon warn"><Icon name="triangle-alert" size={16} /></span>
            {/snippet}
          </Row>
        {/each}
      </Section>
    </div>
  {/if}

  {#if owner}
    <div class="block">
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
    </div>
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
          <Row
            label={user.name}
            description={user.appVersion
              ? `${t.accounts.since(user.username, date(user.createdAt))} · ${t.accounts.appVersion(user.appVersion, system(user.platform))}`
              : t.accounts.since(user.username, date(user.createdAt))}
          >
            {#snippet leading()}
              <Avatar id={user.id} name={user.name} size={32} src={client.api?.avatar(user) ?? null} cutout="var(--bg-raised)" />
            {/snippet}
            {#if badge}<UserBadge {badge} size={18} />{/if}
            {#if badge === 'pioneer'}
              <Badge tone="accent">{t.accounts.pioneer}</Badge>
            {:else if !self && !user.banned}
              <Button size="sm" variant="ghost" disabled={!!busyUser} onclick={() => makePioneer(user)}>{t.accounts.makePioneer}</Button>
            {/if}
            {#if !self && !user.banned}
              <IconButton
                icon="cloud"
                size="sm"
                tone="accent"
                active={user.relay}
                aria-pressed={user.relay}
                label={user.relay ? t.accounts.relayRevoke(user.name) : t.accounts.relayAllow(user.name)}
                disabled={!!busyUser}
                onclick={() => toggleRelay(user)}
              />
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
    background: rgb(var(--tint-rgb) / 0.08);
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

  .accounts,
  .block {
    margin-top: var(--s-8);
  }

  .target-icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-full);
    background: rgb(var(--tint-rgb) / 0.06);
    color: var(--fg-2);
  }

  .target-icon.warn {
    background: var(--yellow-soft);
    color: var(--yellow);
  }

  .count {
    color: var(--fg-3);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
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
