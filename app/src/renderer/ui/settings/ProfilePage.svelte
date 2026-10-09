<script lang="ts">
  import { untrack } from 'svelte'
  import {
    DECORATIONS,
    EXCLUSIVE_DECORATIONS,
    MAX_PRONOUNS,
    NAME_FONTS,
    PROFILE_EFFECTS,
    type Decoration,
    type Me,
    type NameEffect,
    type NameFont,
    type ProfileEffect,
    type ProfileStyle,
    type ProfileStylePatch,
  } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { userGradient } from '../../lib/format'
  import { m } from '../../lib/i18n.svelte'
  import { avatarImages, bannerImage } from '../../lib/image'
  import { DECORATION_LABEL, EFFECT_LABEL, NAME_EFFECT_LABEL, NAME_FONT_LABEL, THEME_PRESETS, bannerFill, hex, profileColors } from '../../lib/profile'
  import { Avatar, Button, ColorPicker, Icon, PageHeader, Popover, Row, Section, Segmented, TextField, tooltip } from '../kit'
  import ProfileEffectView from '../profile/ProfileEffect.svelte'
  import ProfilePreview from './ProfilePreview.svelte'

  interface Draft {
    name: string
    bio: string
    accent: number | null
    pronouns: string
    theme: number[] | null
    decoration: Decoration | null
    effect: ProfileEffect | null
    nameFont: NameFont | null
    nameEffect: NameEffect | null
  }

  const BIO_MAX = 190
  const t = $derived(m.settings.profile)
  type SwatchName = keyof typeof t.color.swatches
  /** Cores do perfil (as mesmas famílias dos degradês dos avatares); null = automática. O nome vem do catálogo. */
  const SWATCHES: { color: number | null; name: SwatchName }[] = [
    { color: 0x7c6cff, name: 'violet' },
    { color: 0xff7a93, name: 'coral' },
    { color: 0x48b9ff, name: 'ocean' },
    { color: 0x36d6ad, name: 'mint' },
    { color: 0xffc35a, name: 'sun' },
    { color: 0xee78dc, name: 'orchid' },
    { color: 0x9edc66, name: 'lime' },
    { color: null, name: 'auto' },
  ]

  const pick = (me: Me | null): Draft => ({
    name: me?.name ?? '',
    bio: me?.bio ?? '',
    accent: me?.accent ?? null,
    pronouns: me?.style?.pronouns ?? '',
    theme: me?.style?.theme ? [...me.style.theme] : null,
    decoration: me?.style?.decoration ?? null,
    effect: me?.style?.effect ?? null,
    nameFont: me?.style?.nameFont ?? null,
    nameEffect: me?.style?.nameEffect ?? null,
  })
  const sameTheme = (a: number[] | null, b: number[] | null) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1])
  /** Campos da personalização (vão juntos em `style` no PATCH). */
  const STYLE_FIELDS = ['decoration', 'effect', 'nameFont', 'nameEffect'] as const
  const same = (a: Draft, b: Draft) =>
    a.name === b.name &&
    a.bio === b.bio &&
    a.accent === b.accent &&
    a.pronouns === b.pronouns &&
    sameTheme(a.theme, b.theme) &&
    STYLE_FIELDS.every((k) => a[k] === b[k])

  const me = $derived(client.me)
  const avatar = $derived(client.api?.media(me?.avatar ?? null) ?? null)
  const banner = $derived(client.api?.media(me?.style?.banner ?? null) ?? null)

  /** O que está salvo. */
  let base = $state<Draft>(pick(client.me))
  /** O que está no formulário. */
  let draft = $state<Draft>(pick(client.me))
  let saving = $state(false)

  const dirty = $derived(!same(draft, base))
  const nameError = $derived(draft.name.trim() ? null : t.nameEmpty)
  // Cor que veio de outro lugar e não está nas amostras: aparece como a primeira.
  const swatches = $derived(
    base.accent !== null && !SWATCHES.some((s) => s.color === base.accent) ? [{ color: base.accent, name: 'current' as const }, ...SWATCHES] : SWATCHES,
  )

  /** A personalização como ela vai ficar (o rascunho), pra prévia. */
  const previewStyle = $derived.by((): ProfileStyle => {
    const style: ProfileStyle = {}
    if (draft.pronouns.trim()) style.pronouns = draft.pronouns.trim()
    if (draft.theme) style.theme = draft.theme
    for (const key of STYLE_FIELDS) if (draft[key]) (style as Record<string, unknown>)[key] = draft[key]
    if (me?.style?.badge) style.badge = me.style.badge
    return style
  })
  const previewUser = $derived({ id: me?.id ?? '', accent: draft.accent, style: previewStyle })
  /** Selo (Fundador, Pioneiro): cada um vê a moldura e o efeito de nome que só ele usa. */
  const myBadge = $derived(me?.style?.badge ?? null)
  const decorations = $derived(DECORATIONS.filter((kind) => !EXCLUSIVE_DECORATIONS[kind] || EXCLUSIVE_DECORATIONS[kind] === myBadge))

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
    const patch: Parameters<typeof api.updateMe>[0] = {}
    if (sent.name !== base.name) patch.name = sent.name.trim()
    if (sent.bio !== base.bio) patch.bio = sent.bio.trim()
    if (sent.accent !== base.accent) patch.accent = sent.accent
    const style: ProfileStylePatch = {}
    if (sent.pronouns !== base.pronouns) style.pronouns = sent.pronouns.trim() || null
    if (!sameTheme(sent.theme, base.theme)) style.theme = sent.theme
    for (const key of STYLE_FIELDS) if (sent[key] !== base[key]) (style as Record<string, unknown>)[key] = sent[key]
    if (Object.keys(style).length) patch.style = style
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

  // ---------- Foto e banner (salvam na hora) ----------

  let photoInput = $state<HTMLInputElement>()
  let bannerInput = $state<HTMLInputElement>()
  let busy = $state<'photo' | 'photo-remove' | 'banner' | 'banner-remove' | null>(null)
  let photoError = $state<string | null>(null)
  let bannerError = $state<string | null>(null)

  async function run(task: NonNullable<typeof busy>, work: () => Promise<unknown>) {
    const banner = task.startsWith('banner')
    busy = task
    if (banner) bannerError = null
    else photoError = null
    try {
      await work()
    } catch (err) {
      if (banner) bannerError = (err as Error).message
      else photoError = (err as Error).message
    } finally {
      busy = null
    }
  }

  /** Pega o arquivo escolhido e limpa o campo (pra poder escolher o mesmo de novo). */
  function chosen(event: Event & { currentTarget: HTMLInputElement }): File | null {
    const file = event.currentTarget.files?.[0] ?? null
    event.currentTarget.value = ''
    return file
  }

  function changePhoto(event: Event & { currentTarget: HTMLInputElement }) {
    const file = chosen(event)
    const api = client.api
    // Parada: quadrada, 256 px, WebP. Animada: como está, com o primeiro quadro pras listas.
    if (file && api)
      run('photo', async () => {
        const { image, still } = await avatarImages(file)
        await api.setAvatar(image, still)
      })
  }

  function changeBanner(event: Event & { currentTarget: HTMLInputElement }) {
    const file = chosen(event)
    const api = client.api
    if (file && api) run('banner', async () => api.setBanner(await bannerImage(file)))
  }

  // ---------- Tema ----------

  let editing = $state<{ index: 0 | 1; anchor: HTMLElement } | null>(null)

  function setThemeColor(index: 0 | 1, color: number) {
    if (!draft.theme) return
    const next = [...draft.theme]
    next[index] = color
    draft.theme = next
  }

  // Amostras das molduras: o seu avatar de agora (parado; o hover anima a moldura).
  const still = $derived(me ? client.avatarOf(me.id) : null)
  let hovered = $state<string | null>(null)
</script>

<PageHeader title={m.settings.pages.profile} />

{#if me}
  <div class="profile-box">
    <form class="profile" onsubmit={save}>
      <div class="form">
        <Section>
          <Row stack label={t.photo.label} setting="profile.photo">
            <div class="photo">
              <Avatar id={me.id} name={draft.name || me.username} size={72} src={avatar} decoration={draft.decoration} play cutout="var(--bg-raised)" />
              <div class="side">
                <div class="actions">
                  <Button size="sm" icon="upload" loading={busy === 'photo'} disabled={!!busy} onclick={() => photoInput?.click()}>{t.photo.change}</Button>
                  {#if me.avatar}
                    <Button size="sm" variant="ghost" loading={busy === 'photo-remove'} disabled={!!busy} onclick={() => run('photo-remove', () => client.api!.clearAvatar())}
                      >{m.common.remove}</Button
                    >
                  {/if}
                </div>
                {#if photoError}
                  <p class="error" role="alert"><Icon name="circle-alert" size={14} />{photoError}</p>
                {:else}
                  <p class="hint">{t.photo.hint}</p>
                {/if}
              </div>
              <input bind:this={photoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onchange={changePhoto} />
            </div>
          </Row>
          <Row stack setting="profile.name">
            <TextField label={t.name.label} bind:value={draft.name} maxlength={32} hint={t.name.hint} error={nameError} />
          </Row>
          <Row stack setting="profile.pronouns">
            <TextField label={t.pronouns.label} bind:value={draft.pronouns} maxlength={MAX_PRONOUNS} placeholder={t.pronouns.placeholder} />
          </Row>
          <Row stack setting="profile.username">
            <TextField label={t.username.label} icon="at" value={me.username} mono readonly hint={t.username.hint} />
          </Row>
          <Row stack setting="profile.bio">
            <label class="bio">
              <span class="bio-label">{t.bio}</span>
              <textarea rows="3" maxlength={BIO_MAX} bind:value={draft.bio}></textarea>
              <small class="tabular" class:near={draft.bio.length >= BIO_MAX - 10} aria-hidden="true">{draft.bio.length}/{BIO_MAX}</small>
            </label>
          </Row>
        </Section>

        <Section title={t.customize}>
          <Row stack label={t.banner.label} setting="profile.banner">
            <div class="photo">
              <div class="banner-thumb" style:background={banner ? null : bannerFill(previewUser)}>
                {#if banner}<img src={banner} alt="" draggable="false" />{/if}
              </div>
              <div class="side">
                <div class="actions">
                  <Button size="sm" icon="upload" loading={busy === 'banner'} disabled={!!busy} onclick={() => bannerInput?.click()}>{t.banner.change}</Button>
                  {#if banner}
                    <Button size="sm" variant="ghost" loading={busy === 'banner-remove'} disabled={!!busy} onclick={() => run('banner-remove', () => client.api!.clearBanner())}
                      >{m.common.remove}</Button
                    >
                  {/if}
                </div>
                {#if bannerError}
                  <p class="error" role="alert"><Icon name="circle-alert" size={14} />{bannerError}</p>
                {:else}
                  <p class="hint">{t.banner.hint}</p>
                {/if}
              </div>
              <input bind:this={bannerInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onchange={changeBanner} />
            </div>
          </Row>

          <Row stack label={t.color.label} setting="profile.color">
            <div class="swatches" role="radiogroup" aria-label={t.color.label}>
              {#each swatches as swatch (swatch.color ?? 'auto')}
                {@const on = draft.accent === swatch.color}
                {@const name = t.color.swatches[swatch.name]}
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={name}
                  class="swatch"
                  class:on
                  style:background={swatch.color === null ? userGradient(me.id) : hex(swatch.color)}
                  use:tooltip={name}
                  onclick={() => (draft.accent = swatch.color)}
                >
                  {#if on}<Icon name="check" size={14} stroke={2.25} />{/if}
                </button>
              {/each}
            </div>
          </Row>

          <Row stack label={t.theme.label} setting="profile.theme">
            <div class="swatches" role="radiogroup" aria-label={t.theme.label}>
              <button
                type="button"
                role="radio"
                aria-checked={!draft.theme}
                aria-label={t.theme.none}
                class="swatch none"
                class:on={!draft.theme}
                use:tooltip={t.theme.none}
                onclick={() => (draft.theme = null)}
              >
                <Icon name="ban" size={14} />
              </button>
              {#each THEME_PRESETS as preset (preset.id)}
                {@const on = sameTheme(draft.theme, preset.colors)}
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={preset.name}
                  class="swatch"
                  class:on
                  style:background="linear-gradient(135deg, {hex(preset.colors[0])} 0 50%, {hex(preset.colors[1])} 50% 100%)"
                  use:tooltip={preset.name}
                  onclick={() => (draft.theme = [...preset.colors])}
                >
                  {#if on}<Icon name="check" size={14} stroke={2.25} />{/if}
                </button>
              {/each}
            </div>
            {#if draft.theme}
              <div class="theme-colors">
                {#each [t.theme.main, t.theme.accent] as label, i (i)}
                  {@const color = draft.theme[i]}
                  <button
                    type="button"
                    class="color-chip"
                    class:open={editing?.index === i}
                    aria-label={t.theme.chip(label, hex(color))}
                    onclick={(e) => (editing = editing?.index === i ? null : { index: i as 0 | 1, anchor: e.currentTarget })}
                  >
                    <span class="dot" style:background={hex(color)}></span>
                    <span class="chip-label">{label}</span>
                    <span class="chip-code">{hex(color).toUpperCase()}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </Row>

          <Row stack label={t.decoration.label} setting="profile.decoration">
            <div class="tiles" role="radiogroup" aria-label={t.decoration.label}>
              {#each [null, ...decorations] as kind (kind ?? 'none')}
                {@const on = draft.decoration === kind}
                {@const label = kind ? DECORATION_LABEL[kind] : t.decoration.none}
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={label}
                  class="tile"
                  class:on
                  onpointerenter={() => (hovered = `deco-${kind}`)}
                  onpointerleave={() => (hovered = null)}
                  onclick={() => (draft.decoration = kind)}
                >
                  <span class="tile-art">
                    <Avatar id={me.id} name={draft.name || me.username} size={40} src={still} decoration={kind} play={hovered === `deco-${kind}`} cutout="var(--tile-bg)" />
                  </span>
                  <span class="tile-label">{label}</span>
                </button>
              {/each}
            </div>
          </Row>

          <Row stack label={t.effect.label} setting="profile.effect">
            <div class="tiles" role="radiogroup" aria-label={t.effect.label}>
              {#each [null, ...PROFILE_EFFECTS] as kind (kind ?? 'none')}
                {@const on = draft.effect === kind}
                {@const label = kind ? EFFECT_LABEL[kind] : t.effect.none}
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={label}
                  class="tile"
                  class:on
                  onpointerenter={() => (hovered = `fx-${kind}`)}
                  onpointerleave={() => (hovered = null)}
                  onclick={() => (draft.effect = kind)}
                >
                  <span class="tile-art scene" style:--scene={profileColors(previewUser)[0]}>
                    {#if kind}
                      <ProfileEffectView {kind} colors={profileColors(previewUser)} paused={hovered !== `fx-${kind}`} />
                    {:else}
                      <Icon name="ban" size={16} />
                    {/if}
                  </span>
                  <span class="tile-label">{label}</span>
                </button>
              {/each}
            </div>
          </Row>

          <Row stack label={t.nameFont.label} setting="profile.nameFont">
            <div class="fonts" role="radiogroup" aria-label={t.nameFont.label}>
              {#each [null, ...NAME_FONTS] as font (font ?? 'default')}
                {@const on = draft.nameFont === font}
                <button type="button" role="radio" aria-checked={on} class="font" class:on onclick={() => (draft.nameFont = font)}>
                  <span class={font ? `name-font-${font}` : ''}>{font ? NAME_FONT_LABEL[font] : t.nameFont.none}</span>
                </button>
              {/each}
            </div>
          </Row>

          <Row stack label={t.nameEffect.label} setting="profile.nameEffect">
            <Segmented
              label={t.nameEffect.label}
              options={[
                { value: 'none', label: t.nameEffect.none },
                { value: 'gradient', label: NAME_EFFECT_LABEL.gradient },
                { value: 'neon', label: NAME_EFFECT_LABEL.neon },
                ...(myBadge === 'founder' ? [{ value: 'holo', label: NAME_EFFECT_LABEL.holo }] : []),
                ...(myBadge === 'pioneer' ? [{ value: 'horizon', label: NAME_EFFECT_LABEL.horizon }] : []),
              ]}
              value={draft.nameEffect ?? 'none'}
              onchange={(value) => (draft.nameEffect = value === 'none' ? null : (value as NameEffect))}
            />
          </Row>
        </Section>
      </div>

      <div class="preview">
        <span class="preview-label">{t.preview}</span>
        <ProfilePreview
          id={me.id}
          name={draft.name}
          username={me.username}
          bio={draft.bio}
          accent={draft.accent}
          {avatar}
          {banner}
          style={previewStyle}
          presence={client.presenceOf(me.id)}
          since={me.createdAt}
        />
      </div>
    </form>
  </div>

  {#if editing && draft.theme}
    {@const index = editing.index}
    {@const label = index ? t.theme.accentColor : t.theme.mainColor}
    <Popover anchor={editing.anchor} placement="bottom-start" width={232} {label} onclose={() => (editing = null)}>
      <ColorPicker {label} value={draft.theme[index]} onchange={(color) => setThemeColor(index, color)} />
    </Popover>
  {/if}

  {#if dirty}
    <div class="savebar" role="region" aria-label={t.unsaved.label}>
      <span>{t.unsaved.text}</span>
      <Button variant="ghost" size="sm" disabled={saving} onclick={() => (draft = { ...base })}>{m.common.undo}</Button>
      <Button variant="primary" size="sm" loading={saving} disabled={!!nameError} onclick={() => save()}>{m.common.save}</Button>
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

  .side {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .hint {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--red);
    font-size: var(--text-xs);
  }

  .banner-thumb {
    flex: none;
    width: 112px;
    height: 45px;
    border-radius: var(--r-md);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    overflow: hidden;
  }

  .banner-thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
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

  .swatch.none {
    background: var(--bg-input);
    color: var(--fg-3);
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

  .swatch.none.on {
    color: var(--fg);
  }

  .theme-colors {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .color-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--h-sm);
    padding: 0 10px 0 6px;
    border-radius: var(--r-md);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    font-size: var(--text-sm);
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .color-chip:hover,
  .color-chip.open {
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }

  .dot {
    width: 18px;
    height: 18px;
    border-radius: var(--r-sm);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.15);
  }

  .chip-label {
    color: var(--fg-2);
  }

  .chip-code {
    color: var(--fg-3);
    font-family: var(--mono);
    font-size: var(--text-xs);
  }

  /* Escolhas com desenho (moldura, efeito): azulejos com nome embaixo. */
  .tiles {
    --tile-bg: var(--bg-input);
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: 8px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 4px 8px;
    border-radius: var(--r-lg);
    background: var(--tile-bg);
    box-shadow: inset 0 0 0 1px var(--line);
    transition:
      box-shadow var(--t-fast) var(--ease),
      background-color var(--t-fast) var(--ease);
  }

  .tile:hover {
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .tile.on {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-input));
    box-shadow: inset 0 0 0 1.5px var(--accent-fg);
  }

  .tile-art {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    color: var(--fg-3);
  }

  /* Efeito: um pedacinho de cartão com a cor do perfil. */
  .tile-art.scene {
    position: relative;
    width: 100%;
    height: 52px;
    border-radius: var(--r-md);
    background: linear-gradient(180deg, color-mix(in oklab, var(--scene) 40%, #0b0b10), var(--bg-raised));
    overflow: hidden;
  }

  .tile-label {
    color: var(--fg-2);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .tile.on .tile-label {
    color: var(--fg);
  }

  .fonts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .font {
    height: var(--h-md);
    padding: 0 12px;
    border-radius: var(--r-md);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-2);
    font-size: var(--text-md);
    font-weight: 600;
    transition: box-shadow var(--t-fast) var(--ease);
  }

  .font:hover {
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .font.on {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-input));
    box-shadow: inset 0 0 0 1.5px var(--accent-fg);
    color: var(--fg);
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
