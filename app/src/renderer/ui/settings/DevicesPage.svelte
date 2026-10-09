<script lang="ts">
  import { onMount } from 'svelte'
  import type { SessionInfo } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { fmt, m } from '../../lib/i18n.svelte'
  import { confirmAction } from '../../lib/ui.svelte'
  import { Badge, Button, Icon, PageHeader, Row, Section, Spinner, type IconName } from '../kit'

  const HOUR = 3_600_000
  const DAY = 24 * HOUR

  const t = $derived(m.settings.devices)

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
  /** O nome vem do servidor em português ("App no Linux", "Aparelho"): traduz os conhecidos. */
  function deviceLabel(device: string): string {
    const os = (name: string) => (name === 'Aparelho' ? t.unknownDevice : name)
    const app = /^App no (.+)$/.exec(device)
    if (app) return t.appOn(os(app[1]))
    if (device === 'App Resenha') return t.resenhaApp
    return os(device)
  }

  function deviceIcon(device: string): IconName {
    if (/android|iphone|ipad|ios|celular|phone|mobile/i.test(device)) return 'smartphone'
    if (/mac/i.test(device)) return 'laptop'
    if (/windows|linux|\bapp\b|resenha/i.test(device)) return 'monitor'
    return 'globe'
  }

  /** Código do país (Cloudflare) por extenso; XX é "não sei". */
  function country(code: string | null): string | null {
    if (!code || code === 'XX') return null
    if (code === 'T1') return t.tor
    try {
      return fmt.region(code.toUpperCase())
    } catch {
      return code
    }
  }

  const midnight = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

  /** Quando foi usado: o servidor só anota de hora em hora, então nada de minutos. */
  function lastSeen(session: SessionInfo): string {
    if (session.current) return t.now
    const now = client.now
    if (now - session.lastSeenAt < HOUR) return t.lastHour
    const days = Math.round((midnight(now) - midnight(session.lastSeenAt)) / DAY)
    if (days === 0) return fmt.relative(-Math.round((now - session.lastSeenAt) / HOUR), 'hour')
    return fmt.relative(-days, 'day')
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
      title: t.others.title,
      description: t.others.description,
      confirm: t.others.confirm,
      onconfirm: async () => {
        busy = 'others'
        try {
          const { revoked } = await api.revokeOtherSessions()
          client.toast(t.others.done(revoked), 'info')
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

<PageHeader title={m.settings.pages.devices} description={t.description} />

{#if sessions}
  <Section setting="devices.list">
    {#each ordered as session (session.id)}
      <Row label={deviceLabel(session.device)} description={where(session)}>
        {#snippet leading()}<span class="device"><Icon name={deviceIcon(session.device)} size={18} /></span>{/snippet}
        {#if session.current}
          <Badge tone="success">{t.current}</Badge>
        {:else}
          <Button size="sm" loading={busy === session.id} disabled={!!busy} onclick={() => revoke(session)}>{t.signOut}</Button>
        {/if}
      </Row>
    {/each}
  </Section>

  <Section>
    <Row
      setting="devices.others"
      label={t.others.label}
      description={others ? t.others.some : t.others.none}
    >
      <Button variant="danger-soft" icon="log-out" loading={busy === 'others'} disabled={!others || !!busy} onclick={revokeOthers}>
        {t.others.button}
      </Button>
    </Row>
  </Section>
{:else if loadError}
  <Section>
    <Row label={t.loadError} description={loadError}>
      <Button icon="restart" onclick={load}>{m.common.retry}</Button>
    </Row>
  </Section>
{:else}
  <div class="loading" role="status" aria-label={m.common.loading}><Spinner size={20} /></div>
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
