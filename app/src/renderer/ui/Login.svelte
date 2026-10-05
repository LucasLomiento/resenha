<script lang="ts">
  import { onMount } from 'svelte'
  import { Api } from '../lib/api'
  import { DEFAULT_SERVER, store } from '../lib/store.svelte'
  import logo from '../../../build/icon.svg?url'

  const server = DEFAULT_SERVER
  let mode = $state<'login' | 'register'>('login')
  let name = $state('')
  let password = $state('')
  let invite = $state('')
  let needsInvite = $state(true)
  let busy = $state(false)
  let error = $state('')

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

  // Servidor novo (sem contas) já abre em "criar conta". Enquanto estiver
  // sem contas, confere de novo: alguém pode criar a primeira nesse meio-tempo.
  onMount(() => {
    checkServer()
    const timer = setInterval(() => !needsInvite && checkServer(), 4000)
    return () => clearInterval(timer)
  })
</script>

<div class="screen">
  <form class="card" onsubmit={submit}>
    <img class="logo" src={logo} alt="" width="72" height="72" />
    <h1>Resenha</h1>
    <p class="sub">
      {mode === 'login' ? 'Bem-vindo de volta.' : needsInvite ? 'Entre com o convite que te mandaram.' : 'Servidor novo: esta conta vira a do admin.'}
    </p>

    <label>
      <span class="label">Apelido</span>
      <input class="field" bind:value={name} autocomplete="username" required minlength="2" maxlength="32" />
    </label>

    <label>
      <span class="label">Senha</span>
      <input
        class="field"
        type="password"
        bind:value={password}
        autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
        required
        minlength={mode === 'register' ? 6 : 1}
      />
    </label>

    {#if mode === 'register' && needsInvite}
      <label>
        <span class="label">Convite</span>
        <input class="field" bind:value={invite} required spellcheck="false" />
      </label>
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    <button class="btn" type="submit" disabled={busy}>
      {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
    </button>

    <button type="button" class="switch" onclick={() => (mode = mode === 'login' ? 'register' : 'login')}>
      {mode === 'login' ? 'Tenho um convite, quero criar conta' : 'Já tenho conta'}
    </button>
  </form>
</div>

<style>
  .screen {
    height: 100%;
    display: grid;
    place-items: center;
    background:
      radial-gradient(1200px 600px at 20% -10%, rgb(124 140 255 / 0.18), transparent 60%),
      radial-gradient(900px 500px at 110% 110%, rgb(63 191 127 / 0.12), transparent 60%),
      var(--bg-deep);
  }

  .card {
    width: 380px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 32px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.45);
  }

  .logo {
    align-self: center;
    margin-bottom: -4px;
  }

  h1 {
    margin: 0;
    text-align: center;
    font-size: 26px;
    letter-spacing: -0.02em;
  }

  .sub {
    text-align: center;
    margin: -8px 0 4px;
    color: var(--text-dim);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .error {
    margin: 0;
    color: var(--red);
  }

  .switch {
    color: var(--text-dim);
    font-size: 13px;
  }

  .switch:hover {
    color: var(--text);
    text-decoration: underline;
  }
</style>
