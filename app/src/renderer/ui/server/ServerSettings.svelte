<script lang="ts">
  import { P } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { m } from '../../lib/i18n.svelte'
  import { ui, type GuildSettingsPage } from '../../lib/ui.svelte'
  import { SettingsLayout, type IconName, type SettingsNavEntry } from '../kit'
  import AuditPage from './settings/AuditPage.svelte'
  import BansPage from './settings/BansPage.svelte'
  import InvitesPage from './settings/InvitesPage.svelte'
  import MembersPage from './settings/MembersPage.svelte'
  import OverviewPage from './settings/OverviewPage.svelte'
  import RolesPage from './settings/RolesPage.svelte'
  import { Unsaved } from './unsaved.svelte'

  const target = $derived(ui.guildSettings)
  const guild = $derived(target ? (client.guilds[target.guildId] ?? null) : null)
  const unsaved = new Unsaved()

  // Saiu do servidor (ou foi expulso, ou ele foi excluído): a tela fecha sozinha.
  $effect(() => {
    if (target && !guild) ui.guildSettings = null
  })

  // O nome de cada página vem do catálogo (m.server.settings.pages), lido na hora de montar o menu.
  const PAGES: { id: GuildSettingsPage; icon: IconName; bits: number[] }[] = [
    { id: 'overview', icon: 'settings', bits: [] },
    { id: 'roles', icon: 'shield', bits: [P.MANAGE_ROLES] },
    {
      id: 'members',
      icon: 'users',
      bits: [P.MANAGE_ROLES, P.MANAGE_NICKNAMES, P.MODERATE_MEMBERS, P.KICK_MEMBERS, P.BAN_MEMBERS],
    },
    { id: 'invites', icon: 'link', bits: [P.MANAGE_GUILD] },
    { id: 'bans', icon: 'ban', bits: [P.BAN_MEMBERS] },
    { id: 'audit', icon: 'scroll', bits: [P.VIEW_AUDIT_LOG] },
  ]

  /** Só as páginas que a pessoa consegue usar. */
  const pages = $derived(guild ? PAGES.filter((p) => !p.bits.length || p.bits.some((bit) => guild.canGuild(bit))) : [])
  const page = $derived<GuildSettingsPage>(pages.some((p) => p.id === target?.page) ? target!.page : 'overview')

  const nav = $derived<SettingsNavEntry[]>([
    { heading: guild?.info.name ?? '' },
    ...pages.map((p) => ({ id: p.id, label: m.server.settings.pages[p.id], icon: p.icon })),
  ])

  function select(id: string) {
    if (!target || id === page || unsaved.blocked()) return
    ui.guildSettings = { guildId: target.guildId, page: id as GuildSettingsPage }
  }

  function close() {
    if (!unsaved.blocked()) ui.guildSettings = null
  }
</script>

{#if guild}
  <SettingsLayout title={m.server.settings.title} {nav} active={page} onselect={select} onclose={close}>
    {#if page === 'roles'}
      <RolesPage {guild} {unsaved} />
    {:else if page === 'members'}
      <MembersPage {guild} />
    {:else if page === 'invites'}
      <InvitesPage {guild} />
    {:else if page === 'bans'}
      <BansPage {guild} />
    {:else if page === 'audit'}
      <AuditPage {guild} />
    {:else}
      <OverviewPage {guild} {unsaved} />
    {/if}
  </SettingsLayout>
{/if}
