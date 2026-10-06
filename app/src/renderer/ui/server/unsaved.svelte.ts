/**
 * Alteração pendente numa tela de configurações: enquanto tiver, não dá pra
 * fechar nem trocar de página (ou de cargo); a barra de salvar chacoalha.
 */
export class Unsaved {
  dirty = $state(false)
  /** Conta as tentativas de sair: a barra reage a cada mudança. */
  nudge = $state(0)

  /** Quer sair: devolve true (e avisa) se tem algo por salvar. */
  blocked(): boolean {
    if (!this.dirty) return false
    this.nudge++
    return true
  }
}
