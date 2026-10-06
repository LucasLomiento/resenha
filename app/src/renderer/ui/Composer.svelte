<script lang="ts">
  import { untrack } from 'svelte'
  import { MAX_MESSAGE_LENGTH, MAX_UPLOAD_BYTES, type Attachment } from '../../../../shared/protocol'
  import { formatSize } from '../lib/format'
  import { compressImage } from '../lib/media'
  import { store } from '../lib/store.svelte'
  import { Icon, IconButton, Spinner } from './kit'

  let { channelId, placeholder }: { channelId: string; placeholder: string } = $props()

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
  let uploads = $state<Upload[]>([])
  let input = $state<HTMLTextAreaElement>()
  let picker = $state<HTMLInputElement>()
  let lastTyping = 0
  let uploadKey = 0

  const uploading = $derived(uploads.some((u) => !u.attachment && !u.error))
  const canSend = $derived(!uploading && (text.trim().length > 0 || uploads.some((u) => u.attachment)))

  // Trocou de canal: o rascunho é por canal, então limpa.
  $effect(() => {
    void channelId
    untrack(() => {
      text = ''
      clearUploads()
      input?.focus()
    })
  })

  export function addFiles(files: File[]) {
    if (!store.api) return
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

  async function startUpload(key: number, original: File) {
    // Imagem sempre vai diminuída (WebP, até 2560 px): a pessoa não precisa pensar nisso.
    const file = await compressImage(original)
    const current = uploads.find((u) => u.key === key)
    if (!current || !store.api) return // removido enquanto comprimia
    if (file.size > MAX_UPLOAD_BYTES) {
      return update(key, { preparing: false, error: `Maior que ${formatSize(MAX_UPLOAD_BYTES)}` })
    }
    const job = store.api.upload(file, (fraction) => update(key, { progress: fraction }))
    update(key, { file, preparing: false, abort: job.abort })
    job.promise
      .then((attachment) => update(key, { attachment, progress: 1 }))
      .catch((err: Error) => update(key, { error: err.message }))
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
    for (const u of uploads) if (u.preview) URL.revokeObjectURL(u.preview)
    uploads = []
  }

  async function send() {
    if (!canSend) return
    const content = text.trim()
    if (content.length > MAX_MESSAGE_LENGTH) return store.toast(`A mensagem passa de ${MAX_MESSAGE_LENGTH} caracteres.`)
    const sent = uploads.filter((u) => u.attachment)
    const ids = sent.map((u) => u.attachment!.id)
    // Limpa na hora; o que for anexado enquanto isso envia não é afetado.
    text = ''
    for (const u of sent) if (u.preview) URL.revokeObjectURL(u.preview)
    uploads = uploads.filter((u) => !sent.some((s) => s.key === u.key))
    resize()
    try {
      await store.sendMessage(channelId, content, ids)
    } catch {
      if (!text) text = content
      store.toast('A mensagem não foi enviada. Tente de novo.')
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      send()
    }
  }

  function onInput() {
    resize()
    if (text && Date.now() - lastTyping > 3000) {
      lastTyping = Date.now()
      store.send({ t: 'typing', channelId })
    }
  }

  function onPaste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])]
    if (files.length === 0) return
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
</script>

<div class="composer">
  <div class="box">
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

    <div class="input-row">
      <IconButton icon="paperclip" label="Anexar arquivo" onclick={() => picker?.click()} />
      <textarea
        bind:this={input}
        bind:value={text}
        rows="1"
        {placeholder}
        aria-label={placeholder}
        onkeydown={onKeydown}
        oninput={onInput}
        onpaste={onPaste}
      ></textarea>
    </div>
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

<style>
  .composer {
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

  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    min-height: 48px;
    padding: 8px 12px 8px 8px;
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
