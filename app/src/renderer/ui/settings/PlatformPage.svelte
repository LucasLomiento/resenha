<script lang="ts">
  import { onMount } from 'svelte'
  import type { AdminPanel, AdminUser } from '../../lib/api'
  import { client } from '../../lib/client.svelte'
  import { formatSize } from '../../lib/format'
  import { confirmAction } from '../../lib/ui.svelte'
  import { Avatar, Badge, Button, Icon, PageHeader, RadioGroup, Row, Section, Spinner, TextField } from '../kit'

  const GB = 1024 ** 3
  const count = new Intl.NumberFormat('pt-BR')
  const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })

  const bytes = (n: number) => (n >= GB ? `${(n / GB).toFixed(1).replace('.', ',').replace(/,0$/, '')} GB` : formatSize(n))
  /** "5 de out. de 2026" vira "5 out 2026". */
  const date = (ms: number) => dateFmt.format(ms).replaceAll(' de ', ' ').replace('.', '')

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

  function setBanned(user: AdminUser, banned: boolean) {
    // Reativar não precisa de confirmação: dá pra suspender de novo.
    if (!banned) return apply(user, false)
    confirmAction({
      title: `Suspender ${user.name}?`,
      description: 'A conta sai de todos os aparelhos e não entra mais até você reativar.',
      confirm: 'Suspender',
      onconfirm: () => apply(user, true),
    })
  }
</script>

<PageHeader title="Plataforma" description="Vale pro Resenha inteiro, não só pros seus servidores." />

{#if panel}
  <div class="stats">
    <div class="stat">
      <span class="stat-label">Contas</span>
      <span class="stat-value">{count.format(panel.users)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Servidores</span>
      <span class="stat-value">{count.format(panel.guilds)}</span>
    </div>
    <div class="stat" data-setting="platform.storage">
      <span class="stat-label">Espaço usado</span>
      <span class="stat-value">{bytes(panel.storageUsed)} <small>de {bytes(panel.storageLimit)}</small></span>
      {@render meter('Espaço usado', storage)}
      {#if tone(storage) === 'full'}
        <span class="stat-note tone-full"><Icon name="circle-alert" size={14} />Cheio: anexos novos não sobem.</span>
      {:else if tone(storage) === 'warn'}
        <span class="stat-note tone-warn"><Icon name="triangle-alert" size={14} />Quase cheio ({Math.round(storage * 100)}%).</span>
      {/if}
    </div>
    <div class="stat wide" data-setting="platform.media">
      <span class="stat-label">Mídia pelo Cloudflare neste mês</span>
      <span class="stat-value">{bytes(panel.mediaUsed ?? 0)} <small>de {bytes(panel.mediaLimit ?? 0)}</small></span>
      {@render meter('Mídia pelo Cloudflare neste mês', media)}
      {#if tone(media) === 'full'}
        <span class="stat-note tone-full"><Icon name="circle-alert" size={14} />Acabou a cota do mês: tela e calls ficam só diretas até o mês virar.</span>
      {:else}
        <span class="stat-note tone-{tone(media)}">Tela com 2 ou mais assistindo e conexões que não fecham direto. O grátis é 1.000 GB; o Resenha para antes.</span>
      {/if}
    </div>
  </div>

  {#snippet meter(label: string, part: number)}
    {@const percent = Math.round(part * 100)}
    <div class="meter tone-{tone(part)}" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext="{percent}%">
      <div class="fill" style:width="{part * 100}%"></div>
    </div>
  {/snippet}

  <Section title="Cadastro" setting="platform.signup">
    <RadioGroup
      label="Cadastro"
      bind:value={() => panel!.signup, (mode) => setSignup(mode)}
      options={[
        { value: 'invite', label: 'Só com convite', description: 'Quem chega precisa do convite de algum servidor.' },
        { value: 'open', label: 'Aberto', description: 'Qualquer pessoa cria conta, com verificação anti-robô.' },
      ]}
    />
  </Section>
  {#if signupError}
    <p class="error" role="alert"><Icon name="circle-alert" size={14} />{signupError}</p>
  {/if}
{:else if panelError}
  <Section>
    <Row label="Não deu pra carregar o painel." description={panelError}>
      <Button icon="restart" onclick={loadPanel}>Tentar de novo</Button>
    </Row>
  </Section>
{:else}
  <div class="loading" role="status" aria-label="Carregando"><Spinner size={20} /></div>
{/if}

<div class="accounts">
  <Section setting="platform.accounts" title="Contas">
    {#snippet actions()}
      <div class="search">
        <TextField icon="search" placeholder="Nome ou usuário" aria-label="Buscar contas" bind:value={query} spellcheck={false} />
      </div>
    {/snippet}
    {#if usersError}
      <Row label="Não deu pra buscar." description={usersError}>
        <Button icon="restart" onclick={() => search(query.trim())}>Tentar de novo</Button>
      </Row>
    {:else if users === null}
      <Row><div class="row-loading"><Spinner size={18} /></div></Row>
    {:else}
      {#each users as user (user.id)}
        {@const self = user.id === client.me?.id}
        <Row label={user.name} description="{user.username} · desde {date(user.createdAt)}">
          {#snippet leading()}
            <Avatar id={user.id} name={user.name} size={32} src={client.api?.avatar(user) ?? null} cutout="var(--bg-raised)" />
          {/snippet}
          {#if self}
            <Badge tone="accent">Você</Badge>
          {:else if user.banned}
            <Badge tone="danger">Suspensa</Badge>
            <Button size="sm" loading={busyUser === user.id} disabled={!!busyUser} onclick={() => setBanned(user, false)}>Reativar</Button>
          {:else}
            <Button size="sm" loading={busyUser === user.id} disabled={!!busyUser} onclick={() => setBanned(user, true)}>Suspender</Button>
          {/if}
        </Row>
      {:else}
        <Row description={query.trim() ? 'Ninguém com esse nome.' : 'Nenhuma conta ainda.'} />
      {/each}
    {/if}
  </Section>
</div>

<style>
  .stats {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr);
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
