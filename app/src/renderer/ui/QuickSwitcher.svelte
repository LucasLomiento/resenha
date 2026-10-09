<script lang="ts">
  import { client } from '../lib/client.svelte'
  import { around, i18n, m } from '../lib/i18n.svelte'
  import { seesPlatform } from '../lib/profile'
  import { searchSettings } from '../lib/settings-search'
  import { openSetting, ui } from '../lib/ui.svelte'
  import { Avatar, Icon, Kbd, layer, portal, type IconName } from './kit'

  interface Item {
    key: string
    group: 'dms' | 'channels' | 'people' | 'servers' | 'settings'
    name: string
    hint: string
    unread?: boolean
    icon?: IconName
    avatar?: { id: string; name: string; src: string | null; square?: boolean; status?: 'online' | 'idle' | 'dnd' | 'offline' | null }
    score: number
    open: () => void
  }

  let query = $state('')
  let index = $state(0)
  let input = $state<HTMLInputElement>()
  let list = $state<HTMLDivElement>()

  const t = $derived(m.app.quickSwitcher)
  /** A dica do rodapé, com o @ e o # em negrito no lugar dos marcadores. */
  const tip = $derived.by(() => {
    const [beforeAt, rest] = around(t.tip, '{at}')
    const [beforeHash, end] = around(rest, '{hash}')
    return { beforeAt, beforeHash, end }
  })

  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

  function close() {
    ui.switcher = false
  }

  /** Começar com o nome vale mais que ter no meio; sem busca, tudo vale igual. */
  function score(name: string, q: string): number {
    if (!q) return 1
    const f = fold(name)
    if (f.startsWith(q)) return 3
    if (f.split(/[\s_.-]+/).some((w) => w.startsWith(q))) return 2
    return f.includes(q) ? 1 : 0
  }

  const items = $derived.by((): Item[] => {
    const raw = query.trim()
    const only = raw.startsWith('@') ? 'people' : raw.startsWith('#') ? 'channels' : null
    const q = fold(only ? raw.slice(1) : raw)
    const out: Item[] = []

    if (!q && !only) {
      // Sem busca: as conversas mais recentes e os servidores.
      for (const dm of (client.home?.sortedDms ?? []).slice(0, 5)) {
        out.push({
          key: `dm:${dm.id}`,
          group: 'dms',
          name: dm.user.name,
          hint: `@${dm.user.username}`,
          unread: dm.unread > 0,
          avatar: { id: dm.user.id, name: dm.user.name, src: client.api?.avatar(dm.user) ?? null, status: client.presenceOf(dm.user.id).status },
          score: 1,
          open: () => client.navigate({ kind: 'dm', channelId: dm.id }),
        })
      }
    }

    if (only !== 'people') {
      for (const guild of client.guildList) {
        for (const channel of guild.orderedChannels) {
          const s = score(channel.name, q)
          if (!s || (!q && !only)) continue
          const inCall = channel.kind === 'voice' ? guild.voiceIn(channel.id).length : 0
          out.push({
            key: `c:${channel.id}`,
            group: 'channels',
            name: channel.name,
            hint: inCall ? t.inCall(guild.info.name, inCall) : guild.info.name,
            unread: channel.kind === 'text' && guild.unread(channel.id) && !guild.channelMuted(channel.id),
            icon: channel.kind === 'voice' ? 'volume' : 'hash',
            score: s + (client.route.kind === 'guild' && client.route.guildId === guild.id ? 0.5 : 0),
            open: () => client.openChannel(guild.id, channel.id),
          })
        }
      }
    }

    if (only !== 'channels' && q) {
      // Pessoas: amigos, conversas e quem está nos meus servidores (sem repetir).
      const seen = new Set<string>([client.me?.id ?? ''])
      const people: { id: string; name: string; username: string; avatar: string | null }[] = []
      for (const f of client.home?.friends ?? []) if (f.state === 'friends') people.push(f.user)
      for (const d of client.home?.dms ?? []) people.push(d.user)
      for (const g of client.guildList) for (const id of Object.keys(g.members)) if (g.users[id]) people.push(g.users[id])
      for (const person of people) {
        if (seen.has(person.id)) continue
        seen.add(person.id)
        const s = Math.max(score(person.name, q), score(person.username, q))
        if (!s) continue
        out.push({
          key: `u:${person.id}`,
          group: 'people',
          name: person.name,
          hint: `@${person.username}`,
          avatar: { id: person.id, name: person.name, src: client.api?.avatar(person) ?? null, status: client.presenceOf(person.id).status },
          score: s,
          open: () => client.openDm(person.id),
        })
      }
    }

    if (!only) {
      for (const guild of client.guildList) {
        const s = score(guild.info.name, q)
        if (!s) continue
        const count = Object.keys(guild.members).length
        out.push({
          key: `g:${guild.id}`,
          group: 'servers',
          name: guild.info.name,
          hint: t.members(count),
          unread: guild.hasUnread,
          avatar: { id: guild.id, name: guild.info.name, src: client.api?.media(guild.info.icon) ?? null, square: true },
          score: s,
          open: () => client.openGuild(guild.id),
        })
      }
    }

    if (!only && q) {
      const context = {
        staff: !!client.me?.staff,
        platform: seesPlatform(client.me),
        desktop: !!client.desktop,
        hyprland: !!client.platform?.hyprland,
        locale: i18n.locale,
      }
      for (const [i, entry] of searchSettings(raw, context).slice(0, 5).entries()) {
        out.push({
          key: `s:${entry.id}`,
          group: 'settings',
          name: entry.label,
          hint: entry.where,
          icon: 'settings',
          score: 5 - i,
          open: () => openSetting(entry),
        })
      }
    }

    const order = { dms: 0, channels: 1, people: 2, servers: 3, settings: 4 }
    return out
      .sort((a, b) => order[a.group] - order[b.group] || b.score - a.score || Number(!!b.unread) - Number(!!a.unread))
      .slice(0, 40)
  })

  // Os grupos ficam na ordem, mas o "escolhido" anda por todos.
  $effect(() => {
    void query
    index = 0
  })

  function pick(item: Item | undefined) {
    if (!item) return
    close()
    item.open()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      index = (index + step + items.length) % Math.max(items.length, 1)
      requestAnimationFrame(() => list?.querySelector('.item.on')?.scrollIntoView({ block: 'nearest' }))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(items[index])
    }
  }

  /** Destaca as letras que bateram com a busca. */
  function marked(text: string): { t: string; on: boolean }[] {
    const raw = query.trim().replace(/^[@#]/, '')
    const q = fold(raw)
    if (!q) return [{ t: text, on: false }]
    const f = fold(text)
    const i = f.indexOf(q)
    if (i < 0 || f.length !== text.length) return [{ t: text, on: false }]
    return [
      { t: text.slice(0, i), on: false },
      { t: text.slice(i, i + q.length), on: true },
      { t: text.slice(i + q.length), on: false },
    ].filter((p) => p.t)
  }

  function autofocus(node: HTMLInputElement) {
    requestAnimationFrame(() => node.focus())
  }
</script>

<!-- Ctrl+K: vai pra qualquer canal, conversa ou servidor digitando um pedaço do nome. -->
<div class="backdrop" use:portal use:layer={close} onmousedown={(e) => e.target === e.currentTarget && close()} role="presentation">
  <div class="switcher" role="dialog" aria-label={t.label}>
    <div class="input">
      <Icon name="search" size={18} />
      <input
        bind:this={input}
        bind:value={query}
        placeholder={t.placeholder}
        aria-label={t.placeholder}
        onkeydown={onKeydown}
        use:autofocus
      />
      <Kbd keys="Esc" />
    </div>

    <div class="results" role="listbox" bind:this={list}>
      {#each items as item, i (item.key)}
        {#if i === 0 || items[i - 1].group !== item.group}
          <div class="group">{t.groups[item.group]}</div>
        {/if}
        <button class="item" class:on={i === index} role="option" aria-selected={i === index} onmouseenter={() => (index = i)} onclick={() => pick(item)}>
          {#if item.avatar}
            <Avatar id={item.avatar.id} name={item.avatar.name} size={24} src={item.avatar.src} square={item.avatar.square} status={item.avatar.status ?? null} cutout={i === index ? '#25252f' : 'var(--bg-raised)'} />
          {:else if item.icon}
            <span class="lead"><Icon name={item.icon} size={18} /></span>
          {/if}
          <span class="name" class:unread={item.unread}>
            {#each marked(item.name) as part, j (j)}{#if part.on}<mark>{part.t}</mark>{:else}{part.t}{/if}{/each}
          </span>
          <span class="hint">{item.hint}</span>
          {#if i === index}<Kbd keys="Enter" />{/if}
        </button>
      {:else}
        <p class="empty">{query.trim() ? t.noMatch : t.empty}</p>
      {/each}
    </div>

    <div class="foot">
      <span><Kbd keys="↑" /><Kbd keys="↓" /> {t.pick}</span>
      <span><Kbd keys="Enter" /> {t.open}</span>
      <span class="tip">{tip.beforeAt}<b>@</b>{tip.beforeHash}<b>#</b>{tip.end}</span>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    justify-content: center;
    padding-top: 14vh;
    background: rgb(4 4 8 / 0.66);
    backdrop-filter: blur(3px);
    animation: rs-fade-in var(--t) var(--ease);
  }

  .switcher {
    display: flex;
    flex-direction: column;
    width: 580px;
    max-width: calc(100% - 48px);
    max-height: 70vh;
    height: fit-content;
    border-radius: var(--r-2xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    overflow: hidden;
    animation: rs-pop-in var(--t) var(--ease);
  }

  .input {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    height: 56px;
    padding: 0 16px 0 18px;
    border-bottom: 1px solid var(--line);
    color: var(--fg-3);
  }

  .input input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--fg);
    font-size: 17px;
  }

  .input input::placeholder {
    color: var(--fg-3);
  }

  .results {
    flex: 1;
    min-height: 0;
    padding: 6px 8px 8px;
    overflow-y: auto;
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
    width: 100%;
    height: 40px;
    padding: 0 10px;
    border-radius: var(--r-lg);
    color: var(--fg-2);
    text-align: left;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .empty {
    padding: 20px 10px;
    color: var(--fg-3);
    font-size: var(--text-sm);
    text-align: center;
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 16px;
    flex: none;
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
