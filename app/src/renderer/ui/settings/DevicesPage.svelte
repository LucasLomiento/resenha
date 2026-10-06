<script lang="ts">
  import { onMount } from 'svelte'
  import type { SessionInfo } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { plural } from '../../lib/format'
  import { confirmAction } from '../../lib/ui.svelte'
  import { Badge, Button, Icon, PageHeader, Row, Section, Spinner, type IconName } from '../kit'

  const HOUR = 3_600_000
  const DAY = 24 * HOUR

  let sessions = $state<SessionInfo[] | null>(null)
  let loadError = $state<string | null>(null)
  /** Id do aparelho saindo, ou 'others'. */
  let busy = $state<string | null>(null)

  // Este aparelho primeiro; os outros do uso mais recente pro mais antigo.
  const ordered = $derived(
    [...(sessions ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt - a.lastSeenAt),
  )
  const others = $derived(ordered.filter((s) => !s.current).length)

  async function load() {
    const api = client.api
    if (!api) return
    loadError = null
    try {
      sessions = await api.sessions()
    } catch (err) {
      loadError = (err as Error).message
    }
  }

  onMount(load)

  /** O ícone sai do texto do aparelho ("App no Linux", "Android"...). */
  function deviceIcon(device: string): IconName {
    if (/android|iphone|ipad|ios|celular|phone|mobile/i.test(device)) return 'smartphone'
    if (/mac/i.test(device)) return 'laptop'
    if (/windows|linux|\bapp\b|resenha/i.test(device)) return 'monitor'
    return 'globe'
  }

  const regions = new Intl.DisplayNames(['pt-BR'], { type: 'region' })

  /** Código do país (Cloudflare) por extenso; XX é "não sei". */
  function country(code: string | null): string | null {
    if (!code || code === 'XX') return null
    if (code === 'T1') return 'Rede Tor'
    try {
      return regions.of(code.toUpperCase()) ?? code
    } catch {
      return code
    }
  }

  const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
  const midnight = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

  /** Quando foi usado: o servidor só anota de hora em hora, então nada de minutos. */
  function lastSeen(session: SessionInfo): string {
    if (session.current) return 'agora'
    const now = client.now
    if (now - session.lastSeenAt < HOUR) return 'na última hora'
    const days = Math.round((midnight(now) - midnight(session.lastSeenAt)) / DAY)
    if (days === 0) return relative.format(-Math.round((now - session.lastSeenAt) / HOUR), 'hour')
    return relative.format(-days, 'day')
  }

  function where(session: SessionInfo): string {
    const text = [country(session.country), lastSeen(session)].filter(Boolean).join(' · ')
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  async function revoke(session: SessionInfo) {
    const api = client.api
    if (!api || busy) return
    busy = session.id
    try {
      await api.revokeSession(session.id)
      sessions = sessions?.filter((s) => s.id !== session.id) ?? null
    } catch (err) {
      // "Esse aparelho já saiu.": a lista de novo resolve.
      client.toast((err as Error).message)
      await load()
    } finally {
      busy = null
    }
  }

  function revokeOthers() {
    const api = client.api
    if (!api) return
    confirmAction({
      title: 'Sair dos outros aparelhos?',
      description: 'Só este continua conectado.',
      confirm: 'Sair',
      onconfirm: async () => {
        busy = 'others'
        try {
          const { revoked } = await api.revokeOtherSessions()
          client.toast(`${plural(revoked, 'aparelho saiu', 'aparelhos saíram')}.`, 'info')
        } catch (err) {
          client.toast((err as Error).message)
        } finally {
          busy = null
          await load()
        }
      },
    })
  }
</script>

<PageHeader title="Aparelhos" description="Onde sua conta está conectada. Aparelho parado por 30 dias sai sozinho." />

{#if sessions}
  <Section>
    {#each ordered as session (session.id)}
      <Row label={session.device} description={where(session)}>
        {#snippet leading()}<span class="device"><Icon name={deviceIcon(session.device)} size={18} /></span>{/snippet}
        {#if session.current}
          <Badge tone="success">Este aparelho</Badge>
        {:else}
          <Button size="sm" loading={busy === session.id} disabled={!!busy} onclick={() => revoke(session)}>Sair</Button>
        {/if}
      </Row>
    {/each}
  </Section>

  <Section>
    <Row
      label="Sair de todos os outros"
      description={others ? 'Só este aparelho continua conectado.' : 'Nenhum outro aparelho conectado.'}
    >
      <Button variant="danger-soft" icon="log-out" loading={busy === 'others'} disabled={!others || !!busy} onclick={revokeOthers}>
        Sair dos outros
      </Button>
    </Row>
  </Section>
{:else if loadError}
  <Section>
    <Row label="Não deu pra carregar os aparelhos." description={loadError}>
      <Button icon="restart" onclick={load}>Tentar de novo</Button>
    </Row>
  </Section>
{:else}
  <div class="loading" role="status" aria-label="Carregando"><Spinner size={20} /></div>
{/if}

<style>
  .device {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.06);
    color: var(--fg-2);
  }

  /* Só aparece se a espera passar de ~300 ms. */
  .loading {
    display: grid;
    place-items: center;
    height: 120px;
    color: var(--fg-3);
    animation: rs-fade-in var(--t) var(--ease) 300ms both;
  }
</style>
