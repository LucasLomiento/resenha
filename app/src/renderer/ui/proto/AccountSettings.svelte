<script lang="ts">
  import {
    Avatar,
    Badge,
    Button,
    Icon,
    PageHeader,
    RadioGroup,
    Row,
    Section,
    SettingsLayout,
    TextField,
    type IconName,
    type SettingsNavEntry,
  } from '../kit'
  import { bannedUsers, me, relative, sessions } from './data'
  import ProfileCard from './ProfileCard.svelte'

  type Page = 'profile' | 'devices' | 'password' | 'privacy'
  let { page = 'profile' }: { page?: Page } = $props()
  /** Começa na página pedida; clicar na navegação troca (derivado gravável). */
  let current = $derived<string>(page)

  // Conta e app no mesmo lugar: as páginas de hoje (Voz e vídeo...) entram embaixo.
  const nav: SettingsNavEntry[] = [
    { heading: 'Conta' },
    { id: 'profile', label: 'Perfil', icon: 'user' },
    { id: 'devices', label: 'Aparelhos', icon: 'laptop' },
    { id: 'password', label: 'Senha', icon: 'key' },
    { id: 'privacy', label: 'Privacidade', icon: 'lock' },
    { heading: 'App' },
    { id: 'voice', label: 'Voz e vídeo', icon: 'mic' },
    { id: 'notifications', label: 'Notificações', icon: 'bell' },
    { id: 'shortcuts', label: 'Atalhos', icon: 'keyboard' },
    { id: 'app', label: 'Aplicativo', icon: 'sliders' },
    { separator: true },
    { id: 'logout', label: 'Sair da conta', icon: 'log-out', tone: 'danger' },
  ]

  const SWATCHES = ['#7c6cff', '#ff7a93', '#48b9ff', '#36d6ad', '#ffc35a', '#ee78dc', '#9edc66', null]
  const DEVICE_ICON: Record<string, IconName> = { desktop: 'monitor', laptop: 'laptop', phone: 'smartphone' }
  let dmPolicy = $state<'everyone' | 'servers' | 'friends'>('servers')
</script>

<SettingsLayout title="Configurações" {nav} active={current} onselect={(id) => (current = id)} onclose={() => {}} inline>
  {#if current === 'profile'}
    <PageHeader title="Perfil" />
    <div class="profile-box">
    <div class="profile">
      <div class="form">
        <Section>
          <Row stack label="Foto">
            <div class="photo">
              <Avatar id={me.id} name={me.name} size={72} cutout="var(--bg-raised)" />
              <div class="photo-actions">
                <Button size="sm" icon="upload">Trocar foto</Button>
                <Button size="sm" variant="ghost">Remover</Button>
              </div>
            </div>
          </Row>
          <Row stack>
            <TextField label="Nome de exibição" value={me.name} maxlength={32} hint="Como aparece nas conversas." />
          </Row>
          <Row stack>
            <TextField label="Nome de usuário" icon="at" value={me.username} mono hint="Único. Letras minúsculas, números, _ e ponto." />
          </Row>
          <Row stack>
            <label class="bio">
              <span>Sobre mim</span>
              <textarea rows="3" maxlength="190">{me.bio}</textarea>
              <small class="tabular">{me.bio.length}/190</small>
            </label>
          </Row>
          <Row stack label="Cor do perfil">
            <div class="swatches">
              {#each SWATCHES as color (color)}
                <button class="swatch" class:on={me.accent === color} class:none={!color} style:background={color} aria-label={color ?? 'Automática'}>
                  {#if me.accent === color}<Icon name="check" size={14} />{/if}
                </button>
              {/each}
            </div>
          </Row>
        </Section>
      </div>
      <div class="preview">
        <span class="preview-label">Prévia</span>
        <ProfileCard userId={me.id} actions={false} />
      </div>
    </div>
    </div>
  {:else if current === 'devices'}
    <PageHeader title="Aparelhos" description="Onde sua conta está conectada. Aparelho parado por 30 dias sai sozinho." />
    <Section>
      {#each sessions as session (session.id)}
        <Row label={session.device} description="{session.country} · {session.current ? 'agora' : relative(session.lastSeenAt)}">
          {#snippet leading()}<span class="device"><Icon name={DEVICE_ICON[session.kind]} size={18} /></span>{/snippet}
          {#if session.current}
            <Badge tone="success">Este aparelho</Badge>
          {:else}
            <Button size="sm">Sair</Button>
          {/if}
        </Row>
      {/each}
    </Section>
    <Section>
      <Row label="Sair de todos os outros" description="Só este aparelho continua conectado.">
        <Button variant="danger-soft" icon="log-out">Sair dos outros</Button>
      </Row>
    </Section>
  {:else if current === 'password'}
    <PageHeader title="Senha" description="Trocar a senha desconecta os outros aparelhos." />
    <Section>
      <Row stack>
        <div class="password">
          <TextField label="Senha atual" type="password" value="senha-antiga" autocomplete="current-password" />
          <TextField label="Nova senha" type="password" value="uma-senha-bem-longa" autocomplete="new-password" />
          <div class="strength" aria-label="Senha forte">
            <i class="on"></i><i class="on"></i><i class="on"></i><i></i>
            <span>Forte</span>
          </div>
          <TextField label="Repita a nova senha" type="password" value="uma-senha-bem-long" error="As senhas não são iguais." autocomplete="new-password" />
          <div class="password-actions"><Button variant="primary">Trocar senha</Button></div>
        </div>
      </Row>
    </Section>
  {:else if current === 'privacy'}
    <PageHeader title="Privacidade" />
    <Section title="Quem pode te mandar mensagem privada">
      <RadioGroup
        label="Quem pode te mandar mensagem privada"
        bind:value={dmPolicy}
        options={[
          { value: 'everyone', label: 'Qualquer pessoa' },
          { value: 'servers', label: 'Quem está nos meus servidores' },
          { value: 'friends', label: 'Só amigos' },
        ]}
      />
    </Section>
    <Section title="Bloqueados" description="Não te mandam mensagem nem te veem online.">
      {#each Object.values(bannedUsers).slice(0, 1) as blocked (blocked.id)}
        <Row label={blocked.name} description={blocked.username}>
          {#snippet leading()}<Avatar id={blocked.id} name={blocked.name} size={32} cutout="var(--bg-raised)" />{/snippet}
          <Button size="sm">Desbloquear</Button>
        </Row>
      {/each}
    </Section>
    <Section title="Seus dados">
      <Row label="Baixar meus dados" description="Perfil, mensagens e arquivos num .zip.">
        <Button icon="download">Pedir cópia</Button>
      </Row>
      <Row label="Excluir conta" description="Sai de todos os servidores. Suas mensagens ficam como “Usuário excluído”.">
        <Button variant="danger-soft" icon="trash">Excluir</Button>
      </Row>
    </Section>
  {:else}
    <PageHeader title="(igual ao app de hoje)" description="Estas páginas já existem em ui/settings; na arquitetura nova, só mudam de lugar." />
  {/if}
</SettingsLayout>

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

  .photo-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .bio {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }

  .bio span {
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .bio textarea {
    padding: 10px 12px;
    border: 0;
    border-radius: var(--r-lg);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--fg);
    resize: none;
    outline: none;
  }

  .bio small {
    position: absolute;
    right: 10px;
    bottom: 8px;
    color: var(--fg-3);
    font-size: var(--text-2xs);
  }

  .swatches {
    display: flex;
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
  }

  .swatch.on {
    box-shadow:
      0 0 0 2px var(--bg-raised),
      0 0 0 4px var(--fg);
  }

  .swatch.none {
    background: conic-gradient(from 90deg, #8b7bff, #ff7a93, #ffc35a, #36d6ad, #48b9ff, #8b7bff);
    opacity: 0.8;
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

  .device {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.06);
    color: var(--fg-2);
  }

  .password {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    max-width: 360px;
  }

  .strength {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: -6px;
  }

  .strength i {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.1);
  }

  .strength i.on {
    background: var(--green);
  }

  .strength span {
    margin-left: 6px;
    color: var(--green);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .password-actions {
    display: flex;
    margin-top: 4px;
  }
</style>
