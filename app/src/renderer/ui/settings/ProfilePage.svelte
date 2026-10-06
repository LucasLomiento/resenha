<script lang="ts">
  import { untrack } from 'svelte'
  import type { Me } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { userGradient } from '../../lib/format'
  import { squareImage } from '../../lib/image'
  import { Avatar, Button, Icon, PageHeader, Row, Section, TextField, tooltip } from '../kit'
  import ProfilePreview from './ProfilePreview.svelte'

  interface Draft {
    name: string
    bio: string
    accent: number | null
  }

  const BIO_MAX = 190
  /** Cores do perfil (as mesmas famílias dos degradês dos avatares); null = automática. */
  const SWATCHES: { color: number | null; name: string }[] = [
    { color: 0x7c6cff, name: 'Violeta' },
    { color: 0xff7a93, name: 'Coral' },
    { color: 0x48b9ff, name: 'Oceano' },
    { color: 0x36d6ad, name: 'Menta' },
    { color: 0xffc35a, name: 'Sol' },
    { color: 0xee78dc, name: 'Orquídea' },
    { color: 0x9edc66, name: 'Lima' },
    { color: null, name: 'Automática' },
  ]

  const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`
  const pick = (me: Me | null): Draft => ({ name: me?.name ?? '', bio: me?.bio ?? '', accent: me?.accent ?? null })
  const same = (a: Draft, b: Draft) => a.name === b.name && a.bio === b.bio && a.accent === b.accent

  const me = $derived(client.me)
  const avatar = $derived(client.api?.media(me?.avatar ?? null) ?? null)

  /** O que está salvo. */
  let base = $state<Draft>(pick(client.me))
  /** O que está no formulário. */
  let draft = $state<Draft>(pick(client.me))
  let saving = $state(false)

  const dirty = $derived(!same(draft, base))
  const nameError = $derived(draft.name.trim() ? null : 'O nome não pode ficar vazio.')
  // Cor que veio de outro lugar e não está nas amostras: aparece como a primeira.
  const swatches = $derived(
    base.accent !== null && !SWATCHES.some((s) => s.color === base.accent) ? [{ color: base.accent, name: 'Cor atual' }, ...SWATCHES] : SWATCHES,
  )

  // Perfil mudou (salvo aqui ou em outro aparelho): sem nada pendente, o formulário acompanha.
  $effect(() => {
    const next = pick(client.me)
    untrack(() => {
      if (!dirty) draft = { ...next }
      base = next
    })
  })

  async function save(event?: SubmitEvent) {
    event?.preventDefault()
    const api = client.api
    if (!api || !dirty || nameError || saving) return
    const sent = $state.snapshot(draft)
    const patch: Partial<Draft> = {}
    if (sent.name !== base.name) patch.name = sent.name.trim()
    if (sent.bio !== base.bio) patch.bio = sent.bio.trim()
    if (sent.accent !== base.accent) patch.accent = sent.accent
    saving = true
    try {
      const saved = pick(await api.updateMe(patch))
      base = saved
      // O servidor arruma espaços: o formulário mostra o que ficou (se ninguém mexeu enquanto salvava).
      if (same(draft, sent)) draft = { ...saved }
    } catch (err) {
      client.toast((err as Error).message)
    } finally {
      saving = false
    }
  }

  // ---------- Foto ----------

  let photoInput = $state<HTMLInputElement>()
  let photoBusy = $state<'upload' | 'remove' | null>(null)
  let photoError = $state<string | null>(null)

  async function photo(task: 'upload' | 'remove', run: () => Promise<unknown>) {
    photoBusy = task
    photoError = null
    try {
      await run()
    } catch (err) {
      photoError = (err as Error).message
    } finally {
      photoBusy = null
    }
  }

  function changePhoto(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0]
    // Limpa pra poder escolher o mesmo arquivo de novo.
    event.currentTarget.value = ''
    const api = client.api
    // Quadrada, 256 px, WebP: cabe folgado nos 512 KB do servidor.
    if (file && api) photo('upload', async () => api.setAvatar(await squareImage(file, 256)))
  }

  function removePhoto() {
    const api = client.api
    if (api) photo('remove', () => api.clearAvatar())
  }
</script>

<PageHeader title="Perfil" />

{#if me}
  <div class="profile-box">
    <form class="profile" onsubmit={save}>
      <div class="form">
        <Section>
          <Row stack label="Foto">
            <div class="photo">
              <Avatar id={me.id} name={draft.name || me.username} size={72} src={avatar} cutout="var(--bg-raised)" />
              <div class="photo-side">
                <div class="photo-actions">
                  <Button
                    size="sm"
                    icon="upload"
                    loading={photoBusy === 'upload'}
                    disabled={!!photoBusy}
                    onclick={() => photoInput?.click()}>Trocar foto</Button
                  >
                  {#if me.avatar}
                    <Button size="sm" variant="ghost" loading={photoBusy === 'remove'} disabled={!!photoBusy} onclick={removePhoto}>Remover</Button>
                  {/if}
                </div>
                {#if photoError}
                  <p class="error" role="alert"><Icon name="circle-alert" size={14} />{photoError}</p>
                {/if}
              </div>
              <input bind:this={photoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onchange={changePhoto} />
            </div>
          </Row>
          <Row stack>
            <TextField label="Nome de exibição" bind:value={draft.name} maxlength={32} hint="Como aparece nas conversas." error={nameError} />
          </Row>
          <Row stack>
            <TextField label="Nome de usuário" icon="at" value={me.username} mono readonly hint="Único. É como te acham pra adicionar como amigo." />
          </Row>
          <Row stack>
            <label class="bio">
              <span class="bio-label">Sobre mim</span>
              <textarea rows="3" maxlength={BIO_MAX} bind:value={draft.bio}></textarea>
              <small class="tabular" class:near={draft.bio.length >= BIO_MAX - 10} aria-hidden="true">{draft.bio.length}/{BIO_MAX}</small>
            </label>
          </Row>
          <Row stack label="Cor do perfil">
            <div class="swatches" role="radiogroup" aria-label="Cor do perfil">
              {#each swatches as swatch (swatch.color ?? 'auto')}
                {@const on = draft.accent === swatch.color}
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={swatch.name}
                  class="swatch"
                  class:on
                  style:background={swatch.color === null ? userGradient(me.id) : hex(swatch.color)}
                  use:tooltip={swatch.name}
                  onclick={() => (draft.accent = swatch.color)}
                >
                  {#if on}<Icon name="check" size={14} stroke={2.25} />{/if}
                </button>
              {/each}
            </div>
          </Row>
        </Section>
      </div>

      <div class="preview">
        <span class="preview-label">Prévia</span>
        <ProfilePreview
          id={me.id}
          name={draft.name}
          username={me.username}
          bio={draft.bio}
          accent={draft.accent}
          {avatar}
          presence={client.presenceOf(me.id)}
          since={me.createdAt}
        />
      </div>
    </form>
  </div>

  {#if dirty}
    <div class="savebar" role="region" aria-label="Alterações não salvas">
      <span>Você tem alterações não salvas.</span>
      <Button variant="ghost" size="sm" disabled={saving} onclick={() => (draft = { ...base })}>Desfazer</Button>
      <Button variant="primary" size="sm" loading={saving} disabled={!!nameError} onclick={() => save()}>Salvar</Button>
    </div>
  {/if}
{/if}

<style>
  .profile-box {
    container-type: inline-size;
  }

  .profile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 24px;
    align-items: start;
  }

  /* Janela estreita: a prévia desce pra baixo do formulário. */
  @container (max-width: 620px) {
    .profile {
      grid-template-columns: minmax(0, 1fr);
    }

    .profile .preview {
      position: static;
    }
  }

  .photo {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .photo-side {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .photo-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--red);
    font-size: var(--text-xs);
  }

  .bio {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }

  .bio-label {
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .bio textarea {
    min-height: 84px;
    padding: 10px 12px 24px;
    border: 0;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--fg);
    line-height: 1.45;
    resize: none;
    outline: none;
    user-select: text;
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .bio textarea:hover {
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16);
  }

  .bio textarea:focus {
    box-shadow:
      inset 0 0 0 1px var(--accent-line),
      0 0 0 3px rgb(122 108 255 / 0.18);
  }

  .bio small {
    position: absolute;
    right: 10px;
    bottom: 8px;
    color: var(--fg-3);
    font-size: var(--text-2xs);
    pointer-events: none;
  }

  .bio small.near {
    color: var(--yellow);
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .swatch {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--r-md);
    color: var(--bg-canvas);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12);
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .swatch:hover:not(.on) {
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.12),
      0 0 0 2px var(--bg-raised),
      0 0 0 4px var(--line-strong);
  }

  .swatch.on {
    box-shadow:
      0 0 0 2px var(--bg-raised),
      0 0 0 4px var(--fg);
  }

  .preview {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .preview-label {
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .savebar {
    position: sticky;
    bottom: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
    padding: 10px 10px 10px 16px;
    border-radius: var(--r-xl);
    background: var(--bg-overlay);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    font-size: var(--text-sm);
    animation: rs-pop-in var(--t) var(--ease);
  }

  .savebar span {
    flex: 1;
    min-width: 0;
  }
</style>
