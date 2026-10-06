<script lang="ts">
  import { ui } from '../../lib/ui.svelte'
  import { Popover } from '../kit'
  import ProfileBody from './ProfileBody.svelte'

  // Pode virar null no meio de um clique (o cartão fecha antes de abrir a conversa).
  const profile = $derived(ui.profile)

  function close() {
    ui.profile = null
  }
</script>

<!-- Cartão de perfil (popout): abre ao clicar no nome ou no avatar, em qualquer lugar. -->
{#if profile}
  {#key profile.userId}
    <Popover anchor={profile.anchor} placement="right-start" gap={12} width={320} label="Perfil" onclose={close} class="profile-pop">
      <ProfileBody userId={profile.userId} guildId={profile.guildId} onaction={close} />
    </Popover>
  {/key}
{/if}
