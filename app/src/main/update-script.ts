// O script que roda no terminal quando a atualização do `.pacman` precisa do sudo (sem pkexec ou
// sem agente do polkit). Fica fora do `updater.ts` (que puxa o Electron) pra dar pra conferir a
// sintaxe num teste: de 0.2.0 a 1.18.0 ele tinha um `&;` que o bash recusa, então o terminal
// abria e fechava com erro, o app já tinha saído e nada era instalado.

const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

export interface TerminalUpdate {
  /** O que aparece antes de pedir a senha. */
  prompt: string
  /** O que aparece se o pacman falhar (a pessoa aperta Enter pra seguir). */
  failed: string
  /** O pacote baixado. */
  file: string
  /** O executável do app, pra abrir de novo no fim. */
  exec: string
  /**
   * Variáveis da sessão pra repassar ao app aberto pelo systemd (null: sem systemd, abre com
   * `setsid`). Pelo systemd o app novo não morre junto com a unidade do terminal quando ele fecha.
   */
  systemdEnv: string[] | null
}

/**
 * Instala e abre o app de novo. O app reabre de qualquer jeito, inclusive se a pessoa fechar o
 * terminal sem digitar a senha (a versão de antes volta, em vez de o Resenha ficar fechado).
 */
export function terminalUpdateScript(update: TerminalUpdate): string {
  const reopen = update.systemdEnv
    ? `systemd-run --user --collect --quiet ${update.systemdEnv.map((name) => `-E ${quote(name)}`).join(' ')} -- ${quote(update.exec)}`
    : `setsid ${quote(update.exec)} >/dev/null 2>&1 &\n  sleep 1`
  return [
    'reopen() {',
    `  ${reopen}`,
    '}',
    'trap reopen EXIT',
    "trap 'exit 1' HUP INT TERM",
    `echo ${quote(update.prompt)}`,
    // Se não der, mostra o erro em vez de fechar (e reabrir a versão velha) sem dizer nada.
    `sudo pacman -U --noconfirm ${quote(update.file)} || { echo; echo ${quote(update.failed)}; read -r _; }`,
  ].join('\n')
}
