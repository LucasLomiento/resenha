<script lang="ts">
  import { onMount } from 'svelte'
  import { client } from '../../lib/client.svelte'
  import { m } from '../../lib/i18n.svelte'
  import { settings } from '../../lib/settings.svelte'
  import { SOUND_LABELS, playSound } from '../../lib/sounds'
  import { Button, IconButton, PageHeader, Row, Section, Slider, Switch } from '../kit'

  const t = $derived(m.settings.notifications)

  // Celular com push: se o Android deixa avisar, e o aviso de teste (pra descobrir onde trava).
  const push = window.resenha.push
  let permission = $state<'granted' | 'denied' | 'prompt' | null>(null)
  let registered = $state(false)
  onMount(() => {
    void push?.permission().then((value) => (permission = value))
    void push?.token().then((token) => (registered = !!token))
  })
  const phoneState = $derived(permission === 'denied' ? t.phone.denied : registered ? t.phone.on : permission ? t.phone.unavailable : null)

  /** A resposta do aviso de teste não veio (a conexão caiu no meio): o botão volta a funcionar. */
  let noAnswer = $state(false)
  $effect(() => {
    noAnswer = false
    if (client.pushTest !== 'waiting') return
    const timer = setTimeout(() => (noAnswer = true), 20_000)
    return () => clearTimeout(timer)
  })
</script>

<PageHeader title={m.settings.pages.notifications} />

{#if push}
  <Section title={t.phone.section}>
    <Row label={t.phone.label} description={phoneState ?? undefined} stack>
      <div class="test">
        <Button icon="bell" disabled={permission === 'denied' || (client.pushTest === 'waiting' && !noAnswer)} onclick={() => client.testPush()}>{t.phone.test}</Button>
        {#if client.pushTest}<p class="test-result" role="status">{noAnswer ? t.phone.noAnswer : t.phone.results[client.pushTest]}</p>{/if}
      </div>
    </Row>
  </Section>
{/if}

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
  .test {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .test-result {
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

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
