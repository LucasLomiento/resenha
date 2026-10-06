<script lang="ts">
  import {
    Avatar,
    Badge,
    Button,
    Icon,
    IconButton,
    PageHeader,
    Row,
    Section,
    Select,
    SettingsLayout,
    Switch,
    TextField,
    type IconName,
    type SettingsNavEntry,
  } from '../kit'
  import {
    audit,
    bannedUsers,
    bans,
    date,
    displayName,
    guilds,
    invites,
    members,
    permissionGroups,
    relative,
    roleColor,
    roles,
    user,
    type PAudit,
  } from './data'

  type Page = 'overview' | 'roles' | 'members' | 'invites' | 'bans' | 'audit'
  let { page = 'overview' }: { page?: Page } = $props()
  let current = $derived<Page>(page)

  const guild = guilds[0]
  const nav: SettingsNavEntry[] = [
    { heading: guild.name },
    { id: 'overview', label: 'Visão geral', icon: 'settings' },
    { id: 'roles', label: 'Cargos', icon: 'shield' },
    { id: 'members', label: 'Membros', icon: 'users' },
    { id: 'invites', label: 'Convites', icon: 'link' },
    { id: 'bans', label: 'Banimentos', icon: 'ban' },
    { id: 'audit', label: 'Registro de auditoria', icon: 'scroll' },
  ]

  // --- cargos ---
  const editable = roles.filter((r) => r.name !== '@everyone')
  let selectedRole = $state(roles[1].id)
  const role = $derived(roles.find((r) => r.id === selectedRole)!)
  const SWATCHES = ['#a99bff', '#4fd8b0', '#ff8fa6', '#ffc35a', '#6ab8ff', '#ee78dc', '#9edc66', '#ff9466', null]

  // --- auditoria ---
  const AUDIT_ICON: Record<PAudit['action'], { icon: IconName; tone: string }> = {
    'channel.create': { icon: 'hash', tone: 'accent' },
    'channel.update': { icon: 'hash', tone: 'accent' },
    'role.update': { icon: 'shield', tone: 'accent' },
    'member.roles': { icon: 'user', tone: 'accent' },
    'member.kick': { icon: 'door-open', tone: 'red' },
    'member.ban': { icon: 'hammer', tone: 'red' },
    'message.pin': { icon: 'pin', tone: 'neutral' },
    'invite.create': { icon: 'link', tone: 'green' },
    'member.timeout': { icon: 'clock', tone: 'yellow' },
  }
  const AUDIT_VERB: Record<PAudit['action'], string> = {
    'channel.create': 'criou o canal',
    'channel.update': 'editou o canal',
    'role.update': 'editou o cargo',
    'member.roles': 'mudou os cargos de',
    'member.kick': 'expulsou',
    'member.ban': 'baniu',
    'message.pin': 'fixou uma mensagem em',
    'invite.create': 'criou o convite',
    'member.timeout': 'castigou',
  }
</script>

<SettingsLayout title="Configurações do servidor" {nav} active={current} onselect={(id) => (current = id as Page)} onclose={() => {}} inline>
  {#if current === 'overview'}
    <PageHeader title="Visão geral" />
    <Section>
      <Row stack>
        <div class="identity">
          <div class="icon-edit">
            <Avatar id={guild.id} name={guild.name} size={88} square />
            <button class="icon-overlay" aria-label="Trocar ícone"><Icon name="photo" size={20} /></button>
          </div>
          <div class="identity-fields">
            <TextField label="Nome do servidor" value={guild.name} maxlength={100} />
            <p class="hint">Ícone quadrado, de pelo menos 512 px. PNG, JPG ou GIF.</p>
            <div class="identity-actions">
              <Button size="sm" icon="upload">Trocar ícone</Button>
              <Button size="sm" variant="ghost">Remover</Button>
            </div>
          </div>
        </div>
      </Row>
    </Section>
    <Section title="Notificações" description="O padrão de quem entra; cada um pode mudar o seu.">
      <Row label="Avisar sobre">
        <Select
          label="Avisar sobre"
          value="mentions"
          options={[
            { value: 'all', label: 'Todas as mensagens' },
            { value: 'mentions', label: 'Só menções' },
          ]}
        />
      </Row>
    </Section>
    <Section title="Zona de perigo">
      <Row label="Transferir o servidor" description="Outra pessoa vira a dona. Você continua como membro.">
        <Button variant="secondary">Transferir</Button>
      </Row>
      <Row label="Excluir o servidor" description="Apaga canais, mensagens e arquivos. Não dá pra desfazer.">
        <Button variant="danger-soft" icon="trash">Excluir</Button>
      </Row>
    </Section>
    <div class="savebar">
      <span>Você tem alterações não salvas.</span>
      <Button variant="ghost" size="sm">Desfazer</Button>
      <Button variant="primary" size="sm">Salvar</Button>
    </div>
  {:else if current === 'roles'}
    <PageHeader title="Cargos" description="Quem pode o quê. Cargos mais altos mandam nos de baixo.">
      {#snippet actions()}<Button variant="primary" icon="plus" size="sm">Criar cargo</Button>{/snippet}
    </PageHeader>
    <div class="roles">
      <div class="role-list" role="listbox" aria-label="Cargos">
        {#each editable as r (r.id)}
          <button class="role-item" class:on={r.id === selectedRole} onclick={() => (selectedRole = r.id)} role="option" aria-selected={r.id === selectedRole}>
            <span class="grip"><Icon name="grip" size={14} /></span>
            <span class="role-dot" style:background={r.color ?? 'var(--fg-3)'}></span>
            <span class="role-name">{r.name}</span>
            <span class="role-count">{members.filter((m) => m.roles.includes(r.id)).length}</span>
          </button>
        {/each}
        <div class="role-sep"></div>
        <button class="role-item" class:on={selectedRole === 'g-resenha'} onclick={() => (selectedRole = 'g-resenha')}>
          <span class="grip"></span>
          <span class="role-dot everyone"></span>
          <span class="role-name">@everyone</span>
          <span class="role-count">{members.length}</span>
        </button>
        <p class="role-tip">Arraste pra mudar a ordem.</p>
      </div>

      <div class="role-editor">
        <Section>
          <Row label="Nome">
            <div class="w240"><TextField value={role.name} aria-label="Nome do cargo" disabled={role.name === '@everyone'} /></div>
          </Row>
          <Row label="Cor" stack>
            <div class="swatches">
              {#each SWATCHES as color (color)}
                <button
                  class="swatch"
                  class:on={role.color === color}
                  class:none={!color}
                  style:background={color}
                  aria-label={color ?? 'Sem cor'}
                >
                  {#if role.color === color}<Icon name="check" size={14} />{/if}
                </button>
              {/each}
            </div>
          </Row>
          <Row label="Mostrar separado na lista de membros" for="role-hoist">
            <Switch id="role-hoist" checked={role.hoist} />
          </Row>
          <Row label="Qualquer um pode mencionar" for="role-mention" description="Com @{role.name}, todo mundo do cargo é avisado.">
            <Switch id="role-mention" checked={role.mentionable} />
          </Row>
        </Section>

        {#each permissionGroups as group (group.title)}
          <Section title={group.title}>
            {#each group.items as item (item.key)}
              <Row label={item.label} description={item.hint} for="perm-{item.key}">
                <Switch id="perm-{item.key}" checked={item.on} />
              </Row>
            {/each}
          </Section>
        {/each}
      </div>
    </div>
  {:else if current === 'members'}
    <PageHeader title="Membros" description="{members.length} pessoas no servidor." />
    <div class="toolbar">
      <div class="grow"><TextField icon="search" placeholder="Buscar por nome" aria-label="Buscar membros" /></div>
      <div class="w180">
        <Select
          label="Filtrar por cargo"
          value="all"
          options={[{ value: 'all', label: 'Todos os cargos' }, ...editable.map((r) => ({ value: r.id, label: r.name }))]}
        />
      </div>
    </div>
    <Section>
      {#each members as m (m.userId)}
        {@const person = user(m.userId)}
        <Row>
          {#snippet leading()}<Avatar id={person.id} name={person.name} size={36} cutout="var(--bg-raised)" />{/snippet}
          <div class="member-row">
            <span class="member-text">
              <span class="member-name" style:color={roleColor(m.userId)}>{displayName(m.userId)}</span>
              <span class="member-sub">{person.username}</span>
            </span>
            <span class="member-roles">
              {#each roles.filter((r) => m.roles.includes(r.id)) as r (r.id)}
                <Badge dot={r.color ?? undefined}>{r.name}</Badge>
              {/each}
            </span>
            <span class="member-date">{date(m.joinedAt)}</span>
            <IconButton icon="ellipsis" label="Ações" size="sm" />
          </div>
        </Row>
      {/each}
    </Section>
  {:else if current === 'invites'}
    <PageHeader title="Convites" description="Quem tem o convite entra no servidor." />
    <Section title="Novo convite">
      <Row>
        <div class="invite-form">
          <label class="mini-field">
            <span>Vale por</span>
            <Select
              label="Vale por"
              value="7d"
              options={[
                { value: '30m', label: '30 minutos' },
                { value: '1h', label: '1 hora' },
                { value: '1d', label: '1 dia' },
                { value: '7d', label: '7 dias' },
                { value: 'never', label: 'Sempre' },
              ]}
            />
          </label>
          <label class="mini-field">
            <span>Usos</span>
            <Select
              label="Usos"
              value="10"
              options={[
                { value: '1', label: '1 pessoa' },
                { value: '5', label: '5 pessoas' },
                { value: '10', label: '10 pessoas' },
                { value: 'none', label: 'Sem limite' },
              ]}
            />
          </label>
          <Button variant="primary" icon="link">Criar convite</Button>
        </div>
      </Row>
    </Section>
    <Section title="Ativos">
      {#each invites as invite (invite.code)}
        <Row>
          <div class="invite-row">
            <code>{invite.code}</code>
            <span class="by"><Avatar id={invite.inviterId} name={user(invite.inviterId).name} size={20} cutout="var(--bg-raised)" />{user(invite.inviterId).name}</span>
            <span class="uses tabular">{invite.uses}{invite.maxUses ? `/${invite.maxUses}` : ''} usos</span>
            <span class="expires">{invite.expiresAt ? `vence ${relative(invite.expiresAt)}` : 'não vence'}</span>
            <IconButton icon="copy" label="Copiar link" size="sm" />
            <IconButton icon="trash" label="Revogar" size="sm" tone="danger" />
          </div>
        </Row>
      {/each}
    </Section>
  {:else if current === 'bans'}
    <PageHeader title="Banimentos" description="Quem foi banido não volta, nem com convite." />
    <Section>
      {#each bans as ban (ban.userId)}
        {@const person = bannedUsers[ban.userId]}
        <Row>
          {#snippet leading()}<Avatar id={person.id} name={person.name} size={36} cutout="var(--bg-raised)" />{/snippet}
          <div class="ban-row">
            <span class="member-text">
              <span class="member-name">{person.name} <span class="member-sub">{person.username}</span></span>
              <span class="ban-reason">{ban.reason}</span>
              <span class="ban-meta">por {user(ban.actorId).name} · {relative(ban.createdAt)}</span>
            </span>
            <Button size="sm">Desbanir</Button>
          </div>
        </Row>
      {/each}
    </Section>
  {:else if current === 'audit'}
    <PageHeader title="Registro de auditoria" description="Tudo o que a moderação fez, do mais novo pro mais antigo." />
    <div class="toolbar">
      <div class="w200">
        <Select label="Ação" value="all" options={[{ value: 'all', label: 'Todas as ações' }, { value: 'bans', label: 'Banimentos' }, { value: 'roles', label: 'Cargos' }]} />
      </div>
      <div class="w200">
        <Select label="Quem" value="all" options={[{ value: 'all', label: 'Qualquer pessoa' }, { value: 'bia', label: 'Bia' }, { value: 'lucas', label: 'Lucas' }]} />
      </div>
    </div>
    <Section>
      {#each audit as entry (entry.id)}
        {@const look = AUDIT_ICON[entry.action]}
        <Row>
          {#snippet leading()}<span class="audit-icon tone-{look.tone}"><Icon name={look.icon} size={16} /></span>{/snippet}
          <div class="audit-row">
            <span class="audit-text">
              <span><b>{user(entry.actorId).name}</b> {AUDIT_VERB[entry.action]} <b>{entry.target}</b></span>
              <span class="audit-detail">{entry.detail}</span>
            </span>
            <span class="audit-time">{relative(entry.createdAt)}</span>
          </div>
        </Row>
      {/each}
    </Section>
  {/if}
</SettingsLayout>

<style>
  .identity {
    display: flex;
    gap: 20px;
    align-items: flex-start;
  }

  .icon-edit {
    position: relative;
  }

  .icon-overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border-radius: 30%;
    background: rgb(8 8 12 / 0.55);
    color: #fff;
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }

  .icon-edit:hover .icon-overlay {
    opacity: 1;
  }

  .identity-fields {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hint {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .identity-actions {
    display: flex;
    gap: 6px;
  }

  .savebar {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
    padding: 10px 10px 10px 16px;
    border-radius: var(--r-xl);
    background: #20202a;
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-lg);
    font-size: var(--text-sm);
  }

  .savebar span {
    flex: 1;
  }

  /* ---------- Cargos ---------- */

  .roles {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }

  .role-list {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .role-item {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px 0 4px;
    border-radius: var(--r-md);
    color: var(--fg-2);
    font-size: var(--text-sm);
    text-align: left;
  }

  .role-item:hover {
    background: var(--hover);
  }

  .role-item.on {
    background: var(--selected);
    color: var(--fg);
  }

  .grip {
    display: grid;
    width: 14px;
    color: var(--fg-4);
  }

  .role-dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .role-dot.everyone {
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--fg-3);
  }

  .role-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .role-count {
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .role-sep {
    height: 1px;
    margin: 6px 4px;
    background: var(--line);
  }

  .role-tip {
    padding: 8px 6px;
    color: var(--fg-4);
    font-size: var(--text-xs);
  }

  .w240 {
    width: 240px;
  }

  .w180 {
    width: 180px;
  }

  .w200 {
    width: 200px;
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
    color: #0b0b10;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12);
    transition: transform var(--t-fast) var(--ease);
  }

  .swatch:hover {
    transform: scale(1.08);
  }

  .swatch.on {
    box-shadow:
      0 0 0 2px var(--bg-raised),
      0 0 0 4px var(--fg);
  }

  .swatch.none {
    background: linear-gradient(135deg, transparent 45%, var(--red) 45%, var(--red) 55%, transparent 55%), rgb(255 255 255 / 0.06);
  }

  /* ---------- Membros, convites, banimentos ---------- */

  .toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .grow {
    flex: 1;
  }

  .member-row,
  .invite-row,
  .ban-row,
  .audit-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-width: 0;
  }

  .member-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.35;
  }

  .member-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .member-sub {
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 400;
  }

  .member-roles {
    display: flex;
    gap: 4px;
  }

  .member-date {
    width: 96px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    text-align: right;
  }

  .invite-form {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    width: 100%;
  }

  .mini-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 160px;
    color: var(--fg-2);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .invite-row code {
    width: 120px;
    font: 500 13px var(--mono);
    color: var(--fg);
  }

  .by {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .uses {
    width: 72px;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .expires {
    width: 120px;
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .ban-reason {
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .ban-meta {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  /* ---------- Auditoria ---------- */

  .audit-icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }

  .tone-accent {
    background: var(--accent-soft);
    color: var(--accent-fg);
  }

  .tone-red {
    background: var(--red-soft);
    color: var(--red);
  }

  .tone-green {
    background: var(--green-soft);
    color: var(--green);
  }

  .tone-yellow {
    background: var(--yellow-soft);
    color: var(--yellow);
  }

  .tone-neutral {
    background: rgb(255 255 255 / 0.07);
    color: var(--fg-2);
  }

  .audit-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    color: var(--fg-2);
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  .audit-text b {
    color: var(--fg);
    font-weight: 600;
  }

  .audit-detail {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .audit-time {
    color: var(--fg-3);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
</style>
