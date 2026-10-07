<script lang="ts" module>
  /** Telas dos protótipos: #proto/<id> (e #proto/<id>/clean sem o seletor, pra capturas). */
  export const SCREENS = [
    { id: 'server', label: 'Servidor: canal com membros', group: 'Servidor' },
    { id: 'server-reply', label: 'Responder e @mencionar', group: 'Servidor' },
    { id: 'profile', label: 'Cartão de perfil', group: 'Servidor' },
    { id: 'pins', label: 'Mensagens fixadas', group: 'Servidor' },
    { id: 'search', label: 'Busca', group: 'Servidor' },
    { id: 'switcher', label: 'Ctrl+K: ir para', group: 'Servidor' },
    { id: 'server-menu', label: 'Menu do servidor', group: 'Servidor' },
    { id: 'menus', label: 'Menus de mensagem e de membro', group: 'Servidor' },
    { id: 'status', label: 'Status', group: 'Servidor' },
    { id: 'home', label: 'Início: amigos', group: 'Início' },
    { id: 'home-pending', label: 'Pedidos de amizade', group: 'Início' },
    { id: 'home-add', label: 'Adicionar amigo', group: 'Início' },
    { id: 'dm', label: 'Mensagem privada', group: 'Início' },
    { id: 'create-server', label: 'Criar ou entrar', group: 'Início' },
    { id: 'create-server-form', label: 'Criar servidor', group: 'Início' },
    { id: 'join-server', label: 'Entrar com convite', group: 'Início' },
    { id: 'server-settings', label: 'Visão geral', group: 'Configurações do servidor' },
    { id: 'server-roles', label: 'Cargos e permissões', group: 'Configurações do servidor' },
    { id: 'server-members', label: 'Membros', group: 'Configurações do servidor' },
    { id: 'server-invites', label: 'Convites', group: 'Configurações do servidor' },
    { id: 'server-bans', label: 'Banimentos', group: 'Configurações do servidor' },
    { id: 'server-audit', label: 'Registro de auditoria', group: 'Configurações do servidor' },
    { id: 'account', label: 'Perfil', group: 'Conta' },
    { id: 'account-devices', label: 'Aparelhos', group: 'Conta' },
    { id: 'account-password', label: 'Senha', group: 'Conta' },
    { id: 'account-privacy', label: 'Privacidade', group: 'Conta' },
    { id: 'profile-style', label: 'Personalização do perfil', group: 'Conta' },
    { id: 'kit', label: 'Kit de componentes', group: 'Sistema' },
  ] as const

  export type ScreenId = (typeof SCREENS)[number]['id']
</script>

<script lang="ts">
  import { Icon, Menu, type MenuItem } from '../kit'
  import AccountSettings from './AccountSettings.svelte'
  import ChatPane from './ChatPane.svelte'
  import CreateServer from './CreateServer.svelte'
  import { dmMessages, messages, user } from './data'
  import FriendsPage from './FriendsPage.svelte'
  import HomeSidebar from './HomeSidebar.svelte'
  import KitGallery from './KitGallery.svelte'
  import MemberList from './MemberList.svelte'
  import PinsPopover from './PinsPopover.svelte'
  import ProfileStyleGallery from './ProfileStyleGallery.svelte'
  import ProfileCard from './ProfileCard.svelte'
  import ProtoFrame from './ProtoFrame.svelte'
  import QuickSwitcher from './QuickSwitcher.svelte'
  import SearchPanel from './SearchPanel.svelte'
  import ServerSettings from './ServerSettings.svelte'
  import ServerSidebar from './ServerSidebar.svelte'
  import StatusMenu from './StatusMenu.svelte'

  let { screen }: { screen: string } = $props()

  const parts = $derived(screen.split('/'))
  const id = $derived<ScreenId>((SCREENS.find((s) => s.id === parts[0])?.id ?? 'server') as ScreenId)
  const clean = $derived(parts.includes('clean'))
  const index = $derived(SCREENS.findIndex((s) => s.id === id))

  function go(next: string) {
    location.hash = `#proto/${next}`
  }

  function onkeydown(event: KeyboardEvent) {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    const step = event.key === 'ArrowRight' ? 1 : -1
    go(SCREENS[(index + step + SCREENS.length) % SCREENS.length].id)
  }

  let picker = $state(false)
  let pickerButton = $state<HTMLButtonElement>()
  const pickerItems = $derived<MenuItem[]>(
    SCREENS.flatMap((s, i) => [
      ...(i === 0 || SCREENS[i - 1].group !== s.group ? [{ kind: 'label' as const, label: s.group }] : []),
      { label: s.label, checked: s.id === id, onselect: () => go(s.id) },
    ]),
  )

  const serverMenu: MenuItem[] = [
    { label: 'Convidar pessoas', icon: 'user-plus' },
    { label: 'Configurações do servidor', icon: 'settings' },
    { label: 'Criar canal', icon: 'plus' },
    { label: 'Criar categoria', icon: 'compose' },
    { kind: 'separator' },
    { label: 'Notificações', icon: 'bell', hint: 'Só menções' },
    { label: 'Silenciar o servidor', icon: 'bell-off' },
    { kind: 'separator' },
    { label: 'Sair do servidor', icon: 'door-open', danger: true },
  ]
  const messageMenu: MenuItem[] = [
    { label: 'Reagir', icon: 'emoji-plus' },
    { label: 'Responder', icon: 'reply' },
    { label: 'Fixar', icon: 'pin' },
    { label: 'Copiar texto', icon: 'copy' },
    { label: 'Copiar link', icon: 'link' },
    { kind: 'separator' },
    { label: 'Apagar', icon: 'trash', danger: true },
  ]
  const memberMenu: MenuItem[] = [
    { label: 'Perfil', icon: 'user' },
    { label: 'Mensagem', icon: 'message' },
    { label: 'Cargos', icon: 'shield', hint: '2' },
    { kind: 'separator' },
    { kind: 'label', label: 'Na call' },
    { label: 'Mutar pra todos', icon: 'mic-off' },
    { label: 'Mover pra…', icon: 'move' },
    { label: 'Desconectar', icon: 'phone-off' },
    { kind: 'separator' },
    { label: 'Castigar…', icon: 'clock' },
    { label: 'Expulsar Thiago', icon: 'door-open', danger: true },
    { label: 'Banir Thiago', icon: 'hammer', danger: true },
  ]

  const settingsPage = {
    'server-settings': 'overview',
    'server-roles': 'roles',
    'server-members': 'members',
    'server-invites': 'invites',
    'server-bans': 'bans',
    'server-audit': 'audit',
  } as const
  const accountPage = {
    account: 'profile',
    'account-devices': 'devices',
    'account-password': 'password',
    'account-privacy': 'privacy',
  } as const
</script>

<svelte:window {onkeydown} />

<div class="proto">
  {#if id in settingsPage}
    {#key id}<ServerSettings page={settingsPage[id as keyof typeof settingsPage]} />{/key}
  {:else if id in accountPage}
    {#key id}<AccountSettings page={accountPage[id as keyof typeof accountPage]} />{/key}
  {:else if id === 'kit'}
    <KitGallery />
  {:else if id === 'profile-style'}
    <ProfileStyleGallery />
  {:else if id === 'home' || id === 'home-pending' || id === 'home-add' || id === 'create-server' || id === 'create-server-form' || id === 'join-server'}
    <ProtoFrame rail="home">
      {#snippet sidebar()}<HomeSidebar active="friends" />{/snippet}
      {#key id}
        <FriendsPage tab={id === 'home-pending' ? 'pending' : id === 'home-add' ? 'add' : 'online'} />
      {/key}
      {#snippet overlay()}
        {#if id === 'create-server'}<CreateServer step="choose" />
        {:else if id === 'create-server-form'}<CreateServer step="create" />
        {:else if id === 'join-server'}<CreateServer step="join" />{/if}
      {/snippet}
    </ProtoFrame>
  {:else if id === 'dm'}
    <ProtoFrame rail="home">
      {#snippet sidebar()}<HomeSidebar active="dm-bia" />{/snippet}
      <ChatPane kind="dm" title={user('u-bia').name} dmUser="u-bia" messages={dmMessages} placeholder="Mensagem para Bia" typing="Bia">
        {#snippet aside()}<ProfileCard userId="u-bia" flat actions={false} />{/snippet}
      </ChatPane>
    </ProtoFrame>
  {:else}
    <ProtoFrame rail="g-resenha">
      {#snippet sidebar()}<ServerSidebar active="c-geral" inCall menuOpen={id === 'server-menu'} />{/snippet}
      <ChatPane
        title="geral"
        topic="Bem-vindo! Aqui é o papo de sempre."
        {messages}
        placeholder="Mensagem em #geral"
        membersOpen={id !== 'search'}
        pinsOpen={id === 'pins'}
        searchQuery={id === 'search' ? 'ícone' : undefined}
        hovered={id === 'server' ? 'm5' : id === 'menus' ? 'm7' : undefined}
        replyTo={id === 'server-reply' ? 'Rafa' : undefined}
        mentionPicker={id === 'server-reply'}
        typing={id === 'server' ? 'Thiago' : undefined}
      >
        {#snippet aside()}
          {#if id === 'search'}<SearchPanel query="ícone" />{:else}<MemberList selected={id === 'profile' ? 'u-bia' : id === 'menus' ? 'u-thiago' : undefined} />{/if}
        {/snippet}
        {#snippet overlay()}
          {#if id === 'pins'}<PinsPopover />{/if}
        {/snippet}
      </ChatPane>

      {#snippet overlay()}
        {#if id === 'profile'}
          <div class="float" style:right="272px" style:top="76px"><ProfileCard userId="u-bia" /></div>
        {:else if id === 'switcher'}
          <QuickSwitcher />
        {:else if id === 'server-menu'}
          <div class="float" style:left="80px" style:top="62px"><Menu inline width={232} items={serverMenu} /></div>
        {:else if id === 'menus'}
          <div class="float" style:left="560px" style:top="300px"><Menu inline width={220} items={messageMenu} /></div>
          <div class="float" style:right="268px" style:top="220px"><Menu inline width={232} items={memberMenu} /></div>
        {:else if id === 'status'}
          <div class="float" style:left="80px" style:bottom="76px"><StatusMenu /></div>
        {/if}
      {/snippet}
    </ProtoFrame>
  {/if}

  {#if !clean}
    <button class="picker" bind:this={pickerButton} onclick={() => (picker = !picker)}>
      <Icon name="sparkles" size={14} />
      Protótipo · {SCREENS[index].label}
      <Icon name="chevron-down" size={14} />
    </button>
    {#if picker}
      <Menu items={pickerItems} anchor={pickerButton} placement="top" width={300} onclose={() => (picker = false)} />
    {/if}
  {/if}
</div>

<style>
  .proto {
    position: relative;
    height: 100%;
  }

  .float {
    position: absolute;
    z-index: 30;
  }

  .picker {
    position: fixed;
    left: 50%;
    bottom: 14px;
    z-index: 95;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 12px;
    border-radius: var(--r-full);
    background: rgb(26 26 34 / 0.92);
    backdrop-filter: blur(10px);
    box-shadow:
      0 0 0 1px var(--accent-line),
      var(--shadow-md);
    color: var(--fg-2);
    font-size: var(--text-xs);
    font-weight: 500;
    translate: -50% 0;
    opacity: 0.55;
    transition: opacity var(--t) var(--ease);
  }

  .picker:hover {
    opacity: 1;
    color: var(--fg);
  }

  .picker :global(svg:first-child) {
    color: var(--accent-fg);
  }
</style>
