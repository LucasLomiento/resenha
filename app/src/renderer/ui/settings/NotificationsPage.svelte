<script lang="ts">
  import { m } from '../../lib/i18n.svelte'
  import { settings } from '../../lib/settings.svelte'
  import { SOUND_LABELS, playSound } from '../../lib/sounds'
  import { Button, IconButton, PageHeader, Row, Section, Slider, Switch } from '../kit'

  const t = $derived(m.settings.notifications)
</script>

<PageHeader title={m.settings.pages.notifications} />

<Section title={t.sounds.section}>
  <Row label={t.sounds.app} setting="notify.sounds" for="notify-sounds" description={t.sounds.appDescription}>
    <Switch id="notify-sounds" bind:checked={settings.sounds} />
  </Row>
  <Row label={t.sounds.volume} setting="notify.volume" indent disabled={!settings.sounds}>
    <div class="volume">
      <Slider label={t.sounds.volumeLabel} min={0} max={1} step={0.05} bind:value={settings.soundVolume} disabled={!settings.sounds} />
      <IconButton icon="play" label={t.sounds.listen} size="sm" disabled={!settings.sounds} onclick={() => playSound('self-join')} />
    </div>
  </Row>
  <Row label={t.sounds.message} setting="notify.message" for="notify-message" indent disabled={!settings.sounds}>
    <Switch id="notify-message" bind:checked={settings.messageSound} disabled={!settings.sounds} />
  </Row>
  <Row label={t.sounds.each} setting="notify.preview" stack disabled={!settings.sounds}>
    <div class="sounds">
      {#each SOUND_LABELS as [name, label] (name)}
        <Button size="sm" variant="secondary" icon="play" disabled={!settings.sounds} onclick={() => playSound(name, true)}>{label}</Button>
      {/each}
    </div>
  </Row>
</Section>

<Section title={t.system.section}>
  <Row label={t.system.content} setting="notify.content" for="notify-content" description={t.system.contentDescription}>
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
