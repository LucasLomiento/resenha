<script lang="ts">
  import { onMount } from 'svelte'
  import type { Message } from '../../../../../shared/protocol'
  import { formatStamp } from '../../lib/format'
  import { plainText } from '../../lib/markdown'
  import { Avatar, Button, EmptyState, IconButton, Popover, Spinner } from '../kit'
  import type { ChatTarget } from './target.svelte'

  let {
    target,
    anchor,
    onjump,
    onclose,
  }: { target: ChatTarget; anchor: HTMLElement; onjump: (messageId: string) => void; onclose: () => void } = $props()

  let pins = $state<Message[] | null>(null)
  let failed = $state(false)

  onMount(async () => {
    try {
      pins = (await target.guild?.pins(target.id)) ?? []
    } catch {
      failed = true
    }
  })

  /** As fixadas mudam enquanto o painel está aberto (alguém desafixa): acompanha pelo chat. */
  const live = $derived(
    pins?.filter((p) => target.messages.find((m) => m.id === p.id)?.pinned !== false) ?? null,
  )

  const text = (content: string) =>
    plainText(content, {
      user: target.names.user,
      role: (id) => target.names.role(id)?.name ?? 'cargo',
      channel: (id) => target.names.channel(id)?.name ?? 'canal',
    })
</script>

<!-- Fixadas do canal: abre pelo alfinete do cabeçalho. -->
<Popover {anchor} placement="bottom-end" width={380} label="Mensagens fixadas" {onclose}>
  <div class="pins">
    <header>
      <span>Fixadas</span>
      {#if live}<span class="count">{live.length}</span>{/if}
    </header>
    <div class="list">
      {#if failed}
        <p class="note">Não deu pra carregar agora.</p>
      {:else if !live}
        <div class="note"><Spinner size={16} /></div>
      {:else if live.length === 0}
        <EmptyState icon="pin" title="Nada fixado ainda" description="Fixe mensagens importantes pra achar depois." />
      {:else}
        {#each live as message (message.id)}
          <div class="pin">
            <div class="pin-head">
              <Avatar id={message.authorId} name={target.displayName(message.authorId)} size={24} src={target.avatar(message.authorId)} cutout="var(--bg-raised)" />
              <span class="name" style:color={target.color(message.authorId)}>{target.displayName(message.authorId)}</span>
              <span class="time">{formatStamp(message.createdAt)}</span>
              <span class="pin-actions">
                <Button size="sm" variant="ghost" onclick={() => onjump(message.id)}>Ir</Button>
                {#if target.canPin}
                  <IconButton
                    icon="pin-off"
                    label="Desafixar"
                    size="sm"
                    onclick={() => {
                      target.pin(message.id, false)
                      pins = pins?.filter((p) => p.id !== message.id) ?? null
                    }}
                  />
                {/if}
              </span>
            </div>
            {#if message.content}<p>{text(message.content)}</p>{/if}
            {#if message.attachments.length}<span class="attachment">{message.attachments[0].name}</span>{/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</Popover>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 48px;
    padding: 0 16px;
    border-bottom: 1px solid var(--line);
    font-weight: 600;
  }

  .count {
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--r-full);
    background: rgb(255 255 255 / 0.08);
    color: var(--fg-2);
    font-size: var(--text-2xs);
    line-height: 20px;
    text-align: center;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 420px;
    padding: 10px;
    overflow-y: auto;
  }

  .note {
    display: grid;
    place-items: center;
    padding: 24px;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .pin {
    padding: 10px 10px 12px 12px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.03);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .pin-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .name {
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .time {
    flex: 1;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .pin-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  p {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    margin: 6px 0 0 32px;
    overflow: hidden;
    color: var(--fg-2);
    font-size: var(--text-sm);
    white-space: pre-wrap;
  }

  .attachment {
    display: inline-block;
    margin: 6px 0 0 32px;
    color: var(--accent-fg);
    font-size: var(--text-xs);
  }
</style>
