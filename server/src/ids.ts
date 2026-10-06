import { randomToken } from './auth'

let lastTime = 0

/**
 * Id ordenável pelo tempo (10 caracteres de data em base 36 + 8 aleatórios).
 * Dentro de um mesmo DO os ids nunca se repetem nem andam pra trás, o que
 * deixa paginar histórico só com `id < ?`.
 */
export function newId(): string {
  lastTime = Math.max(Date.now(), lastTime + 1)
  return lastTime.toString(36).padStart(10, '0') + randomToken(6)
}
