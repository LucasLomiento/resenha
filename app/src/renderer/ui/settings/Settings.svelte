<script lang="ts">
  import { client } from '../../lib/client.svelte'
  import { confirmAction, ui, type SettingsPage } from '../../lib/ui.svelte'
  import { SettingsLayout, type SettingsNavEntry } from '../kit'
  import AppPage from './AppPage.svelte'
  import NotificationsPage from './NotificationsPage.svelte'
  import ShortcutsPage from './ShortcutsPage.svelte'
  import VoicePage from './VoicePage.svelte'

  const nav: SettingsNavEntry[] = [
    { id: 'voice', label: 'Voz e vídeo', icon: 'mic' },
    { id: 'notifications', label: 'Notificações', icon: 'bell' },
    { id: 'shortcuts', label: 'Atalhos', icon: 'keyboard' },
    { id: 'app', label: 'Aplicativo', icon: 'sliders' },
    { separator: true },
    { id: 'logout', label: 'Sair da conta', icon: 'log-out', tone: 'danger' },
  ]

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

<SettingsLayout title="Configurações" {nav} active={ui.settings ?? 'voice'} onselect={select} onclose={close}>
  {#if ui.settings === 'notifications'}
    <NotificationsPage />
  {:else if ui.settings === 'shortcuts'}
    <ShortcutsPage />
  {:else if ui.settings === 'app'}
    <AppPage />
  {:else}
    <VoicePage />
  {/if}
</SettingsLayout>
