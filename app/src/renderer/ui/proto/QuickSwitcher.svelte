<script lang="ts">
  import { Avatar, Icon, Kbd } from '../kit'
  import { guilds, presences, user } from './data'

  const query = 're'

  /** Destaca as letras que bateram com a busca. */
  function marked(text: string): { t: string; on: boolean }[] {
    const i = text.toLowerCase().indexOf(query)
    if (i < 0) return [{ t: text, on: false }]
    return [
      { t: text.slice(0, i), on: false },
      { t: text.slice(i, i + query.length), on: true },
      { t: text.slice(i + query.length), on: false },
    ].filter((p) => p.t)
  }

  const rafa = user('u-rafa')
  const results = [
    { group: 'Canais', items: [
      { icon: 'hash' as const, name: 'geral', hint: 'Resenha', unread: false },
      { icon: 'volume' as const, name: 'Resenha', hint: 'Resenha · 3 na call', unread: false },
      { icon: 'hash' as const, name: 'regras', hint: 'Mesa de RPG', unread: true },
    ] },
  ]
</script>

<!-- Ctrl+K: vai pra qualquer canal, conversa ou servidor digitando um pedaço do nome. -->
<div class="backdrop">
  <div class="switcher" role="dialog" aria-label="Ir para">
    <div class="input">
      <Icon name="search" size={18} />
      <span class="typed">{query}<span class="caret"></span></span>
      <Kbd keys="Esc" />
    </div>

    <div class="results" role="listbox">
      {#each results as section (section.group)}
        <div class="group">{section.group}</div>
        {#each section.items as item, i (item.name + item.hint)}
          <div class="item" class:on={i === 0} role="option" aria-selected={i === 0}>
            <span class="lead"><Icon name={item.icon} size={18} /></span>
            <span class="name" class:unread={item.unread}>
              {#each marked(item.name) as part, j (j)}{#if part.on}<mark>{part.t}</mark>{:else}{part.t}{/if}{/each}
            </span>
            <span class="hint">{item.hint}</span>
            {#if i === 0}<Kbd keys="Enter" />{/if}
          </div>
        {/each}
      {/each}

      <div class="group">Pessoas</div>
      <div class="item" role="option" aria-selected="false">
        <Avatar id={rafa.id} name={rafa.name} size={24} status={presences[rafa.id].status} cutout="var(--bg-raised)" />
        <span class="name">{#each marked(rafa.name) as part, j (j)}{#if part.on}<mark>{part.t}</mark>{:else}{part.t}{/if}{/each}</span>
        <span class="hint">{rafa.username}</span>
      </div>

      <div class="group">Servidores</div>
      <div class="item" role="option" aria-selected="false">
        <Avatar id={guilds[0].id} name={guilds[0].name} size={24} square />
        <span class="name">{#each marked(guilds[0].name) as part, j (j)}{#if part.on}<mark>{part.t}</mark>{:else}{part.t}{/if}{/each}</span>
        <span class="hint">11 membros</span>
      </div>
    </div>

    <div class="foot">
      <span><Kbd keys="↑" /><Kbd keys="↓" /> escolher</span>
      <span><Kbd keys="Enter" /> abrir</span>
      <span class="tip">Dica: comece com <b>@</b> pra pessoas, <b>#</b> pra canais</span>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    justify-content: center;
    padding-top: 14vh;
    background: rgb(4 4 8 / 0.66);
    backdrop-filter: blur(3px);
  }

  .switcher {
    display: flex;
    flex-direction: column;
    width: 580px;
    max-width: calc(100% - 48px);
    height: fit-content;
    border-radius: var(--r-2xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    overflow: hidden;
  }

  .input {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 56px;
    padding: 0 16px 0 18px;
    border-bottom: 1px solid var(--line);
    color: var(--fg-3);
  }

  .typed {
    flex: 1;
    color: var(--fg);
    font-size: 17px;
  }

  .caret {
    display: inline-block;
    width: 1.5px;
    height: 20px;
    margin-left: 1px;
    vertical-align: text-bottom;
    background: var(--accent-fg);
  }

  .results {
    padding: 6px 8px 8px;
  }

  .group {
    padding: 10px 10px 4px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding: 0 10px;
    border-radius: var(--r-lg);
    color: var(--fg-2);
  }

  .item.on {
    background: #25252f;
    color: var(--fg);
  }

  .lead {
    display: grid;
    width: 24px;
    place-items: center;
    color: var(--fg-3);
  }

  .name {
    font-weight: 500;
  }

  .name.unread {
    color: var(--fg);
    font-weight: 650;
  }

  mark {
    background: none;
    color: var(--accent-fg);
    font-weight: 650;
  }

  .hint {
    flex: 1;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 16px;
    border-top: 1px solid var(--line);
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .foot span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .tip {
    margin-left: auto;
  }

  .tip b {
    color: var(--fg-2);
    font-family: var(--mono);
  }
</style>
