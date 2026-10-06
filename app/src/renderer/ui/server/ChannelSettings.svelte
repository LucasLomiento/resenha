<script lang="ts">
  import { P } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { confirmAction, ui } from '../../lib/ui.svelte'
  import { SettingsLayout, type SettingsNavEntry } from '../kit'
  import ChannelOverview from './channel/ChannelOverview.svelte'
  import ChannelPermissions from './channel/ChannelPermissions.svelte'
  import { Unsaved } from './unsaved.svelte'

  const target = $derived(ui.channelSettings)
  const guild = $derived(target ? (client.guilds[target.guildId] ?? null) : null)
  const channel = $derived(target && guild ? guild.channel(target.channelId) : null)
  const unsaved = new Unsaved()

  // Editar o canal pede "gerenciar canais" nele; as exceções, também "gerenciar cargos" (no canal ou no servidor).
  const canEdit = $derived(!!guild && !!channel && guild.can(channel.id, P.MANAGE_CHANNELS))
  const canPermissions = $derived(
    !!guild && !!channel && canEdit && (guild.can(channel.id, P.MANAGE_ROLES) || guild.canGuild(P.MANAGE_ROLES)),
  )

  // Canal apagado, sem acesso ou sem permissão de editar: a tela fecha sozinha.
  $effect(() => {
    if (target && (!channel || !canEdit)) ui.channelSettings = null
  })

  let page = $state<'overview' | 'permissions'>('overview')
  const current = $derived(page === 'permissions' && canPermissions ? 'permissions' : 'overview')

  const nav = $derived<SettingsNavEntry[]>([
    { heading: channel ? (channel.kind === 'text' ? `#${channel.name}` : channel.name) : '' },
    { id: 'overview', label: 'Visão geral', icon: 'settings' },
    ...(canPermissions ? [{ id: 'permissions', label: 'Permissões', icon: 'shield' as const }] : []),
    { separator: true },
    { id: 'delete', label: channel?.kind === 'category' ? 'Apagar categoria' : 'Apagar canal', icon: 'trash', tone: 'danger' },
  ])

  function select(id: string) {
    if (id === 'delete') return remove()
    if (id === current || unsaved.blocked()) return
    page = id as 'overview' | 'permissions'
  }

  function close() {
    if (!unsaved.blocked()) ui.channelSettings = null
  }

  function remove() {
    if (!guild || !channel) return
    const owner = guild
    const { id, name, kind } = channel
    confirmAction({
      title: kind === 'category' ? `Apagar a categoria ${name}?` : `Apagar ${kind === 'text' ? '#' : ''}${name}?`,
      description:
        kind === 'category'
          ? 'Os canais dela ficam soltos, fora de categoria.'
          : kind === 'voice'
            ? 'Quem estiver na call sai dela.'
            : 'As mensagens somem pra todo mundo. Não dá pra desfazer.',
      confirm: 'Apagar',
      // Se der certo, o canal some e esta tela fecha; se não (último canal de texto), o servidor avisa.
      onconfirm: () => owner.deleteChannel(id),
    })
  }
</script>

{#if guild && channel}
  <SettingsLayout title="Configurações do canal" {nav} active={current} onselect={select} onclose={close}>
    {#key channel.id}
      {#if current === 'permissions'}
        <ChannelPermissions {guild} {channel} {unsaved} />
      {:else}
        <ChannelOverview {guild} {channel} {unsaved} />
      {/if}
    {/key}
  </SettingsLayout>
{/if}
