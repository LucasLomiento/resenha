<script lang="ts">
  import { untrack } from 'svelte'
  import { MAX_MESSAGE_LENGTH, MAX_UPLOAD_BYTES, type Attachment } from '../../../../shared/protocol'
  import { formatSize } from '../lib/format'
  import { store } from '../lib/store.svelte'
  import Icon from './Icon.svelte'

  let { channelId, channelName }: { channelId: string; channelName: string } = $props()

  interface Upload {
    key: number
    file: File
    preview: string | null
    progress: number
    attachment: Attachment | null
    error: string | null
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
    const api = store.api
    if (!api) return
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        store.toast(`${file.name} passa de ${formatSize(MAX_UPLOAD_BYTES)}.`)
        continue
      }
      const key = ++uploadKey
      const job = api.upload(file, (fraction) => update(key, { progress: fraction }))
      uploads.push({
        key,
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        progress: 0,
        attachment: null,
        error: null,
        abort: job.abort,
      })
      job.promise
        .then((attachment) => update(key, { attachment, progress: 1 }))
        .catch((err: Error) => update(key, { error: err.message }))
    }
    input?.focus()
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
    if (content.length > MAX_MESSAGE_LENGTH) return store.toast(`Mensagem passa de ${MAX_MESSAGE_LENGTH} caracteres.`)
    const sent = uploads.filter((u) => u.attachment)
    const ids = sent.map((u) => u.attachment!.id)
    // Limpa na hora (como no Discord); o que for anexado enquanto isso envia não é afetado.
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
  {#if uploads.length}
    <div class="uploads">
      {#each uploads as u (u.key)}
        <div class="upload" class:error={!!u.error}>
          {#if u.preview}
            <img src={u.preview} alt={u.file.name} />
          {:else}
            <div class="file-icon"><Icon name="file" size={30} stroke={1.5} /></div>
          {/if}
          <span class="upload-name" title={u.file.name}>{u.file.name}</span>
          <span class="upload-meta">{u.error ?? (u.attachment ? formatSize(u.file.size) : `${Math.round(u.progress * 100)}%`)}</span>
          {#if !u.attachment && !u.error}
            <div class="bar"><div style:width="{u.progress * 100}%"></div></div>
          {/if}
          <button class="remove" title="Remover" onclick={() => removeUpload(u.key)}><Icon name="x" size={14} /></button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="box">
    <button class="icon-btn" title="Enviar arquivo" onclick={() => picker?.click()}><Icon name="clip" /></button>
    <textarea
      bind:this={input}
      bind:value={text}
      rows="1"
      placeholder="Conversar em #{channelName}"
      onkeydown={onKeydown}
      oninput={onInput}
      onpaste={onPaste}
    ></textarea>
    {#if uploading}<span class="hint">enviando arquivo…</span>{/if}
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
    padding: 0 18px 2px;
    flex: none;
  }

  .uploads {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding: 10px;
    border-radius: 10px 10px 0 0;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border);
  }

  .upload {
    position: relative;
    flex: none;
    width: 150px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border-radius: 8px;
    background: var(--bg-main);
  }

  .upload.error {
    outline: 1px solid var(--red);
  }

  .upload img,
  .file-icon {
    width: 100%;
    height: 90px;
    object-fit: cover;
    border-radius: 6px;
    display: grid;
    place-items: center;
    background: var(--bg-deep);
    color: var(--text-faint);
  }

  .upload-name {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .upload-meta {
    font-size: 11px;
    color: var(--text-faint);
  }

  .upload.error .upload-meta {
    color: var(--red);
  }

  .bar {
    height: 3px;
    border-radius: 2px;
    background: var(--bg-active);
    overflow: hidden;
  }

  .bar div {
    height: 100%;
    background: var(--accent);
  }

  .remove {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.6);
    color: white;
  }

  .box {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 6px 10px 6px 6px;
    border-radius: 10px;
    background: var(--bg-raised);
  }

  .uploads + .box {
    border-radius: 0 0 10px 10px;
  }

  textarea {
    flex: 1;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    padding: 6px 4px;
    max-height: 240px;
    user-select: text;
  }

  .hint {
    font-size: 12px;
    color: var(--text-faint);
    padding-bottom: 7px;
  }
</style>
