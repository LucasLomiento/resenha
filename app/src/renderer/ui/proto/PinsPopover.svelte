<script lang="ts">
  import { Avatar, Button, IconButton } from '../kit'
  import { displayName, pinned, roleColor, stamp } from './data'

  const clean = (text: string) => text.replace(/<@[\w-]+>/g, '@Lucas').replace(/<#[\w-]+>/g, '#Resenha')
</script>

<!-- Fixadas do canal: abre pelo alfinete do cabeçalho. -->
<div class="pins" role="dialog" aria-label="Mensagens fixadas">
  <header>
    <span>Fixadas</span>
    <span class="count">{pinned.length}</span>
  </header>
  <div class="list">
    {#each pinned as message (message.id)}
      <div class="pin">
        <div class="pin-head">
          <Avatar id={message.authorId} name={displayName(message.authorId)} size={24} cutout="var(--bg-raised)" />
          <span class="name" style:color={roleColor(message.authorId)}>{displayName(message.authorId)}</span>
          <span class="time">{stamp(message.createdAt)}</span>
          <span class="pin-actions">
            <Button size="sm" variant="ghost">Ir</Button>
            <IconButton icon="pin-off" label="Desafixar" size="sm" />
          </span>
        </div>
        <p>{clean(message.content)}</p>
        {#if message.attachments?.length}<span class="attachment">{message.attachments[0].name}</span>{/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .pins {
    position: absolute;
    top: 52px;
    right: 196px;
    z-index: 6;
    width: 380px;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    overflow: hidden;
  }

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
    margin: 6px 0 0 32px;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .attachment {
    display: inline-block;
    margin: 6px 0 0 32px;
    color: var(--accent-fg);
    font-size: var(--text-xs);
  }
</style>
