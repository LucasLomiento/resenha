<script lang="ts">
  import { settings } from '../../lib/settings.svelte'
  import { SOUND_LABELS, playSound } from '../../lib/sounds'
  import { Button, IconButton, PageHeader, Row, Section, Slider, Switch } from '../kit'
</script>

<PageHeader title="Notificações" />

<Section title="Sons">
  <Row label="Sons do app" setting="notify.sounds" for="notify-sounds" description="Entrar e sair da call, mutar e transmissões.">
    <Switch id="notify-sounds" bind:checked={settings.sounds} />
  </Row>
  <Row label="Volume" setting="notify.volume" indent disabled={!settings.sounds}>
    <div class="volume">
      <Slider label="Volume dos sons" min={0} max={1} step={0.05} bind:value={settings.soundVolume} disabled={!settings.sounds} />
      <IconButton icon="play" label="Ouvir" size="sm" disabled={!settings.sounds} onclick={() => playSound('self-join')} />
    </div>
  </Row>
  <Row label="Mensagem nova" setting="notify.message" for="notify-message" indent disabled={!settings.sounds}>
    <Switch id="notify-message" bind:checked={settings.messageSound} disabled={!settings.sounds} />
  </Row>
  <Row label="Ouvir cada som" setting="notify.preview" stack disabled={!settings.sounds}>
    <div class="sounds">
      {#each SOUND_LABELS as [name, label] (name)}
        <Button size="sm" variant="secondary" icon="play" disabled={!settings.sounds} onclick={() => playSound(name, true)}>{label}</Button>
      {/each}
    </div>
  </Row>
</Section>

<Section title="Avisos do sistema">
  <Row label="Mostrar o texto da mensagem" setting="notify.content" for="notify-content" description="Desligado, o aviso só diz que chegou mensagem.">
    <Switch id="notify-content" bind:checked={settings.notifyContent} />
  </Row>
</Section>

<style>
  .sounds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .volume {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 220px;
  }
</style>
