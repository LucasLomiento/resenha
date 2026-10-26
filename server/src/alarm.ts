// Armar o alarme de um Durable Object.
//
// Um alarme que falha sete vezes seguidas (a primeira e as seis novas tentativas do Cloudflare)
// não dispara mais, mas continua marcado: o `getAlarm()` devolve aquela hora, já no passado.
// Em 25/10/2026, com a cota do dia estourada, todo alarme falhou e sete objetos (o `main`
// inclusive) ficaram sem varredura até o deploy seguinte, porque quem arma só armava se não
// tivesse nenhum (ou um mais tarde). Atrasado mais que `STUCK_AFTER` conta como sem alarme.
const STUCK_AFTER = 60_000

/** Arma o alarme pra `when`, a não ser que já tenha um antes disso que ainda vá disparar. */
export async function armAlarm(storage: DurableObjectStorage, when: number, now = Date.now()) {
  const at = await storage.getAlarm()
  if (at === null || at > when || at < now - STUCK_AFTER) await storage.setAlarm(when)
}
