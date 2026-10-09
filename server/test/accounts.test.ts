import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { BASE, PASSWORD, api, call, createGuild, guildSocket, homeSocket, login, post, signup, world } from './helpers'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])

describe('cadastro e login', () => {
  it('a primeira conta é a dona da plataforma e as próximas precisam de convite', async () => {
    expect((await api('/api/status')).body).toEqual({ needsInvite: false, signup: 'invite', turnstileSiteKey: null })
    const owner = await signup('lucas')
    expect(owner.user.staff).toBe(true)
    expect(owner.user.username).toBe('lucas')
    expect((await api('/api/status')).body.needsInvite).toBe(true)

    expect((await post('/api/register', { username: 'outro', password: PASSWORD })).status).toBe(403)
    expect((await post('/api/register', { username: 'outro', password: PASSWORD, invite: 'chute' })).status).toBe(403)
  })

  it('confere nome de usuário e senha', async () => {
    await signup('lucas')
    const bad = async (username: string, password: string) => (await post('/api/register', { username, password })).body.error
    expect(await bad('Com Espaço', PASSWORD)).toMatch(/nome de usuário/)
    expect(await bad('admin', PASSWORD)).toMatch(/nome de usuário/)
    expect(await bad('a..b', PASSWORD)).toMatch(/nome de usuário/)
    expect(await bad('novo', 'curta')).toMatch(/8 caracteres/)
    expect(await bad('novo', '12345678')).toMatch(/fácil demais/)
    expect(await bad('novo', 'novo')).toMatch(/8 caracteres/)
  })

  it('nome de usuário não repete (nem com maiúscula)', async () => {
    const owner = await signup('lucas')
    const guild = await createGuild(owner.token)
    const s = await guildSocket(guild.id, owner.token)
    await s.next('ready')
    s.send({ t: 'invite.create' })
    const { code } = await s.next('invite.created')
    expect((await post('/api/register', { username: 'LUCAS', password: PASSWORD, invite: code })).status).toBe(409)
  })

  it('login com usuário e senha; erro não diz se o usuário existe', async () => {
    await signup('lucas')
    expect((await login('lucas')).status).toBe(200)
    expect((await login('LUCAS')).status).toBe(200)
    const wrong = await login('lucas', 'senha-errada-1')
    const missing = await login('ninguem', 'senha-errada-1')
    expect(wrong.status).toBe(401)
    expect(missing.status).toBe(401)
    expect(wrong.body.error).toBe(missing.body.error)
  })

  it('bloqueia depois de várias senhas erradas', async () => {
    await signup('lucas')
    for (let i = 0; i < 5; i++) expect((await login('lucas', `errada-${i}-xyz`)).status).toBe(401)
    const blocked = await login('lucas')
    expect(blocked.status).toBe(429)
    expect(blocked.body.error).toMatch(/Muitas tentativas/)
  })
})

describe('sessões', () => {
  it('lista os aparelhos e derruba um deles na hora', async () => {
    const first = await signup('lucas')
    const second = (await login('lucas')).body
    const sessions = await call('GET', '/api/me/sessions', undefined, first.token)
    expect(sessions.body).toHaveLength(2)
    expect(sessions.body.filter((s: any) => s.current)).toHaveLength(1)

    const home = await homeSocket(first.user.id, second.token)
    await home.next('ready')
    const other = sessions.body.find((s: any) => !s.current)
    expect((await call('DELETE', `/api/me/sessions/${other.id}`, undefined, first.token)).status).toBe(200)
    await home.next('session.revoked')
    expect(await home.closed()).toBe(4001)
    expect((await call('GET', '/api/me', undefined, second.token)).status).toBe(401)
    expect((await call('GET', '/api/me', undefined, first.token)).status).toBe(200)
  })

  it('trocar a senha derruba os outros aparelhos e pede a senha atual', async () => {
    const first = await signup('lucas')
    const second = (await login('lucas')).body
    expect((await post('/api/me/password', { current: 'errada-xyz-1', next: 'nova-senha-boa' }, first.token)).status).toBe(401)
    expect((await post('/api/me/password', { current: PASSWORD, next: 'nova-senha-boa' }, first.token)).status).toBe(200)
    expect((await call('GET', '/api/me', undefined, second.token)).status).toBe(401)
    expect((await call('GET', '/api/me', undefined, first.token)).status).toBe(200)
    expect((await login('lucas')).status).toBe(401)
    expect((await login('lucas', 'nova-senha-boa')).status).toBe(200)
  })

  it('sair invalida o token', async () => {
    const me = await signup('lucas')
    expect((await post('/api/logout', {}, me.token)).status).toBe(200)
    expect((await call('GET', '/api/me', undefined, me.token)).status).toBe(401)
  })
})

describe('perfil', () => {
  it('muda nome, bio, cor e quem pode mandar DM', async () => {
    const me = await signup('lucas')
    const res = await call('PATCH', '/api/me', { name: 'Lucas L.', bio: 'oi\ntudo bem', accent: 0x5865f2, dmPolicy: 'friends' }, me.token)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ name: 'Lucas L.', bio: 'oi\ntudo bem', accent: 0x5865f2, dmPolicy: 'friends' })
    expect((await call('PATCH', '/api/me', { name: '' }, me.token)).status).toBe(400)
    expect((await call('PATCH', '/api/me', { accent: 'azul' }, me.token)).status).toBe(400)
    // Caracteres invisíveis e de troca de direção saem do nome.
    const sneaky = await call('PATCH', '/api/me', { name: 'ad‮min​' }, me.token)
    expect(sneaky.body.name).toBe('admin')
  })

  it('foto de perfil: só imagem de verdade, servida com cache longo', async () => {
    const me = await signup('lucas')
    const fake = await api('/api/me/avatar', { method: 'PUT', headers: { Authorization: `Bearer ${me.token}` }, body: '<svg onload=alert(1)>' })
    expect(fake.status).toBe(415)
    const res = await api('/api/me/avatar', { method: 'PUT', headers: { Authorization: `Bearer ${me.token}` }, body: PNG })
    expect(res.status).toBe(200)
    const media = await SELF.fetch(`${BASE}/media/${res.body.avatar}`)
    expect(media.status).toBe(200)
    expect(media.headers.get('Content-Type')).toBe('image/png')
    expect(media.headers.get('Cache-Control')).toContain('immutable')
    expect(media.headers.get('Content-Security-Policy')).toBe('sandbox')
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(PNG)
  })

  it('perfil novo chega na hora pra quem está no mesmo servidor', async () => {
    const { owner, b } = await world()
    await call('PATCH', '/api/me', { name: 'Lucas Novo' }, owner.token)
    const update = await b.next('member.upsert', (m) => m.user.id === owner.user.id)
    expect(update.user.name).toBe('Lucas Novo')
  })

  it('excluir a conta pede a senha e, se for dono de servidor, pede pra transferir antes', async () => {
    const { owner, friend, a, guild } = await world()
    expect((await post('/api/me/delete', { password: 'errada-123' }, friend.token)).status).toBe(401)
    expect((await post('/api/me/delete', { password: PASSWORD }, owner.token)).status).toBe(409)

    expect((await post('/api/me/delete', { password: PASSWORD }, friend.token)).status).toBe(200)
    expect((await a.next('member.removed')).userId).toBe(friend.user.id)
    expect((await login('duarte')).status).toBe(401)
    expect((await call('GET', '/api/me', undefined, friend.token)).status).toBe(401)

    // Quem ficou vê "Usuário excluído" no lugar dela.
    const again = await guildSocket(guild.id, owner.token)
    const ready = await again.next('ready')
    const ghost = ready.users.find((u) => u.id === friend.user.id)
    expect(ghost).toMatchObject({ name: 'Usuário excluído', deleted: true, avatar: null })
    expect(ready.members?.some((m) => m.userId === friend.user.id)).toBe(false)
  })

  it('exporta os próprios dados', async () => {
    const me = await signup('lucas')
    const res = await call('GET', '/api/me/export', undefined, me.token)
    expect(res.status).toBe(200)
    expect(res.body.profile.username).toBe('lucas')
    expect(res.body.sessions).toHaveLength(1)
  })
})

describe('dono da plataforma', () => {
  it('só a dona mexe no painel e pode suspender contas', async () => {
    const { owner, friend } = await world()
    // O amigo é a primeira conta depois da dona (o Pioneiro): lê os números (ver style.test), mas não mexe em nada.
    expect((await call('PUT', '/api/admin/signup', { mode: 'invite' }, friend.token)).status).toBe(403)
    expect((await post(`/api/admin/users/${owner.user.id}/ban`, { banned: true }, friend.token)).status).toBe(403)
    const panel = await call('GET', '/api/admin', undefined, owner.token)
    expect(panel.body).toMatchObject({ signup: 'invite', users: 2, guilds: 1 })
    // Sem Turnstile configurado, o cadastro aberto não liga.
    expect((await call('PUT', '/api/admin/signup', { mode: 'open' }, owner.token)).status).toBe(409)

    expect((await post(`/api/admin/users/${friend.user.id}/ban`, { banned: true }, owner.token)).status).toBe(200)
    expect((await call('GET', '/api/me', undefined, friend.token)).status).toBe(401)
    expect((await login('duarte')).status).toBe(403)
    expect((await post(`/api/admin/users/${friend.user.id}/ban`, { banned: false }, owner.token)).status).toBe(200)
    expect((await login('duarte')).status).toBe(200)
  })
})
