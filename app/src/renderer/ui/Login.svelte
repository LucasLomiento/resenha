<script lang="ts">
  import { onMount } from 'svelte'
  import type { InvitePreview } from '../../../../shared/protocol'
  import { Api } from '../lib/api'
  import { client, DEFAULT_SERVER, inviteCode } from '../lib/client.svelte'
  import { m } from '../lib/i18n.svelte'
  import { Avatar, Button, Icon, Mascot, TextField } from './kit'
  import Showcase from './login/Showcase.svelte'

  const server = DEFAULT_SERVER
  let mode = $state<'login' | 'register'>('login')
  let username = $state('')
  let name = $state('')
  let password = $state('')
  let invite = $state(client.pendingInvite ?? '')
  let needsInvite = $state(true)
  let open = $state(false)
  /** Servidor sem contas: a primeira vira a dona da plataforma. */
  let empty = $state(false)
  /** A pessoa escolheu entrar ou criar conta: a tela não troca mais sozinha. */
  let chosen = false
  let busy = $state(false)
  let error = $state('')

  // O mascote ri de vez em quando (e enquanto entra).
  let laughing = $state(false)

  onMount(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => {
      laughing = true
      setTimeout(() => (laughing = false), 2400)
    }, 8000)
    return () => clearInterval(timer)
  })
  let preview = $state<InvitePreview | null>(null)

  const t = $derived(m.app.login)
  /**
   * Cadastro aberto sem convite passa pela verificação anti-robô (Turnstile), que só existe
   * no computador: no celular, o convite continua obrigatório.
   */
  const robotCheck = $derived(open && !client.platform?.mobile)
  const subtitle = $derived(
    mode === 'login'
      ? t.loginSub
      : empty
        ? t.firstAccount
        : robotCheck
          ? t.openSignup
          : t.inviteSignup,
  )

  async function checkServer() {
    try {
      const status = await new Api(server).status()
      needsInvite = status.needsInvite
      open = status.signup === 'open'
      // Com o cadastro aberto o needsInvite também vem false, mas aí a plataforma já tem dono:
      // vazio é só sem convite E sem cadastro aberto. (Antes, o cadastro aberto jogava a tela
      // pra "criar conta" de 4 em 4 segundos, mesmo depois de a pessoa escolher "Entrar".)
      empty = !status.needsInvite && !open
      // Servidor vazio ou veio de um link de convite: abre em "criar conta" (só se a pessoa não escolheu).
      if (!chosen && (empty || client.pendingInvite)) mode = 'register'
    } catch {
      // erro aparece no envio
    }
  }

  // Convite colado (código ou link): mostra pra onde a pessoa vai entrar.
  let lastCode = ''
  $effect(() => {
    const code = inviteCode(invite)
    if (code === lastCode) return
    lastCode = code
    preview = null
    if (code.length < 4) return
    const timer = setTimeout(async () => {
      try {
        const found = await new Api(server).invitePreview(code)
        if (inviteCode(invite) === code) preview = found
      } catch {
        // convite inválido: o erro aparece no envio
      }
    }, 300)
    return () => clearTimeout(timer)
  })

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    error = ''
    try {
      const api = new Api(server)
      let auth
      if (mode === 'login') {
        auth = await api.login(username.trim(), password)
      } else {
        const code = inviteCode(invite)
        // Cadastro aberto sem convite: a verificação anti-robô abre numa janelinha.
        const turnstileToken = !code && robotCheck ? await window.resenha.turnstile(server) : null
        if (!code && robotCheck && !turnstileToken) {
          error = t.robot
          return
        }
        auth = await api.register({
          username: username.trim().toLowerCase(),
          name: name.trim() || username.trim(),
          password,
          invite: code || undefined,
          turnstileToken: turnstileToken ?? undefined,
        })
        client.pendingInvite = null
      }
      await client.start({ server, token: auth.token, userId: auth.user.id })
    } catch (err) {
      error = (err as Error).message
      // Alguém criou a primeira conta enquanto esta tela estava aberta: agora precisa de convite.
      if ((err as { status?: number }).status === 403) {
        needsInvite = true
        empty = false
      }
    } finally {
      busy = false
    }
  }

  function setMode(next: 'login' | 'register') {
    chosen = true
    if (mode === next) return
    mode = next
    error = ''
  }

  // Servidor novo (sem contas) já abre em "criar conta". Enquanto estiver
  // sem contas, confere de novo: alguém pode criar a primeira nesse meio-tempo.
  onMount(() => {
    checkServer()
    const timer = setInterval(() => empty && checkServer(), 4000)
    return () => clearInterval(timer)
  })
</script>

<div class="screen">
  <div class="glow" aria-hidden="true"></div>

  <!-- A marca à esquerda (some em janela estreita); o formulário à direita. -->
  <section class="brand" aria-hidden="true">
    <div class="lockup">
      <Mascot size={96} laughing={laughing || busy} class="brand-logo" />
      <p class="wordmark">Resenha</p>
    </div>
    <p class="tagline">{t.tagline}</p>
    <p class="pitch">{t.pitch}</p>
    <Showcase />
  </section>

  <div class="side">
  <!-- Janela estreita (sem a marca do lado): o mascote e o nome no meio, em cima do cartão. -->
  <div class="compact-brand" aria-hidden="true">
    <Mascot size={64} laughing={laughing || busy} />
    <p class="compact-wordmark">Resenha</p>
  </div>
  <form class="card" onsubmit={submit}>
    <!-- Entrar ou criar conta: sempre à vista qual dos dois está aberto (e só muda pela pessoa). -->
    <div class="tabs" role="tablist" aria-label={t.modes}>
      <button type="button" role="tab" aria-selected={mode === 'login'} onclick={() => setMode('login')}>{t.submit}</button>
      <button type="button" role="tab" aria-selected={mode === 'register'} onclick={() => setMode('register')}>{t.register}</button>
      <span class="tab-thumb" class:right={mode === 'register'} aria-hidden="true"></span>
    </div>
    <h1>{mode === 'login' ? t.loginHeading : t.registerHeading}</h1>
    <p class="sub">{subtitle}</p>

    {#if mode === 'register' && preview}
      <div class="invite">
        <Avatar id={preview.guild.id} name={preview.guild.name} size={40} square src={new Api(server).media(preview.guild.icon)} cutout="var(--bg-raised)" />
        <div>
          <span class="invite-label">{preview.inviter ? t.invitedBy(preview.inviter.name) : t.invited}</span>
          <strong>{preview.guild.name}</strong>
        </div>
      </div>
    {/if}

    <div class="fields">
      <TextField
        label={t.username}
        size="lg"
        bind:value={username}
        autocomplete="username"
        required
        minlength={2}
        maxlength={mode === 'login' ? 64 : 32}
        spellcheck={false}
        hint={mode === 'register' ? t.usernameHint : undefined}
      />
      {#if mode === 'register'}
        <TextField label={t.displayName} size="lg" bind:value={name} maxlength={32} placeholder={username || undefined} hint={t.displayNameHint} />
      {/if}
      <TextField
        label={t.password}
        size="lg"
        type="password"
        bind:value={password}
        autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
        required
        minlength={mode === 'register' ? 8 : 1}
        hint={mode === 'register' ? t.passwordHint : undefined}
      />
      {#if mode === 'register' && (needsInvite || open)}
        <TextField
          label={robotCheck ? t.inviteOptional : t.invite}
          size="lg"
          mono
          bind:value={invite}
          required={!robotCheck}
          spellcheck={false}
          autocomplete="off"
          placeholder={t.invitePlaceholder}
        />
      {/if}
    </div>

    {#if error}
      <p class="error" role="alert"><Icon name="circle-alert" size={16} />{error}</p>
    {/if}

    <Button variant="primary" size="lg" type="submit" full loading={busy}>
      {mode === 'login' ? t.submit : t.register}
    </Button>
  </form>

  </div>
</div>

<style>
  .screen {
    position: relative;
    height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(420px, 0.9fr);
    overflow: auto;
    background: var(--bg-canvas);
  }

  /* A luz azul atrás da marca, e um resto dela no alto do lado do formulário. */
  .glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(560px 420px at 16% 34%, rgb(var(--accent-rgb) / 0.075), transparent 70%),
      radial-gradient(420px 360px at 84% 10%, rgb(var(--accent-rgb) / 0.035), transparent 70%);
  }

  .brand {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 14px;
    min-width: 0;
    padding: 48px 32px 48px clamp(40px, 8vw, 120px);
  }

  .lockup {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .lockup :global(.brand-logo) {
    margin: -6px 0 -6px -10px;
    filter: drop-shadow(0 18px 40px rgb(var(--accent-rgb) / 0.3));
  }

  .wordmark {
    font-family: var(--font-display);
    font-size: clamp(48px, 5.4vw, 84px);
    font-weight: 750;
    letter-spacing: -0.045em;
    line-height: 0.92;
    background: linear-gradient(180deg, #ffffff 30%, #c4c6d0);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .tagline {
    font-family: var(--font-display);
    font-size: clamp(22px, 2.2vw, 28px);
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--fg);
  }

  .pitch {
    max-width: 420px;
    text-wrap: pretty;
    color: var(--fg-2);
    font-size: var(--text-lg);
    line-height: 1.5;
  }

  .side {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-5);
    padding: var(--s-6);
  }

  /* Janela estreita: só o formulário, no meio. */
  @media (max-width: 960px) {
    .screen {
      grid-template-columns: minmax(0, 1fr);
    }

    .brand {
      display: none;
    }
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 400px;
    max-width: 100%;
    padding: 36px;
    border-radius: var(--r-2xl);
    background: rgb(17 17 19 / 0.86);
    backdrop-filter: blur(18px);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    animation: rs-pop-in var(--t-slow) var(--ease);
  }

  .compact-brand {
    display: none;
    align-items: center;
    gap: 10px;
    margin-bottom: -4px;
  }

  .compact-brand :global(.mascot) {
    filter: drop-shadow(0 12px 28px rgb(var(--accent-rgb) / 0.3));
  }

  .compact-wordmark {
    font-family: var(--font-display);
    font-size: 40px;
    font-weight: 750;
    letter-spacing: -0.04em;
    line-height: 1;
    background: linear-gradient(180deg, #ffffff 30%, #c4c6d0);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  @media (max-width: 960px) {
    .compact-brand {
      display: flex;
    }
  }

  .tabs {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin-bottom: 26px;
    padding: 4px;
    border-radius: var(--r-full);
    background: var(--bg-input);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .tabs button {
    position: relative;
    z-index: 1;
    height: 34px;
    border-radius: var(--r-full);
    color: var(--fg-3);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
    transition: color var(--t) var(--ease);
  }

  .tabs button:hover,
  .tabs button[aria-selected='true'] {
    color: var(--fg);
  }

  .tab-thumb {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 4px;
    width: calc(50% - 4px);
    border-radius: var(--r-full);
    background: rgb(var(--tint-rgb) / 0.1);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.08),
      0 1px 3px rgb(0 0 0 / 0.45);
    transition: translate var(--t-slow) var(--ease);
  }

  .tab-thumb.right {
    translate: 100% 0;
  }

  h1 {
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.1;
  }

  .sub {
    margin-top: 8px;
    color: var(--fg-2);
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    margin: var(--s-6) 0;
  }

  .error {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    margin: calc(var(--s-2) * -1) 0 var(--s-4);
    padding: 10px 12px;
    border-radius: var(--r-lg);
    background: var(--red-soft);
    color: var(--red);
    font-size: var(--text-sm);
  }

  .error :global(svg) {
    margin-top: 1px;
  }

  .invite {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin-top: var(--s-5);
    padding: 12px;
    border-radius: var(--r-lg);
    background: var(--bg-raised);
    box-shadow: 0 0 0 1px var(--line);
  }

  .invite div {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .invite-label {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }

  .invite strong {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

</style>
