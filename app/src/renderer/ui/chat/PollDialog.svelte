<script lang="ts">
  import { tick } from 'svelte'
  import {
    MAX_POLL_OPTIONS,
    MAX_POLL_OPTION_LENGTH,
    MAX_POLL_QUESTION_LENGTH,
    MIN_POLL_OPTIONS,
    POLL_HOURS,
  } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { m } from '../../lib/i18n.svelte'
  import { Button, IconButton, Icon, Modal, Select, Switch, TextField } from '../kit'
  import type { ChatTarget } from './target.svelte'

  let { target, onclose, onsent }: { target: ChatTarget; onclose: () => void; onsent?: () => void } = $props()

  const uid = $props.id()
  const t = $derived(m.chat.poll)

  let question = $state('')
  let options = $state<string[]>(['', ''])
  let multiple = $state(false)
  /** O Select trabalha com texto; um dia é o prazo de quem não escolhe. */
  let hours = $state('24')
  let busy = $state(false)
  let list = $state<HTMLDivElement>()

  const clean = (text: string) => text.replace(/\s+/g, ' ').trim()
  const filled = $derived(options.map(clean).filter(Boolean))
  const repeated = $derived(new Set(filled.map((o) => o.toLowerCase())).size !== filled.length)
  const ready = $derived(clean(question).length > 0 && filled.length >= MIN_POLL_OPTIONS && !repeated)
  const durations = $derived(POLL_HOURS.map((h) => ({ value: String(h), label: t.durations[h] })))

  async function addOption() {
    if (options.length >= MAX_POLL_OPTIONS) return
    options.push('')
    await tick()
    list?.querySelector<HTMLInputElement>('.option:last-child input')?.focus()
  }

  /** Enter numa opção pula pra próxima (ou cria mais uma na última), em vez de enviar pela metade. */
  function optionKey(event: KeyboardEvent, index: number) {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    const inputs = list?.querySelectorAll<HTMLInputElement>('.option input')
    if (index < options.length - 1) inputs?.[index + 1]?.focus()
    else if (options[index].trim()) void addOption()
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!ready || busy) return
    busy = true
    try {
      await target.sendPoll(clean(question), { options: filled, multiple, hours: Number(hours) })
      onsent?.()
      onclose()
    } catch (err) {
      client.toast((err as Error).message || t.failed)
    } finally {
      busy = false
    }
  }
</script>

<Modal title={t.title} onclose={() => !busy && onclose()} dismissible={!busy}>
  <form id="{uid}-form" class="form" onsubmit={submit}>
    <TextField label={t.question} placeholder={t.questionPlaceholder} bind:value={question} maxlength={MAX_POLL_QUESTION_LENGTH} autocomplete="off" />

    <div class="group">
      <span class="group-label" id="{uid}-options">{t.options}</span>
      <div class="options" bind:this={list} role="group" aria-labelledby="{uid}-options">
        {#each options as _, i (i)}
          <div class="option">
            <TextField
              aria-label={t.option(i + 1)}
              placeholder={t.option(i + 1)}
              bind:value={options[i]}
              maxlength={MAX_POLL_OPTION_LENGTH}
              autocomplete="off"
              onkeydown={(e) => optionKey(e, i)}
            />
            {#if options.length > MIN_POLL_OPTIONS}
              <IconButton icon="x" label={t.removeOption(i + 1)} size="sm" onclick={() => options.splice(i, 1)} />
            {/if}
          </div>
        {/each}
      </div>
      {#if repeated}<p class="error" role="alert">{t.repeated}</p>{/if}
      {#if options.length < MAX_POLL_OPTIONS}
        <button type="button" class="add" onclick={addOption}><Icon name="plus" size={15} />{t.addOption}</button>
      {/if}
    </div>

    <label class="row" for="{uid}-multiple">
      <span class="row-text">
        <span class="row-label">{t.multiple}</span>
        <span class="row-hint">{t.multipleHint}</span>
      </span>
      <Switch id="{uid}-multiple" bind:checked={multiple} />
    </label>

    <div class="row">
      <span class="row-text"><span class="row-label" id="{uid}-duration">{t.duration}</span></span>
      <span class="duration"><Select bind:value={hours} options={durations} label={t.duration} /></span>
    </div>
  </form>

  {#snippet footer()}
    <Button variant="ghost" onclick={onclose} disabled={busy}>{m.common.cancel}</Button>
    <Button variant="primary" type="submit" form="{uid}-form" disabled={!ready} loading={busy}>{t.create}</Button>
  {/snippet}
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .group-label {
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 550;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .option :global(.field) {
    flex: 1;
    min-width: 0;
  }

  .add {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    height: var(--h-sm);
    padding: 0 10px 0 8px;
    border-radius: var(--r-full);
    color: var(--accent-fg);
    font-size: var(--text-sm);
    font-weight: 550;
    transition: background-color var(--t-fast) var(--ease);
  }

  .add:hover {
    background: var(--accent-soft);
  }

  .error {
    color: var(--red);
    font-size: var(--text-sm);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
    min-height: 40px;
  }

  .row-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .row-label {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 550;
  }

  .row-hint {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .duration {
    flex: none;
    width: 160px;
  }
</style>
