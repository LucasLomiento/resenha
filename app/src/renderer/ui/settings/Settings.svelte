<script lang="ts">
  import { ui, type SettingsPage } from '../../lib/ui.svelte'
  import { SettingsLayout, type SettingsNavEntry } from '../kit'
  import AccountPage from './AccountPage.svelte'
  import AppPage from './AppPage.svelte'
  import GroupPage from './GroupPage.svelte'
  import NotificationsPage from './NotificationsPage.svelte'
  import ShortcutsPage from './ShortcutsPage.svelte'
  import VoicePage from './VoicePage.svelte'

  const nav: SettingsNavEntry[] = [
    { id: 'account', label: 'Minha conta', icon: 'user' },
    { id: 'voice', label: 'Voz e vídeo', icon: 'mic' },
    { id: 'notifications', label: 'Notificações', icon: 'bell' },
    { id: 'shortcuts', label: 'Atalhos', icon: 'keyboard' },
    { id: 'app', label: 'Aplicativo', icon: 'sliders' },
    { separator: true },
    { id: 'group', label: 'Grupo', icon: 'users' },
  ]

  function close() {
    // Gravando um atalho, o Esc cancela a gravação (e não fecha a tela).
    if (ui.recordingShortcut) ui.recordingShortcut = false
    else ui.settings = null
  }
</script>

<SettingsLayout
  title="Configurações"
  {nav}
  active={ui.settings ?? 'voice'}
  onselect={(id) => (ui.settings = id as SettingsPage)}
  onclose={close}
>
  {#if ui.settings === 'account'}
    <AccountPage />
  {:else if ui.settings === 'voice'}
    <VoicePage />
  {:else if ui.settings === 'notifications'}
    <NotificationsPage />
  {:else if ui.settings === 'shortcuts'}
    <ShortcutsPage />
  {:else if ui.settings === 'app'}
    <AppPage />
  {:else if ui.settings === 'group'}
    <GroupPage />
  {/if}
</SettingsLayout>
