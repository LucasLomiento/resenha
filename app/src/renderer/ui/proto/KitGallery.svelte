<script lang="ts">
  import {
    Avatar,
    Badge,
    Button,
    EmptyState,
    Icon,
    IconButton,
    Kbd,
    Menu,
    Meter,
    RadioGroup,
    Row,
    Section,
    Segmented,
    Select,
    SignalBars,
    Slider,
    Spinner,
    StatusDot,
    Switch,
    Tabs,
    TextField,
    type IconName,
  } from '../kit'

  const surfaces = [
    ['--bg-canvas', 'Fundo da janela'],
    ['--bg-panel', 'Painel'],
    ['--bg-raised', 'Cartão, menu, modal'],
    ['--bg-overlay', 'Dica'],
    ['--bg-input', 'Campo'],
  ]
  const texts = [
    ['--fg', 'Texto'],
    ['--fg-2', 'Secundário'],
    ['--fg-3', 'Apagado'],
    ['--fg-4', 'Desligado'],
  ]
  const accents = [
    ['--brand-1', 'Marca 1'],
    ['--brand-2', 'Marca 2'],
    ['--brand-3', 'Marca 3'],
    ['--accent', 'Acento (botão)'],
    ['--accent-fg', 'Acento (texto)'],
    ['--green', 'Falando, online'],
    ['--yellow', 'Ausente, aviso'],
    ['--red', 'Ao vivo, perigo'],
  ]
  const type = [
    ['--text-3xl', '28', 'Bem-vindo a #geral', 650],
    ['--text-2xl', '22', 'Título de página', 650],
    ['--text-xl', '18', 'Título de painel', 600],
    ['--text-lg', '15', 'Texto das mensagens', 400],
    ['--text-md', '14', 'Interface e rótulos', 500],
    ['--text-sm', '13', 'Itens e descrições', 400],
    ['--text-xs', '12', 'Legendas e horários', 400],
    ['--text-2xs', '11', 'Selos', 600],
  ] as const
  const icons: IconName[] = [
    'mic', 'mic-off', 'headphones', 'headphones-off', 'camera', 'screen', 'screen-off', 'phone-off', 'settings', 'hash', 'volume',
    'users', 'user-plus', 'message', 'reply', 'emoji-plus', 'pin', 'search', 'paperclip', 'download', 'link', 'shield', 'crown', 'ban',
    'scroll', 'lock', 'bell', 'keyboard', 'sliders', 'trash', 'pencil', 'copy', 'check', 'x', 'plus', 'chevron-down', 'ellipsis', 'pip',
  ]

  let segmented = $state<'a' | 'b' | 'c'>('a')
  let tab = $state<'online' | 'all' | 'pending'>('online')
  let radio = $state<'one' | 'two'>('one')
  let slider = $state(0.6)
  let threshold = $state<number | null>(0.45)
</script>

<div class="gallery">
  <header class="intro">
    <h1>Kit do Resenha</h1>
    <p>Tudo o que as telas usam. Tokens em <code>app.css</code>, componentes em <code>ui/kit</code>.</p>
  </header>

  <div class="grid">
    <section class="card wide">
      <h2>Cores</h2>
      <div class="swatches">
        {#each [...surfaces, ...texts, ...accents] as [token, name] (token)}
          <div class="swatch">
            <span class="chip" style:background="var({token})"></span>
            <span class="token">{token}</span>
            <span class="name">{name}</span>
          </div>
        {/each}
        <div class="swatch">
          <span class="chip" style:background="var(--brand-gradient)"></span>
          <span class="token">--brand-gradient</span>
          <span class="name">Só em momentos de marca</span>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Tipografia · Geist</h2>
      {#each type as [token, px, sample, weight] (token)}
        <div class="type-row">
          <span class="type-meta">{px}</span>
          <span style:font-size="var({token})" style:font-weight={weight}>{sample}</span>
        </div>
      {/each}
      <div class="type-row"><span class="type-meta">mono</span><code class="mono">resenha --action=toggle-mute</code></div>
    </section>

    <section class="card">
      <h2>Ícones · Lucide, traço 1,75 px</h2>
      <div class="icons">
        {#each icons as name (name)}<span class="icon" title={name}><Icon {name} /></span>{/each}
      </div>
    </section>

    <section class="card">
      <h2>Botões</h2>
      <div class="row-items">
        <Button variant="primary" icon="screen">Compartilhar</Button>
        <Button>Secundário</Button>
        <Button variant="ghost">Cancelar</Button>
      </div>
      <div class="row-items">
        <Button variant="danger-soft" icon="log-out">Sair</Button>
        <Button variant="danger">Apagar</Button>
        <Button variant="primary" loading>Enviando</Button>
        <Button disabled>Desligado</Button>
      </div>
      <div class="row-items">
        <Button size="sm" icon="plus">Pequeno</Button>
        <Button>Médio</Button>
        <Button size="lg" variant="primary">Grande</Button>
      </div>
    </section>

    <section class="card">
      <h2>Botões de ícone</h2>
      <div class="row-items">
        <IconButton icon="mic" label="Mutar" />
        <IconButton icon="mic-off" label="Desmutar" tone="danger" active />
        <IconButton icon="camera" label="Câmera" tone="accent" active />
        <IconButton icon="phone-off" label="Sair da call" tone="danger" />
        <IconButton icon="settings" label="Configurações" variant="subtle" />
        <IconButton icon="check" label="Aceitar" tone="success" active variant="subtle" />
      </div>
      <div class="row-items">
        <IconButton icon="pencil" label="28 px" size="sm" />
        <IconButton icon="pencil" label="32 px" />
        <IconButton icon="pencil" label="36 px" size="lg" />
        <IconButton icon="pencil" label="40 px" size="xl" />
      </div>
      <div class="glass-demo">
        <IconButton icon="volume" label="Som" variant="glass" />
        <IconButton icon="activity" label="Estatísticas" variant="glass" active />
        <IconButton icon="pip" label="Janela flutuante" variant="glass" />
        <IconButton icon="x" label="Parar" variant="glass" tone="danger" />
      </div>
    </section>

    <section class="card">
      <h2>Campos</h2>
      <div class="stack">
        <TextField label="Apelido" value="Lucas" />
        <TextField label="Buscar" icon="search" placeholder="Buscar amigos" />
        <TextField label="Convite" mono value="RSNH-7Q2K" error="Esse convite venceu." />
        <Select label="Microfone" value="default" options={[{ value: 'default', label: 'Padrão do sistema' }]} />
      </div>
    </section>

    <section class="card">
      <h2>Escolhas</h2>
      <div class="stack">
        <div class="row-items"><Switch checked /><Switch /><Switch checked disabled /><Switch size="sm" checked /></div>
        <Segmented
          bind:value={segmented}
          options={[
            { value: 'a', label: 'Forte' },
            { value: 'b', label: 'Leve' },
            { value: 'c', label: 'Desligada' },
          ]}
        />
        <Segmented
          value="motion"
          options={[
            { value: 'motion', label: 'Fluidez', hint: 'Jogos e vídeos' },
            { value: 'detail', label: 'Nitidez', hint: 'Texto e código' },
          ]}
        />
        <Tabs
          bind:value={tab}
          tabs={[
            { value: 'online', label: 'Online' },
            { value: 'all', label: 'Todos' },
            { value: 'pending', label: 'Pendentes', count: 2, alert: true },
          ]}
        />
        <div class="radio-card">
          <RadioGroup
            bind:value={radio}
            options={[
              { value: 'one', label: 'Qualquer pessoa', description: 'Use quando cada opção pede uma frase.' },
              { value: 'two', label: 'Só amigos' },
            ]}
          />
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Níveis</h2>
      <div class="stack">
        <Slider bind:value={slider} label="Volume" />
        <Meter level={0.62} passing />
        <Meter level={0.3} bind:threshold />
        <div class="row-items">
          <SignalBars rtt={24} route="direto" />
          <SignalBars rtt={120} route="direto" />
          <SignalBars rtt={260} route="relay" />
          <SignalBars rtt={null} />
          <Spinner />
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Pessoas</h2>
      <div class="row-items">
        <Avatar id="u-a" name="Bia" size={24} status="online" cutout="var(--bg-raised)" />
        <Avatar id="u-b" name="Rafa" size={32} status="dnd" cutout="var(--bg-raised)" />
        <Avatar id="u-c" name="Duda" size={40} status="idle" cutout="var(--bg-raised)" />
        <Avatar id="u-d" name="Thiago Mendes" size={48} status="offline" cutout="var(--bg-raised)" />
        <Avatar id="u-e" name="Gabi" size={48} speaking cutout="var(--bg-raised)" />
        <Avatar id="g-a" name="Mesa de RPG" size={48} square />
      </div>
      <div class="row-items">
        <StatusDot status="online" cutout="var(--bg-raised)" /> Online
        <StatusDot status="idle" cutout="var(--bg-raised)" /> Ausente
        <StatusDot status="dnd" cutout="var(--bg-raised)" /> Não perturbe
        <StatusDot status="offline" cutout="var(--bg-raised)" /> Offline
      </div>
      <div class="row-items">
        <Badge>Você</Badge>
        <Badge tone="accent">Admin</Badge>
        <Badge tone="success">Este aparelho</Badge>
        <Badge tone="warning">Aviso</Badge>
        <Badge tone="danger">Banido</Badge>
        <Badge tone="count">3</Badge>
        <Badge tone="live">AO VIVO</Badge>
        <Badge dot="#a99bff">Moderação</Badge>
      </div>
      <div class="row-items"><Kbd keys="Ctrl + Shift + M" /><Kbd keys="Esc" /></div>
    </section>

    <section class="card">
      <h2>Flutuantes</h2>
      <div class="floating">
        <Menu
          inline
          width={220}
          items={[
            { label: 'Responder', icon: 'reply' },
            { label: 'Fixar', icon: 'pin', hint: 'P' },
            { label: 'Copiar texto', icon: 'copy' },
            { kind: 'separator' },
            { label: 'Apagar', icon: 'trash', danger: true },
          ]}
        />
        <div class="column">
          <span class="fake-tooltip">Mutar <kbd>Ctrl Shift M</kbd></span>
          <div class="fake-toast"><Icon name="circle-alert" size={18} />A mensagem não foi enviada.</div>
          <div class="fake-toast info"><Icon name="info" size={18} />Este Windows manda o som da call junto.</div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Linhas de configuração</h2>
      <Section>
        <Row label="Sons do app" description="Entrar e sair da call, mutar e transmissões.">
          <Switch checked />
        </Row>
        <Row label="Volume" indent><div class="w160"><Slider value={0.6} label="Volume" /></div></Row>
        <Row label="Sair da conta"><Button variant="danger-soft" icon="log-out">Sair</Button></Row>
      </Section>
    </section>

    <section class="card">
      <h2>Estado vazio</h2>
      <EmptyState icon="inbox" title="Nada fixado ainda" description="Fixe mensagens importantes pra achar depois." />
    </section>
  </div>
</div>

<style>
  .gallery {
    height: 100%;
    padding: 40px 40px 80px;
    overflow-y: auto;
    background:
      radial-gradient(700px 400px at 0% 0%, rgb(111 125 255 / 0.08), transparent 70%),
      var(--bg-canvas);
  }

  .intro {
    max-width: 1100px;
    margin: 0 auto 24px;
  }

  .intro h1 {
    font-size: var(--text-3xl);
    font-weight: 650;
    letter-spacing: -0.025em;
  }

  .intro p {
    margin-top: 6px;
    color: var(--fg-2);
  }

  code {
    padding: 1px 5px;
    border-radius: var(--r-xs);
    background: rgb(255 255 255 / 0.07);
    font: 12.5px var(--mono);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    max-width: 1100px;
    margin: 0 auto;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px;
    border-radius: var(--r-xl);
    background: var(--bg-panel);
    box-shadow:
      0 0 0 1px var(--line),
      var(--highlight);
  }

  .card :global(.card) {
    background: var(--bg-raised);
  }

  .wide {
    grid-column: 1 / -1;
  }

  h2 {
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 12px;
  }

  .swatch {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .chip {
    height: 44px;
    border-radius: var(--r-lg);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .token {
    font: 11.5px var(--mono);
    color: var(--fg);
  }

  .name {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .type-row {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }

  .type-meta {
    width: 34px;
    color: var(--fg-3);
    font: 11px var(--mono);
  }

  .mono {
    font-size: 13px;
  }

  .icons {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 4px;
  }

  .icon {
    display: grid;
    place-items: center;
    height: 36px;
    border-radius: var(--r-md);
    color: var(--fg-2);
  }

  .icon:hover {
    background: var(--hover);
    color: var(--fg);
  }

  .row-items {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .glass-demo {
    display: flex;
    gap: 2px;
    width: fit-content;
    padding: 4px;
    border-radius: var(--r-xl);
    background:
      linear-gradient(135deg, rgb(111 125 255 / 0.5), rgb(255 90 122 / 0.4)),
      #222;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.09);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .radio-card {
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow: 0 0 0 1px var(--line);
  }

  .floating {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .column {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .fake-tooltip {
    padding: 6px 10px;
    border-radius: var(--r-md);
    background: var(--bg-overlay);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-md);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .fake-tooltip kbd {
    margin-left: 6px;
    color: var(--fg-3);
    font: 500 11px var(--mono);
  }

  .fake-toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 16px 11px 12px;
    border-radius: var(--r-lg);
    background: #1f1f28;
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-lg);
    font-size: var(--text-sm);
  }

  .fake-toast :global(svg) {
    color: var(--red);
  }

  .fake-toast.info :global(svg) {
    color: var(--accent-fg);
  }

  .w160 {
    width: 160px;
  }
</style>
