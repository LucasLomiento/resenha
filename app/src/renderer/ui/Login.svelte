<script lang="ts">
  import { onMount } from 'svelte'
  import { Api } from '../lib/api'
  import { DEFAULT_SERVER, store } from '../lib/store.svelte'
  import logo from '../../../build/icon.svg?url'
  import { Button, Icon, TextField } from './kit'

  const server = DEFAULT_SERVER
  let mode = $state<'login' | 'register'>('login')
  let name = $state('')
  let password = $state('')
  let invite = $state('')
  let needsInvite = $state(true)
  let busy = $state(false)
  let error = $state('')

  const subtitle = $derived(
    mode === 'login'
      ? 'Que bom te ver de novo.'
      : needsInvite
        ? 'Crie sua conta com o convite que te mandaram.'
        : 'Servidor novo: esta conta vira a do admin.',
  )

  async function checkServer() {
    try {
      const status = await new Api(server).status()
      needsInvite = status.needsInvite
      // Servidor vazio: a primeira conta vira a do admin.
      if (!status.needsInvite) mode = 'register'
    } catch {
      // erro aparece no envio
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const url = server
    busy = true
    error = ''
    try {
      const api = new Api(url)
      const auth = mode === 'login' ? await api.login(name, password) : await api.register(name, password, invite)
      await store.start({ server: url, token: auth.token })
    } catch (err) {
      error = (err as Error).message
      // Alguém criou a primeira conta enquanto esta tela estava aberta: agora precisa de convite.
      if ((err as { status?: number }).status === 403) needsInvite = true
    } finally {
      busy = false
    }
  }

  function switchMode() {
    mode = mode === 'login' ? 'register' : 'login'
    error = ''
  }

  // Servidor novo (sem contas) já abre em "criar conta". Enquanto estiver
  // sem contas, confere de novo: alguém pode criar a primeira nesse meio-tempo.
  onMount(() => {
    checkServer()
    const timer = setInterval(() => !needsInvite && checkServer(), 4000)
    return () => clearInterval(timer)
  })
</script>

<div class="screen">
  <div class="glow" aria-hidden="true"></div>

  <form class="card" onsubmit={submit}>
    <img class="logo" src={logo} alt="" width="56" height="56" draggable="false" />
    <h1>{mode === 'login' ? 'Entrar no Resenha' : 'Criar conta'}</h1>
    <p class="sub">{subtitle}</p>

    <div class="fields">
      <TextField label="Apelido" size="lg" bind:value={name} autocomplete="username" required minlength={2} maxlength={32} spellcheck={false} />
      <TextField
        label="Senha"
        size="lg"
        type="password"
        bind:value={password}
        autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
        required
        minlength={mode === 'register' ? 6 : 1}
        hint={mode === 'register' ? 'Pelo menos 6 caracteres.' : undefined}
      />
      {#if mode === 'register' && needsInvite}
        <TextField label="Convite" size="lg" mono bind:value={invite} required spellcheck={false} autocomplete="off" />
      {/if}
    </div>

    {#if error}
      <p class="error" role="alert"><Icon name="circle-alert" size={16} />{error}</p>
    {/if}

    <Button variant="primary" size="lg" type="submit" full loading={busy}>
      {mode === 'login' ? 'Entrar' : 'Criar conta'}
    </Button>
  </form>

  <p class="switch">
    {mode === 'login' ? 'Recebeu um convite?' : 'Já tem conta?'}
    <button type="button" onclick={switchMode}>{mode === 'login' ? 'Criar conta' : 'Entrar'}</button>
  </p>
</div>

<style>
  .screen {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-5);
    padding: var(--s-6);
    overflow: auto;
    background: var(--bg-canvas);
  }

  /* Brilho da marca atrás do cartão: violeta em cima, coral embaixo. */
  .glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(520px 340px at calc(50% - 160px) calc(50% - 170px), rgb(111 125 255 / 0.2), transparent 70%),
      radial-gradient(460px 320px at calc(50% + 190px) calc(50% + 190px), rgb(255 90 122 / 0.12), transparent 70%),
      radial-gradient(400px 300px at calc(50% + 120px) calc(50% - 60px), rgb(145 80 255 / 0.1), transparent 70%);
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 380px;
    max-width: 100%;
    padding: 32px;
    border-radius: 22px;
    background: rgb(19 19 25 / 0.92);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
    animation: rs-pop-in var(--t-slow) var(--ease);
  }

  .logo {
    width: 56px;
    height: 56px;
    margin-bottom: var(--s-5);
    filter: drop-shadow(0 8px 20px rgb(145 80 255 / 0.35));
  }

  h1 {
    font-size: var(--text-2xl);
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .sub {
    margin-top: 6px;
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

  .switch {
    position: relative;
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .switch button {
    margin-left: 4px;
    color: var(--accent-fg);
    font-weight: 550;
  }

  .switch button:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
