<script lang="ts" module>
  /** Rascunho de cada conversa (fica na memória enquanto o app está aberto). */
  const drafts = new Map<string, { text: string; tokens: Map<string, string> }>()
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { MAX_MESSAGE_LENGTH, MAX_UPLOAD_BYTES, type Attachment, type Message } from '../../../../../shared/protocol'
  import { client } from '../../lib/client.svelte'
  import { searchEmoji } from '../../lib/emoji'
  import { formatSize } from '../../lib/format'
  import { compressImage } from '../../lib/media'
  import { VOICE_MAX_SECONDS, VoiceRecording, clock } from '../../lib/voice-note'
  import { Avatar, Icon, IconButton, Kbd, Spinner } from '../kit'
  import EmojiPicker from './EmojiPicker.svelte'
  import { toRaw } from './mentions'
  import type { ChatTarget } from './target.svelte'

  let {
    target,
    replyTo = $bindable(null),
    oneditlast,
  }: {
    target: ChatTarget
    replyTo?: Message | null
    /** Seta pra cima com o campo vazio: editar a última mensagem minha. */
    oneditlast: () => void
  } = $props()

  interface Upload {
    key: number
    file: File
    preview: string | null
    progress: number
    attachment: Attachment | null
    error: string | null
    /** Diminuindo a imagem antes de enviar. */
    preparing: boolean
    abort: () => void
  }

  let text = $state('')
  let tokens = new Map<string, string>()
  let uploads = $state<Upload[]>([])
  let input = $state<HTMLTextAreaElement>()
  let picker = $state<HTMLInputElement>()
  let emojiButton = $state<HTMLElement>()
  let emojiOpen = $state(false)
  let uploadKey = 0
  /** Modo lento: até quando esperar pra mandar de novo. */
  let waitUntil = $state(0)

  const uploading = $derived(uploads.some((u) => !u.attachment && !u.error))
  const waiting = $derived(Math.max(0, Math.ceil((waitUntil - client.now) / 1000)))
  const canSend = $derived(target.canSend && !uploading && waiting === 0 && (text.trim().length > 0 || uploads.some((u) => u.attachment)))
  const length = $derived(text.length)

  // Trocou de conversa: guarda o rascunho desta e traz o da outra. Só quando o id muda de
  // verdade: a conversa pode chegar como um objeto novo com o mesmo id (e aí não pode
  // apagar o que está sendo anexado, nem a gravação de voz em andamento).
  let currentId = ''
  $effect(() => {
    const id = target.id
    untrack(() => {
      if (id === currentId) return
      if (currentId) drafts.set(currentId, { text, tokens })
      const saved = drafts.get(id)
      text = saved?.text ?? ''
      tokens = saved?.tokens ?? new Map()
      currentId = id
      clearUploads()
      waitUntil = 0
      requestAnimationFrame(() => {
        resize()
        input?.focus()
      })
    })
  })

  // Clicou em "Responder": o foco vem pro campo.
  $effect(() => {
    if (replyTo) untrack(() => input?.focus())
  })

  export function addFiles(files: File[]) {
    if (!client.api || !target.canAttach) return
    for (const original of files) {
      const key = ++uploadKey
      const image = original.type.startsWith('image/')
      uploads.push({
        key,
        file: original,
        preview: image ? URL.createObjectURL(original) : null,
        progress: 0,
        attachment: null,
        error: null,
        preparing: image,
        abort: () => {},
      })
      startUpload(key, original)
    }
    input?.focus()
  }

  export function focus() {
    input?.focus()
  }

  /** Coloca um texto no cursor (emoji, menção). */
  export function insert(value: string) {
    if (!input) return
    const start = input.selectionStart ?? text.length
    const end = input.selectionEnd ?? text.length
    text = text.slice(0, start) + value + text.slice(end)
    // Logo que o texto novo chega na caixa (com rAF, quem digita rápido escrevia antes do cursor pular).
    void tick().then(() => {
      input?.focus()
      input?.setSelectionRange(start + value.length, start + value.length)
      resize()
    })
  }

  async function startUpload(key: number, original: File) {
    // Imagem sempre vai diminuída (WebP, até 2560 px): a pessoa não precisa pensar nisso.
    const file = await compressImage(original)
    const current = uploads.find((u) => u.key === key)
    if (!current || !client.api) return // removido enquanto comprimia
    if (file.size > MAX_UPLOAD_BYTES) {
      return update(key, { preparing: false, error: `Maior que ${formatSize(MAX_UPLOAD_BYTES)}` })
    }
    const size = await mediaSize(file)
    const job = client.api.upload(target.uploadPath, file, (fraction) => update(key, { progress: fraction }), size)
    update(key, { file, preparing: false, abort: job.abort })
    job.promise.then((attachment) => update(key, { attachment, progress: 1 })).catch((err: Error) => update(key, { error: err.message }))
  }

  /** Largura e altura da imagem (ou vídeo), pra o chat reservar o espaço certo. */
  async function mediaSize(file: File): Promise<{ width: number; height: number } | null> {
    try {
      if (file.type.startsWith('image/')) {
        const bitmap = await createImageBitmap(file)
        const size = { width: bitmap.width, height: bitmap.height }
        bitmap.close()
        return size
      }
      if (file.type.startsWith('video/')) {
        const url = URL.createObjectURL(file)
        const video = document.createElement('video')
        video.preload = 'metadata'
        video.src = url
        const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
          video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight })
          video.onerror = () => resolve(null)
          setTimeout(() => resolve(null), 3000)
        })
        URL.revokeObjectURL(url)
        return size && size.width ? size : null
      }
    } catch {
      // formato que o navegador não abre: segue sem
    }
    return null
  }

  function update(key: number, patch: Partial<Upload>) {
    const upload = uploads.find((u) => u.key === key)
    if (upload) Object.assign(upload, patch)
  }

  function removeUpload(key: number) {
    const upload = uploads.find((u) => u.key === key)
    if (!upload) return
    upload.abort()
    if (upload.preview) URL.revokeObjectURL(upload.preview)
    uploads = uploads.filter((u) => u.key !== key)
  }

  function clearUploads() {
    for (const u of uploads) {
      u.abort()
      if (u.preview) URL.revokeObjectURL(u.preview)
    }
    uploads = []
    cancelVoice()
  }

  // ---------- Mensagem de voz ----------

  /** Barrinhas de volume enquanto grava (a mais nova na direita). */
  const LEVEL_BARS = 40
  let recording = $state<VoiceRecording | null>(null)
  let recordSeconds = $state(0)
  let levels = $state<number[]>([])
  /** Depois de parar: convertendo pra MP3, ou enviando. */
  let voiceBusy = $state<'encoding' | 'uploading' | null>(null)
  let voiceProgress = $state(0)
  let voiceAbort: (() => void) | null = null
  let starting = false

  async function startVoice() {
    if (recording || voiceBusy || starting || !client.api || !target.canAttach || !target.canSend) return
    starting = true
    emojiOpen = false
    try {
      recording = await VoiceRecording.start()
      recordSeconds = 0
      levels = []
    } catch (err) {
      console.error('[voz] não deu pra gravar', err)
      const name = (err as Error).name
      client.toast(name === 'NotAllowedError' || name === 'NotFoundError' ? 'Sem acesso ao microfone.' : `Não deu pra gravar: ${(err as Error).message}`)
    } finally {
      starting = false
    }
  }

  // Gravando: o relógio e as barrinhas andam; no limite, envia sozinho.
  $effect(() => {
    const rec = recording
    if (!rec) return
    const timer = setInterval(() => {
      recordSeconds = rec.seconds
      levels = [...levels.slice(-(LEVEL_BARS - 1)), rec.level()]
      if (rec.seconds >= VOICE_MAX_SECONDS) void sendVoice()
    }, 80)
    // Enter envia, Esc descarta (o campo de texto some enquanto grava).
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelVoice()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        void sendVoice()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearInterval(timer)
      window.removeEventListener('keydown', onKey, true)
    }
  })

  // Saiu da conversa (ou fechou o chat) no meio da gravação: descarta.
  $effect(() => () => untrack(() => cancelVoice()))

  function cancelVoice() {
    recording?.cancel()
    recording = null
    voiceAbort?.()
    voiceAbort = null
  }

  async function sendVoice() {
    const rec = recording
    if (!rec || voiceBusy || !client.api) return
    if (waiting) return client.toast(`Modo lento: espere ${waiting}s.`)
    recording = null
    voiceBusy = 'encoding'
    voiceProgress = 0
    const reply = replyTo?.id ?? null
    try {
      const { file } = await rec.finish()
      if (file.size > MAX_UPLOAD_BYTES) throw new Error(`O áudio passou de ${formatSize(MAX_UPLOAD_BYTES)}.`)
      voiceBusy = 'uploading'
      const job = client.api.upload(target.uploadPath, file, (fraction) => (voiceProgress = fraction), null)
      voiceAbort = job.abort
      const attachment = await job.promise
      voiceAbort = null
      replyTo = null
      if (target.slowmode) waitUntil = Date.now() + target.slowmode * 1000
      await target.send('', [attachment.id], reply)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') client.toast((err as Error).message || 'A mensagem de voz não foi enviada.')
    } finally {
      voiceBusy = null
      voiceAbort = null
      void tick().then(() => input?.focus())
    }
  }

  async function send() {
    if (!canSend) return
    const typed = text.trim()
    const content = toRaw(typed, tokens)
    if (content.length > MAX_MESSAGE_LENGTH) return client.toast(`A mensagem passa de ${MAX_MESSAGE_LENGTH} caracteres.`)
    const sent = uploads.filter((u) => u.attachment)
    const ids = sent.map((u) => u.attachment!.id)
    const reply = replyTo?.id ?? null
    const sentTokens = tokens
    // Limpa na hora; o que for anexado enquanto isso envia não é afetado.
    text = ''
    tokens = new Map()
    replyTo = null
    for (const u of sent) if (u.preview) URL.revokeObjectURL(u.preview)
    uploads = uploads.filter((u) => !sent.some((s) => s.key === u.key))
    resize()
    if (target.slowmode) waitUntil = Date.now() + target.slowmode * 1000
    try {
      await target.send(content, ids, reply)
    } catch (err) {
      // Não foi: o texto volta pro campo (se a pessoa não começou outro).
      if (!text) {
        text = typed
        tokens = sentTokens
        requestAnimationFrame(resize)
      }
      waitUntil = 0
      client.toast((err as Error).message || 'A mensagem não foi enviada. Tente de novo.')
    }
  }

  // ---------- Sugestões (@pessoa, @cargo, #canal, :emoji:) ----------

  interface Suggestion {
    key: string
    label: string
    sub?: string
    color?: string | null
    avatar?: { id: string; src: string | null }
    dot?: string
    icon?: 'hash' | 'volume'
    emoji?: string
    /** O que entra no campo (e o token que ele vira no envio). */
    insert: string
    raw?: string
  }

  let suggestIndex = $state(0)
  let caret = $state(0)

  /** O que a pessoa está digitando agora: "@lu", "#ger" ou ":sor". */
  const trigger = $derived.by(() => {
    const before = text.slice(0, caret)
    const match = /(^|\s)([@#:])([\p{L}\p{N}_.-]*)$/u.exec(before)
    if (!match) return null
    const [, , sigil, query] = match
    if (sigil === ':' && query.length < 2) return null
    return { sigil, query: query.toLowerCase(), start: before.length - query.length - 1 }
  })

  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

  const suggestions = $derived.by((): Suggestion[] => {
    const t = trigger
    if (!t) return []
    const q = fold(t.query)
    const guild = target.guild
    if (t.sigil === ':') {
      return searchEmoji(t.query, 8).map((e) => ({ key: e.e, label: `:${e.k.split(' ')[0]}:`, emoji: e.e, insert: e.e }))
    }
    if (t.sigil === '#') {
      if (!guild) return []
      return guild.orderedChannels
        .filter((c) => c.kind !== 'category' && fold(c.name).includes(q))
        .slice(0, 8)
        .map((c) => ({ key: c.id, label: c.name, icon: c.kind === 'voice' ? ('volume' as const) : ('hash' as const), insert: `#${c.name}`, raw: `<#${c.id}>` }))
    }
    const out: Suggestion[] = []
    const people = guild
      ? Object.keys(guild.members)
      : [client.me?.id, target.dm?.user.id].filter((id): id is string => !!id)
    for (const id of people) {
      const name = target.displayName(id)
      const username = client.user(id, guild?.id)?.username ?? ''
      if (q && !fold(name).includes(q) && !username.includes(q)) continue
      out.push({
        key: id,
        label: name,
        sub: username,
        color: target.color(id),
        avatar: { id, src: target.avatar(id) },
        insert: `@${name}`,
        raw: `<@${id}>`,
      })
      if (out.length >= 6) break
    }
    if (guild) {
      for (const role of guild.roles) {
        if (role.id === guild.id || !fold(role.name).includes(q)) continue
        if (!role.mentionable && !target.canMentionEveryone) continue
        out.push({
          key: role.id,
          label: `@${role.name}`,
          sub: `${Object.values(guild.members).filter((m) => m.roles.includes(role.id)).length} pessoas`,
          color: role.color === null ? null : `#${role.color.toString(16).padStart(6, '0')}`,
          dot: role.color === null ? 'var(--fg-3)' : `#${role.color.toString(16).padStart(6, '0')}`,
          insert: `@${role.name}`,
          raw: `<@&${role.id}>`,
        })
      }
      if (target.canMentionEveryone) {
        for (const word of ['everyone', 'here']) {
          if (word.startsWith(q)) out.push({ key: word, label: `@${word}`, sub: word === 'everyone' ? 'Notifica todo mundo' : 'Notifica quem está online', dot: 'var(--fg-3)', insert: `@${word}` })
        }
      }
    }
    return out.slice(0, 10)
  })

  $effect(() => {
    void suggestions.length
    suggestIndex = 0
  })

  function complete(s: Suggestion) {
    const t = trigger
    if (!t || !input) return
    const value = `${s.insert} `
    text = text.slice(0, t.start) + value + text.slice(caret)
    if (s.raw) tokens.set(s.insert, s.raw)
    const position = t.start + value.length
    caret = position
    void tick().then(() => {
      input?.focus()
      input?.setSelectionRange(position, position)
      resize()
    })
  }

  // ---------- Teclado ----------

  function onKeydown(event: KeyboardEvent) {
    if (suggestions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        suggestIndex = (suggestIndex + step + suggestions.length) % suggestions.length
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        complete(suggestions[suggestIndex])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        caret = -1
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      send()
      return
    }
    if (event.key === 'ArrowUp' && !text && !uploads.length) {
      event.preventDefault()
      oneditlast()
      return
    }
    if (event.key === 'Escape' && replyTo) {
      event.preventDefault()
      replyTo = null
    }
  }

  function onInput() {
    resize()
    caret = input?.selectionStart ?? text.length
    if (text) target.typingStart()
  }

  function onPaste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])]
    if (files.length === 0 || !target.canAttach) return
    event.preventDefault()
    // Print colado vem sem nome útil.
    addFiles(
      files.map((f) =>
        f.name === 'image.png' ? new File([f], `print-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, { type: f.type }) : f,
      ),
    )
  }

  function resize() {
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`
  }

  const replyName = $derived(replyTo ? target.displayName(replyTo.authorId) : '')
  const pingReply = $derived(!!replyTo && replyTo.authorId !== client.me?.id)
</script>

<div class="composer">
  {#if suggestions.length}
    <div class="picker" role="listbox" aria-label="Sugestões">
      {#each suggestions as s, i (s.key)}
        <button
          class="option"
          class:on={i === suggestIndex}
          role="option"
          aria-selected={i === suggestIndex}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => complete(s)}
          onmouseenter={() => (suggestIndex = i)}
        >
          {#if s.emoji}<span class="option-emoji">{s.emoji}</span>
          {:else if s.avatar}<Avatar id={s.avatar.id} name={s.label} size={24} src={s.avatar.src} cutout="var(--bg-raised)" />
          {:else if s.icon}<span class="option-icon"><Icon name={s.icon} size={16} /></span>
          {:else if s.dot}<span class="role-dot" style:background={s.dot}></span>{/if}
          <span class="option-name" style:color={s.color}>{s.label}</span>
          {#if s.sub}<span class="option-sub">{s.sub}</span>{/if}
        </button>
      {/each}
      <div class="picker-foot"><Kbd keys="↑" /><Kbd keys="↓" /> escolher <Kbd keys="Tab" /> completar</div>
    </div>
  {/if}

  <div class="box" class:replying={!!replyTo} class:disabled={!target.canSend}>
    {#if replyTo}
      <div class="reply-bar">
        <Icon name="reply" size={14} />
        <span>Respondendo a <b>{replyName}</b>{#if pingReply}<span class="ping"> · vai notificar</span>{/if}</span>
        <button class="reply-close" aria-label="Cancelar resposta" onclick={() => (replyTo = null)}><Icon name="x" size={14} /></button>
      </div>
    {/if}

    {#if uploads.length}
      <div class="uploads">
        {#each uploads as u (u.key)}
          <div class="upload" class:error={!!u.error}>
            <div class="thumb">
              {#if u.preview}
                <img src={u.preview} alt={u.file.name} />
              {:else}
                <Icon name="file" size={24} />
              {/if}
              {#if !u.attachment && !u.error}
                <div class="veil">
                  {#if u.preparing}<Spinner size={18} />{:else}<span class="tabular">{Math.round(u.progress * 100)}%</span>{/if}
                </div>
              {/if}
            </div>
            <span class="upload-name" title={u.file.name}>{u.file.name}</span>
            <span class="upload-meta">
              {u.error ?? (u.preparing ? 'Preparando…' : u.attachment ? formatSize(u.file.size) : 'Enviando…')}
            </span>
            {#if !u.attachment && !u.error && !u.preparing}
              <div class="bar"><div style:width="{u.progress * 100}%"></div></div>
            {/if}
            <button class="remove" aria-label="Remover {u.file.name}" onclick={() => removeUpload(u.key)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    {#if recording || voiceBusy}
      <div class="input-row voice-row" role="group" aria-label="Mensagem de voz">
        <IconButton icon="trash" label="Descartar (Esc)" disabled={!!voiceBusy} onclick={cancelVoice} />
        <span class="rec-dot" class:busy={!!voiceBusy}></span>
        <span class="rec-time tabular">{clock(recordSeconds)}</span>
        {#if voiceBusy}
          <span class="rec-status">{voiceBusy === 'encoding' ? 'Preparando o áudio…' : `Enviando ${Math.round(voiceProgress * 100)}%`}</span>
          <Spinner size={16} />
        {:else}
          <div class="rec-bars" aria-hidden="true">
            {#each Array.from({ length: LEVEL_BARS }, (_, i) => levels[levels.length - LEVEL_BARS + i] ?? 0) as level, i (i)}
              <span style:height="{Math.max(10, Math.round(level * 100))}%"></span>
            {/each}
          </div>
        {/if}
        <IconButton icon="send" label="Enviar (Enter)" disabled={!!voiceBusy} onclick={() => void sendVoice()} />
      </div>
    {:else}
    <div class="input-row">
      {#if target.canAttach && target.canSend}
        <IconButton icon="paperclip" label="Anexar arquivo" onclick={() => picker?.click()} />
      {/if}
      <textarea
        bind:this={input}
        bind:value={text}
        rows="1"
        placeholder={target.placeholder}
        aria-label={target.placeholder}
        disabled={!target.canSend}
        onkeydown={onKeydown}
        oninput={onInput}
        onclick={() => (caret = input?.selectionStart ?? 0)}
        onkeyup={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') caret = input?.selectionStart ?? 0
        }}
        onpaste={onPaste}
        onblur={() => (caret = -1)}
        onfocus={() => (caret = input?.selectionStart ?? 0)}
      ></textarea>
      {#if waiting}
        <span class="slow" title="Modo lento"><Icon name="clock" size={14} />{waiting}s</span>
      {:else if length > MAX_MESSAGE_LENGTH - 500}
        <span class="counter" class:over={length > MAX_MESSAGE_LENGTH}>{MAX_MESSAGE_LENGTH - length}</span>
      {/if}
      {#if target.canSend}
        <span bind:this={emojiButton}>
          <IconButton icon="emoji" label="Emoji" active={emojiOpen} onclick={() => (emojiOpen = !emojiOpen)} />
        </span>
      {/if}
      {#if target.canAttach && target.canSend}
        <IconButton icon="mic" label="Gravar mensagem de voz" onclick={() => void startVoice()} />
      {/if}
    </div>
    {/if}
  </div>
  <input
    bind:this={picker}
    type="file"
    multiple
    hidden
    onchange={(e) => {
      addFiles([...(e.currentTarget.files ?? [])])
      e.currentTarget.value = ''
    }}
  />
</div>

{#if emojiOpen && emojiButton}
  <EmojiPicker
    anchor={emojiButton}
    placement="top-end"
    onpick={(emoji) => {
      insert(emoji)
      emojiOpen = false
    }}
    onclose={() => (emojiOpen = false)}
  />
{/if}

<style>
  .composer {
    position: relative;
    flex: none;
    padding: 0 16px;
  }

  .box {
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight);
    transition: box-shadow var(--t) var(--ease);
  }

  .box:focus-within {
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight);
  }

  .box.disabled {
    opacity: 0.7;
  }

  .reply-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--line);
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .reply-bar span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reply-bar b {
    color: var(--fg);
    font-weight: 600;
  }

  .ping {
    color: var(--fg-3);
  }

  .reply-close {
    display: grid;
    place-items: center;
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.08);
    color: var(--fg-2);
  }

  .reply-close:hover {
    background: rgb(255 255 255 / 0.14);
    color: var(--fg);
  }

  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    min-height: 48px;
    padding: 8px 8px 8px 8px;
  }

  /* ---------- Gravando mensagem de voz ---------- */
  .voice-row {
    align-items: center;
    gap: 8px;
  }

  .rec-dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--red);
    animation: rec-pulse 1.2s ease-in-out infinite;
  }

  .rec-dot.busy {
    background: var(--fg-3);
    animation: none;
  }

  @keyframes rec-pulse {
    50% {
      opacity: 0.35;
    }
  }

  .rec-time {
    flex: none;
    min-width: 38px;
    color: var(--fg);
    font-weight: 500;
  }

  .rec-status {
    flex: 1;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .rec-bars {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 28px;
    min-width: 0;
  }

  .rec-bars span {
    flex: 1;
    min-width: 2px;
    border-radius: var(--r-full);
    background: var(--accent-fg);
    transition: height 80ms linear;
  }

  textarea {
    flex: 1;
    min-width: 0;
    max-height: 240px;
    padding: 6px 4px;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--fg);
    font-size: var(--text-lg);
    line-height: 1.35;
    resize: none;
    user-select: text;
  }

  textarea::placeholder {
    color: var(--fg-3);
  }

  textarea:disabled {
    cursor: not-allowed;
  }

  .slow,
  .counter {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: center;
    padding: 0 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .counter.over {
    color: var(--red);
  }

  /* ---------- Sugestões ---------- */

  .picker {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: calc(100% + 8px);
    z-index: 5;
    padding: 6px;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-lg);
    animation: rs-pop-in var(--t) var(--ease);
  }

  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border-radius: var(--r-md);
    font-size: var(--text-sm);
    text-align: left;
  }

  .option.on {
    background: #25252f;
  }

  .option-name {
    overflow: hidden;
    color: var(--fg);
    font-weight: 550;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .option-sub {
    margin-left: auto;
    padding-left: 12px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .option-emoji {
    width: 24px;
    font-size: 18px;
    text-align: center;
  }

  .option-icon {
    display: grid;
    place-items: center;
    width: 24px;
    color: var(--fg-3);
  }

  .role-dot {
    flex: none;
    width: 10px;
    height: 10px;
    margin: 0 7px;
    border-radius: 50%;
  }

  .picker-foot {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    padding: 8px 10px 4px;
    border-top: 1px solid var(--line);
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  /* ---------- Anexos ---------- */

  .uploads {
    display: flex;
    gap: 10px;
    padding: 12px 12px 4px;
    overflow-x: auto;
  }

  .upload {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: none;
    width: 128px;
  }

  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    height: 88px;
    margin-bottom: 6px;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-3);
    overflow: hidden;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .veil {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(11 11 16 / 0.55);
    color: #fff;
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .upload.error .thumb {
    box-shadow: inset 0 0 0 1px rgb(255 92 114 / 0.6);
  }

  .upload-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .upload-meta {
    color: var(--fg-3);
    font-size: 11px;
  }

  .upload.error .upload-meta {
    color: var(--red);
  }

  .bar {
    height: 3px;
    margin-top: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.08);
    overflow: hidden;
  }

  .bar div {
    height: 100%;
    background: var(--accent-fg);
    transition: width var(--t) linear;
  }

  .remove {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgb(11 11 16 / 0.75);
    color: #fff;
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  .upload:hover .remove,
  .remove:focus-visible,
  .upload.error .remove {
    opacity: 1;
  }

  .remove:hover {
    background: var(--red);
  }
</style>
