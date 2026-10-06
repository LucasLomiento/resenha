<script lang="ts">
  import { client } from '../../lib/client.svelte'
  import { confirmAction, ui, type SettingsPage } from '../../lib/ui.svelte'
  import { SettingsLayout, type SettingsNavEntry } from '../kit'
  import AppPage from './AppPage.svelte'
  import DevicesPage from './DevicesPage.svelte'
  import NotificationsPage from './NotificationsPage.svelte'
  import PasswordPage from './PasswordPage.svelte'
  import PlatformPage from './PlatformPage.svelte'
  import PrivacyPage from './PrivacyPage.svelte'
  import ProfilePage from './ProfilePage.svelte'
  import ShortcutsPage from './ShortcutsPage.svelte'
  import VoicePage from './VoicePage.svelte'

  const ADMIN: SettingsNavEntry[] = [{ heading: 'Administração' }, { id: 'platform', label: 'Plataforma', icon: 'shield' }]

  // Conta em cima, app embaixo; o painel da plataforma só pro dono dela.
  const nav = $derived<SettingsNavEntry[]>([
    { heading: 'Conta' },
    { id: 'profile', label: 'Perfil', icon: 'user' },
    { id: 'devices', label: 'Aparelhos', icon: 'laptop' },
    { id: 'password', label: 'Senha', icon: 'key' },
    { id: 'privacy', label: 'Privacidade', icon: 'lock' },
    { heading: 'App' },
    { id: 'voice', label: 'Voz e vídeo', icon: 'mic' },
    { id: 'notifications', label: 'Notificações', icon: 'bell' },
    { id: 'shortcuts', label: 'Atalhos', icon: 'keyboard' },
    { id: 'app', label: 'Aplicativo', icon: 'sliders' },
    ...(client.me?.staff ? ADMIN : []),
    { separator: true },
    { id: 'logout', label: 'Sair da conta', icon: 'log-out', tone: 'danger' },
  ])

  /** Página aberta: valor desconhecido (ou a plataforma sem ser dono) cai no Perfil. */
  const page = $derived.by<SettingsPage>(() => {
    const id = ui.settings
    return id && nav.some((entry) => 'id' in entry && entry.id === id) ? id : 'profile'
  })

  function close() {
    // Gravando um atalho, o Esc cancela a gravação (e não fecha a tela).
    if (ui.recordingShortcut) ui.recordingShortcut = false
    else ui.settings = null
  }

  function select(id: string) {
    if (id !== 'logout') return (ui.settings = id as SettingsPage)
    confirmAction({ title: 'Sair da conta?', confirm: 'Sair', onconfirm: () => client.logout() })
  }
</script>

<SettingsLayout title="Configurações" {nav} active={page} onselect={select} onclose={close}>
  {#if page === 'profile'}
    <ProfilePage />
  {:else if page === 'devices'}
    <DevicesPage />
  {:else if page === 'password'}
    <PasswordPage />
  {:else if page === 'privacy'}
    <PrivacyPage />
  {:else if page === 'voice'}
    <VoicePage />
  {:else if page === 'notifications'}
    <NotificationsPage />
  {:else if page === 'shortcuts'}
    <ShortcutsPage />
  {:else if page === 'app'}
    <AppPage />
  {:else if page === 'platform'}
    <PlatformPage />
  {/if}
</SettingsLayout>
