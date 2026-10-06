// Endereço de cada Durable Object. Todos nascem na América do Sul (perto de quem usa).

const near = { locationHint: 'sam' } as const

/** O cadastro central (um só). */
export function directory(env: Env) {
  return env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'), near)
}

/** Um servidor ("main" é o servidor do grupo que veio da 0.5). */
export function guild(env: Env, guildId: string) {
  return env.GUILD.get(env.GUILD.idFromName(guildId), near)
}

/** A conexão pessoal de cada pessoa: DMs, amigos, status. */
export function home(env: Env, userId: string) {
  return env.HOME.get(env.HOME.idFromName(userId), near)
}

/** Uma conversa privada (`dm:<id menor>:<id maior>`). */
export function conversation(env: Env, channelId: string) {
  return env.CONVERSATION.get(env.CONVERSATION.idFromName(channelId), near)
}
