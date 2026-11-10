import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { terminalUpdateScript } from '../src/main/update-script.ts'

const base = {
  prompt: "Atualizando o Resenha pra versão 1.18.1. Digite sua senha:",
  failed: "Não deu pra atualizar. Aperte Enter pra abrir o Resenha.",
  file: "/home/fulano/.cache/resenha-updater/pending/Resenha-1.18.1-x64.pacman",
  exec: '/opt/Resenha/resenha',
}

/** O bash aceita o script? (`-n`: só confere a sintaxe, não roda nada.) */
const parses = (script: string) => execFileSync('bash', ['-n', '-c', script], { stdio: 'pipe' })

test('o script da atualização pelo terminal é bash válido, com ou sem systemd (tinha um "&;" que o bash recusa)', () => {
  for (const systemdEnv of [['WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'PATH'], [], null]) {
    const script = terminalUpdateScript({ ...base, systemdEnv })
    assert.doesNotThrow(() => parses(script), script)
    assert.ok(!/&\s*;/.test(script), script)
  }
})

test('caminho e texto com aspas, espaço ou cifrão não quebram nem viram comando', () => {
  const script = terminalUpdateScript({
    prompt: `versão "2" de $(rm -rf ~) do 'teste'`,
    failed: "não deu; `whoami`",
    file: "/tmp/pasta com espaço/Resenha 'novo' $HOME.pacman",
    exec: "/opt/Resenha (teste)/resenha",
    systemdEnv: ['DISPLAY'],
  })
  assert.doesNotThrow(() => parses(script), script)
  // Tudo que veio de fora fica dentro de aspas simples.
  assert.ok(script.includes(`'/tmp/pasta com espaço/Resenha '\\''novo'\\'' $HOME.pacman'`), script)
})

test('o app abre de novo de qualquer jeito (inclusive se o terminal for fechado), e pelo systemd quando tem', () => {
  const withSystemd = terminalUpdateScript({ ...base, systemdEnv: ['DISPLAY', 'PATH'] })
  assert.match(withSystemd, /trap reopen EXIT/)
  assert.match(withSystemd, /trap 'exit 1' HUP INT TERM/)
  assert.match(withSystemd, /systemd-run --user --collect --quiet -E 'DISPLAY' -E 'PATH' -- '\/opt\/Resenha\/resenha'/)
  assert.ok(!withSystemd.includes('setsid'))
  const without = terminalUpdateScript({ ...base, systemdEnv: null })
  assert.match(without, /setsid '\/opt\/Resenha\/resenha' >\/dev\/null 2>&1 &\n\s+sleep 1/)
  // O pacman vem depois do aviso e antes de reabrir (o `trap` roda no fim).
  assert.ok(without.indexOf('sudo pacman -U --noconfirm') > without.indexOf('echo '))
})
