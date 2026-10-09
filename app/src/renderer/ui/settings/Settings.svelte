<script lang="ts">
  import { tick } from 'svelte'
  import { client } from '../../lib/client.svelte'
  import { i18n, m } from '../../lib/i18n.svelte'
  import { seesPlatform } from '../../lib/profile'
  import { searchSettings, type SettingEntry } from '../../lib/settings-search'
  import { confirmAction, openSetting, ui, type SettingsPage } from '../../lib/ui.svelte'
  import { Icon, SettingsLayout, type SettingsNavEntry } from '../kit'
  import AppPage from './AppPage.svelte'
  import DevicesPage from './DevicesPage.svelte'
  import NotificationsPage from './NotificationsPage.svelte'
  import PasswordPage from './PasswordPage.svelte'
  import PlatformPage from './PlatformPage.svelte'
  import PrivacyPage from './PrivacyPage.svelte'
  import ProfilePage from './ProfilePage.svelte'
  import ShortcutsPage from './ShortcutsPage.svelte'
  import VoicePage from './VoicePage.svelte'

  const t = $derived(m.settings)
  const admin = $derived<SettingsNavEntry[]>([{ heading: t.nav.admin }, { id: 'platform', label: t.pages.platform, icon: 'shield' }])

  // Conta em cima, app embaixo; o painel da plataforma só pro dono dela (e, só pra ver, pro melhor amigo dele).
  const nav = $derived<SettingsNavEntry[]>([
    { heading: t.nav.account },
    { id: 'profile', label: t.pages.profile, icon: 'user' },
    { id: 'devices', label: t.pages.devices, icon: 'laptop' },
    { id: 'password', label: t.pages.password, icon: 'key' },
    { id: 'privacy', label: t.pages.privacy, icon: 'lock' },
    { heading: t.nav.app },
    { id: 'voice', label: t.pages.voice, icon: 'mic' },
    { id: 'notifications', label: t.pages.notifications, icon: 'bell' },
    { id: 'shortcuts', label: t.pages.shortcuts, icon: 'keyboard' },
    { id: 'app', label: t.pages.app, icon: 'sliders' },
    ...(seesPlatform(client.me) ? admin : []),
    { separator: true },
    { id: 'logout', label: t.nav.logout, icon: 'log-out', tone: 'danger' },
  ])

  /** Página aberta: valor desconhecido (ou a plataforma sem ser dono) cai no Perfil. */
  const page = $derived.by<SettingsPage>(() => {
    const id = ui.settings
    return id && nav.some((entry) => 'id' in entry && entry.id === id) ? id : 'profile'
  })

  // ---------- Busca ----------

  let query = $state('')
  let picked = $state(0)
  let searchInput = $state<HTMLInputElement>()
  let resultList = $state<HTMLElement>()

  const results = $derived(
    query.trim()
      ? searchSettings(query, {
          staff: !!client.me?.staff,
          platform: seesPlatform(client.me),
          desktop: !!client.desktop,
          hyprland: !!client.platform?.hyprland,
          locale: i18n.locale,
        })
      : null,
  )
  const icons = $derived(Object.fromEntries(nav.filter((e) => 'id' in e).map((e) => [e.id, e.icon])))

  $effect(() => {
    void results
    picked = 0
  })

  function go(entry: SettingEntry | undefined) {
    if (!entry) return
    query = ''
    openSetting(entry)
  }

  function onSearchKey(event: KeyboardEvent) {
    if (!results) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      picked = (picked + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(results.length, 1)
      requestAnimationFrame(() => resultList?.querySelector('.result.on')?.scrollIntoView({ block: 'nearest' }))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      go(results[picked])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      query = ''
    }
  }

  // Chegou um destino (daqui ou do Ctrl+K): rola até a opção e faz ela piscar. Espera a
  // página aparecer (o "Avançado" abrir, os dados chegarem) por até 2 s.
  $effect(() => {
    const id = ui.settingsTarget
    if (!id) return
    let alive = true
    void (async () => {
      await tick()
      for (let i = 0; i < 40 && alive; i++) {
        await new Promise((r) => requestAnimationFrame(r))
        const target = document.querySelector<HTMLElement>(`.settings-content [data-setting="${CSS.escape(id)}"]`)
        if (target) {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' })
          target.classList.remove('setting-flash')
          void target.offsetWidth
          target.classList.add('setting-flash')
          setTimeout(() => target.classList.remove('setting-flash'), 2000)
          break
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      if (alive && ui.settingsTarget === id) ui.settingsTarget = null
    })()
    return () => {
      alive = false
    }
  })

  function close() {
    // Gravando um atalho, o Esc cancela a gravação (e não fecha a tela).
    if (ui.recordingShortcut) ui.recordingShortcut = false
    else ui.settings = null
  }

  function select(id: string) {
    if (id !== 'logout') return (ui.settings = id as SettingsPage)
    confirmAction({ title: t.logout.title, confirm: t.logout.confirm, onconfirm: () => client.logout() })
  }
</script>

<svelte:window
  onkeydown={(e) => {
    // Ctrl+F: busca nas configurações.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f' && !ui.recordingShortcut) {
      e.preventDefault()
      searchInput?.focus()
      searchInput?.select()
    }
  }}
/>

{#snippet search()}
  <label class="search">
    <Icon name="search" size={15} />
    <input
      bind:this={searchInput}
      bind:value={query}
      type="search"
      placeholder={t.search.placeholder}
      aria-label={t.search.label}
      autocomplete="off"
      spellcheck="false"
      data-own-escape={query ? '' : undefined}
      onkeydown={onSearchKey}
    />
  </label>
{/snippet}

{#snippet found()}
  <div class="results" bind:this={resultList} role="listbox" aria-label={t.search.results}>
    {#each results ?? [] as entry, i (entry.id)}
      <button
        class="result"
        class:on={i === picked}
        role="option"
        aria-selected={i === picked}
        onmouseenter={() => (picked = i)}
        onclick={() => go(entry)}
      >
        <Icon name={icons[entry.page] ?? 'settings'} size={16} />
        <span class="text">
          <span class="name">{entry.label}</span>
          <span class="where">{entry.where}</span>
        </span>
      </button>
    {:else}
      <p class="empty">{t.search.empty(query.trim())}</p>
    {/each}
  </div>
{/snippet}

<SettingsLayout title={t.title} {nav} active={page} onselect={select} onclose={close} {search} results={results ? found : undefined}>
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

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px;
    border-radius: var(--r-md);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--fg-3);
    cursor: text;
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .search:focus-within {
    box-shadow:
      inset 0 0 0 1px var(--accent-line),
      0 0 0 3px rgb(122 108 255 / 0.18);
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-sm);
  }

  .search input::-webkit-search-cancel-button {
    display: none;
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .result {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    color: var(--fg-3);
    text-align: left;
  }

  .result :global(svg) {
    flex: none;
    margin-top: 2px;
  }

  .result.on {
    background: var(--hover);
    color: var(--fg-2);
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .where {
    font-size: var(--text-xs);
  }

  .empty {
    padding: 8px 10px;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }
</style>
