<script lang="ts">
  import { HttpError } from '../../lib/api'
  import { client } from '../../lib/client.svelte'
  import { Button, Icon, PageHeader, Row, Section, TextField } from '../kit'

  const MIN = 8
  const TONES = ['empty', 'red', 'yellow', 'green', 'green'] as const

  let current = $state('')
  let next = $state('')
  let repeat = $state('')
  let repeatTouched = $state(false)
  let busy = $state(false)
  let currentError = $state<string | null>(null)
  let nextError = $state<string | null>(null)
  let formError = $state<string | null>(null)

  /** Força aproximada (0 a 4); quem decide mesmo é o servidor (senhas comuns, igual ao usuário). */
  function strength(password: string, username: string): { level: number; label: string } {
    if (!password) return { level: 0, label: `Pelo menos ${MIN} caracteres` }
    const missing = MIN - password.length
    if (missing > 0) return { level: 1, label: missing === 1 ? 'Falta 1 caractere' : `Faltam ${missing} caracteres` }
    if (password.toLowerCase() === username.toLowerCase() || /^(.)\1+$/.test(password)) return { level: 1, label: 'Fácil de adivinhar' }
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
    if (password.length >= 16 || (password.length >= 12 && kinds >= 3)) return { level: 4, label: 'Forte' }
    if (password.length >= 12 || (password.length >= 10 && kinds >= 3)) return { level: 3, label: 'Boa' }
    return { level: 2, label: 'Razoável' }
  }

  const meter = $derived(strength(next, client.me?.username ?? ''))
  // Erro só depois de sair do campo, ou já no primeiro caractere diferente.
  const repeatError = $derived(
    repeat && repeat !== next && (repeatTouched || !next.startsWith(repeat)) ? 'As senhas não são iguais.' : null,
  )
  const ready = $derived(!!current && next.length >= MIN && repeat === next)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const api = client.api
    if (!api || !ready || busy) return
    busy = true
    currentError = nextError = formError = null
    try {
      await api.changePassword(current, next)
      current = next = repeat = ''
      repeatTouched = false
      client.toast('Senha trocada. Os outros aparelhos saíram.', 'info')
    } catch (err) {
      const message = (err as Error).message
      const status = err instanceof HttpError ? err.status : 0
      if (status === 401) currentError = message
      else if (status === 400) nextError = message
      else formError = message
    } finally {
      busy = false
    }
  }
</script>

<PageHeader title="Senha" description="Trocar a senha desconecta os outros aparelhos." />

<Section setting="password.change">
  <Row stack>
    <form class="password" onsubmit={submit}>
      <!-- Pros gerenciadores de senha saberem de qual conta é. -->
      <input type="text" autocomplete="username" value={client.me?.username ?? ''} hidden readonly />
      <TextField
        label="Senha atual"
        type="password"
        bind:value={current}
        autocomplete="current-password"
        error={currentError}
        oninput={() => (currentError = null)}
      />
      <div class="new">
        <TextField
          label="Nova senha"
          type="password"
          bind:value={next}
          autocomplete="new-password"
          maxlength={256}
          error={nextError}
          oninput={() => (nextError = null)}
        />
        <div
          class="strength tone-{TONES[meter.level]}"
          role="meter"
          aria-label="Força da senha"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={meter.level}
          aria-valuetext={meter.label}
        >
          {#each [1, 2, 3, 4] as step (step)}<i class:on={meter.level >= step}></i>{/each}
          <span>{meter.label}</span>
        </div>
      </div>
      <TextField
        label="Repita a nova senha"
        type="password"
        bind:value={repeat}
        autocomplete="new-password"
        error={repeatError}
        onblur={() => (repeatTouched = true)}
      />
      {#if formError}
        <p class="error" role="alert"><Icon name="circle-alert" size={14} />{formError}</p>
      {/if}
      <div class="actions">
        <Button variant="primary" type="submit" loading={busy} disabled={!ready}>Trocar senha</Button>
      </div>
    </form>
  </Row>
</Section>

<style>
  .password {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    max-width: 360px;
  }

  .new {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .strength {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .strength i {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.1);
    transition: background-color var(--t) var(--ease);
  }

  .strength span {
    margin-left: 6px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .tone-red i.on {
    background: var(--red);
  }

  .tone-red span {
    color: var(--red);
  }

  .tone-yellow i.on {
    background: var(--yellow);
  }

  .tone-yellow span {
    color: var(--yellow);
  }

  .tone-green i.on {
    background: var(--green);
  }

  .tone-green span {
    color: var(--green);
  }

  .tone-empty span {
    font-weight: 400;
  }

  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--red);
    font-size: var(--text-xs);
  }

  .actions {
    display: flex;
    margin-top: 4px;
  }
</style>
