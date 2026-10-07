import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { isAnimated, normalizeStyle, styleText } from '../src/style'
import { BASE, PASSWORD, api, call, guildSocket, post, signup, world } from './helpers'

// Personalização do perfil (banner, foto animada, tema, pronomes, moldura,
// efeito, fonte e estilo do nome).

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0, 0, 0, 0, 0, 0])

/** GIF de mentira com dois quadros (dois blocos de controle de quadro). */
function gif(frames = 2, size = 64) {
  const bytes = new Uint8Array(Math.max(size, 16 + frames * 8))
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  for (let i = 0; i < frames; i++) bytes.set([0x21, 0xf9, 0x04, 0, 0, 0, 0, 0], 16 + i * 8)
  return bytes
}

/** WebP estendido com a marca de animação. */
function animatedWebp(size = 64) {
  const bytes = new Uint8Array(size)
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0x02])
  return bytes
}

/** PNG grande (o começo é de PNG, o resto é enchimento). */
function bigPng(size: number) {
  const bytes = new Uint8Array(size)
  bytes.set(PNG)
  return bytes
}

const put = (path: string, token: string, body: BodyInit, type?: string) =>
  api(path, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, ...(type ? { 'Content-Type': type } : {}) }, body })

function avatarForm(image: Uint8Array, still?: Uint8Array) {
  const form = new FormData()
  form.append('image', new File([image], 'foto.gif', { type: 'image/gif' }))
  if (still) form.append('still', new File([still], 'parada.webp', { type: 'image/webp' }))
  return form
}

const mediaStatus = async (id: string) => (await SELF.fetch(`${BASE}/media/${id}`)).status

describe('personalização do perfil', () => {
  it('muda tema, pronomes, moldura, efeito e nome; null volta pro padrão', async () => {
    const me = await signup('lucas')
    const style = { theme: [0x7c6cff, 0xff7a93], pronouns: '  ele / dele ', decoration: 'aurora', effect: 'snow', nameFont: 'serif', nameEffect: 'gradient' }
    const res = await call('PATCH', '/api/me', { style }, me.token)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.style).toEqual({ ...style, pronouns: 'ele / dele' })

    // Só o que veio muda; null e texto vazio tiram.
    const next = await call('PATCH', '/api/me', { style: { effect: null, pronouns: '' } }, me.token)
    expect(next.body.style).toEqual({ theme: [0x7c6cff, 0xff7a93], decoration: 'aurora', nameFont: 'serif', nameEffect: 'gradient' })
    const empty = await call('PATCH', '/api/me', { style: { theme: null, decoration: null, nameFont: null, nameEffect: null } }, me.token)
    expect(empty.body.style).toBeUndefined()
    expect((await call('GET', '/api/me', undefined, me.token)).body.style).toBeUndefined()
  })

  it('recusa o que não é da lista embutida', async () => {
    const me = await signup('lucas')
    const bad = async (style: unknown) => (await call('PATCH', '/api/me', { style }, me.token)).status
    expect(await bad({ decoration: 'https://exemplo.com/moldura.png' })).toBe(400)
    expect(await bad({ effect: 'chuva' })).toBe(400)
    expect(await bad({ nameFont: 'Comic Sans' })).toBe(400)
    expect(await bad({ nameEffect: 'arco-iris' })).toBe(400)
    expect(await bad({ theme: [1] })).toBe(400)
    expect(await bad({ theme: [0, 0x1000000] })).toBe(400)
    expect(await bad({ theme: ['#fff', '#000'] })).toBe(400)
    expect(await bad({ pronouns: 'x'.repeat(41) })).toBe(400)
    expect(await bad({ pronouns: 42 })).toBe(400)
    expect(await bad('aurora')).toBe(400)
    // Banner e quadro parado só mudam pelas rotas de imagem.
    const sneaky = await call('PATCH', '/api/me', { style: { banner: 'qualquer-coisa-1234', avatarStill: 'outra-coisa-1234', pronouns: 'ela' } }, me.token)
    expect(sneaky.status).toBe(200)
    expect(sneaky.body.style).toEqual({ pronouns: 'ela' })
    // Nada mudou com as tentativas recusadas.
    expect((await call('GET', '/api/me', undefined, me.token)).body.style).toEqual({ pronouns: 'ela' })
  })

  it('chega na hora pra quem está no servidor e fica guardada lá', async () => {
    const { owner, guild, b } = await world()
    await call('PATCH', '/api/me', { style: { decoration: 'headset', nameEffect: 'neon' } }, owner.token)
    const update = await b.next('member.upsert', (m) => m.user.id === owner.user.id)
    expect(update.user.style).toEqual({ decoration: 'headset', nameEffect: 'neon' })

    // Quem conecta depois recebe do próprio servidor (a cópia dos perfis tem a coluna nova).
    const again = await guildSocket(guild.id, owner.token)
    const ready = await again.next('ready')
    expect(ready.users.find((u) => u.id === owner.user.id)?.style).toEqual({ decoration: 'headset', nameEffect: 'neon' })
    // Reconectar sem mudança não espalha nada.
    await b.nothing('member.upsert', (m) => (m as { user?: { id: string } }).user?.id === owner.user.id)
  })

  it('banner: só imagem, até 1,5 MB; trocar e remover apagam o anterior', async () => {
    const me = await signup('lucas')
    expect((await put('/api/me/banner', me.token, '<svg onload=alert(1)>')).status).toBe(415)
    expect((await put('/api/me/banner', me.token, bigPng(1536 * 1024 + 1))).status).toBe(413)

    const first = await put('/api/me/banner', me.token, bigPng(900 * 1024))
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    const firstId = first.body.style.banner
    const media = await SELF.fetch(`${BASE}/media/${firstId}`)
    expect(media.headers.get('Content-Type')).toBe('image/png')
    expect(media.headers.get('Content-Security-Policy')).toBe('sandbox')
    expect((await media.arrayBuffer()).byteLength).toBe(900 * 1024)

    const second = await put('/api/me/banner', me.token, gif(3))
    expect(second.body.style.banner).not.toBe(firstId)
    expect(await mediaStatus(firstId)).toBe(404)
    expect(await mediaStatus(second.body.style.banner)).toBe(200)

    const removed = await call('DELETE', '/api/me/banner', undefined, me.token)
    expect(removed.body.style).toBeUndefined()
    expect(await mediaStatus(second.body.style.banner)).toBe(404)
  })

  it('foto animada vem com um quadro parado; foto parada continua até 512 KB', async () => {
    const me = await signup('lucas')
    // GIF animado sem o quadro parado: falta coisa.
    expect((await put('/api/me/avatar', me.token, gif())).status).toBe(400)
    // Foto parada grande demais.
    expect((await put('/api/me/avatar', me.token, bigPng(600 * 1024))).status).toBe(413)

    const animated = await put('/api/me/avatar', me.token, avatarForm(gif(2, 1400 * 1024), WEBP))
    expect(animated.status, JSON.stringify(animated.body)).toBe(200)
    const { avatar, style } = animated.body
    expect(style.avatarStill).toBeTruthy()
    expect((await SELF.fetch(`${BASE}/media/${avatar}`)).headers.get('Content-Type')).toBe('image/gif')
    expect((await SELF.fetch(`${BASE}/media/${style.avatarStill}`)).headers.get('Content-Type')).toBe('image/webp')

    // WebP animado também vale; a anterior e o quadro dela somem.
    const webp = await put('/api/me/avatar', me.token, avatarForm(animatedWebp(), WEBP))
    expect(webp.status).toBe(200)
    expect(await mediaStatus(avatar)).toBe(404)
    expect(await mediaStatus(style.avatarStill)).toBe(404)

    // Voltando pra foto parada, o quadro parado sai junto.
    const still = webp.body.style.avatarStill
    const plain = await put('/api/me/avatar', me.token, PNG)
    expect(plain.body.style).toBeUndefined()
    expect(await mediaStatus(still)).toBe(404)

    // Animada grande demais.
    expect((await put('/api/me/avatar', me.token, avatarForm(gif(2, 1536 * 1024 + 1), WEBP))).status).toBe(413)

    // Remover a foto não mexe no resto da personalização.
    await call('PATCH', '/api/me', { style: { pronouns: 'ele/dele' } }, me.token)
    await put('/api/me/avatar', me.token, avatarForm(gif(), WEBP))
    const cleared = await call('DELETE', '/api/me/avatar', undefined, me.token)
    expect(cleared.body).toMatchObject({ avatar: null, style: { pronouns: 'ele/dele' } })
  })

  it('conta excluída perde a personalização; o export leva ela junto', async () => {
    const { owner, friend, a } = await world()
    await call('PATCH', '/api/me', { style: { pronouns: 'ele/dele', decoration: 'crown' } }, friend.token)
    await put('/api/me/banner', friend.token, PNG)
    const exported = await call('GET', '/api/me/export', undefined, friend.token)
    expect(exported.body.profile.style).toMatchObject({ pronouns: 'ele/dele', decoration: 'crown' })

    expect((await post('/api/me/delete', { password: PASSWORD }, friend.token)).status).toBe(200)
    await a.next('member.removed')
    const user = await call('GET', `/api/users/${friend.user.id}`, undefined, owner.token)
    expect(user.body).toMatchObject({ deleted: true })
    expect(user.body.style).toBeUndefined()
  })

  it('a coluna nova entra sem perder as contas e os perfis que já existem', async () => {
    const { owner, guild } = await world()
    await call('PATCH', '/api/me', { bio: 'oi' }, owner.token)
    // Simula o banco de antes da 1.1 (sem a coluna) e roda a migração de novo.
    const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'))
    await runInDurableObject(dir, (instance, state) => {
      state.storage.sql.exec('ALTER TABLE users DROP COLUMN style')
      ;(instance as unknown as { schema(): void }).schema()
      expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM users').one().n).toBe(2)
    })
    const g = env.GUILD.get(env.GUILD.idFromName(guild.id))
    await runInDurableObject(g, async (instance, state) => {
      state.storage.sql.exec('ALTER TABLE profiles DROP COLUMN style')
      await (instance as unknown as { migrate(): Promise<void> }).migrate()
      expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM profiles').one().n).toBe(2)
    })
    const me = await call('PATCH', '/api/me', { style: { pronouns: 'ele' } }, owner.token)
    expect(me.body).toMatchObject({ bio: 'oi', style: { pronouns: 'ele' } })
    const s = await guildSocket(guild.id, owner.token)
    const ready = await s.next('ready')
    expect(ready.users.find((u) => u.id === owner.user.id)).toMatchObject({ bio: 'oi', style: { pronouns: 'ele' } })
  })
})

describe('personalização (unidades)', () => {
  it('reconhece GIF e WebP animados', () => {
    expect(isAnimated(gif(2))).toBe(true)
    expect(isAnimated(gif(1))).toBe(false)
    expect(isAnimated(animatedWebp())).toBe(true)
    expect(isAnimated(WEBP)).toBe(false)
    expect(isAnimated(PNG)).toBe(false)
  })

  it('o texto guardado sai sempre na mesma ordem (dá pra comparar)', () => {
    const a = styleText({ nameEffect: 'neon', pronouns: 'ela', theme: [1, 2] })
    const b = styleText({ theme: [1, 2], pronouns: 'ela', nameEffect: 'neon' })
    expect(a).toBe(b)
    expect(styleText({})).toBeNull()
    expect(normalizeStyle({ decoration: 'nope', theme: [1, 2, 3], banner: '../x', pronouns: 'ele' })).toEqual({ pronouns: 'ele' })
  })
})
