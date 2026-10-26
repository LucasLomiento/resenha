import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, P, type Channel, type Role } from '../../shared/protocol'
import { armAlarm } from '../src/alarm'
import { ipPrefix, resignProxyUrl, signFileUrl, signProxyUrl, verifyFileSignature, verifyProxyUrl } from '../src/auth'
import { validEmoji } from '../src/messages'
import { channelPermissions, outranks, sameOverwrites, sanitizeOverwrites } from '../../shared/permissions'
import { extractUrls, safeUrl } from '../src/unfurl'
import { cleanFileName, cleanLine, passwordProblem, slugUsername, username } from '../src/validate'

const BASE = 'https://resenha.test'

describe('permissões', () => {
  const guildId = 'g'
  const roles = new Map<string, Role>([
    ['g', { id: 'g', name: '@everyone', color: null, position: 0, permissions: DEFAULT_PERMISSIONS, hoist: false, mentionable: false }],
    ['mod', { id: 'mod', name: 'Mod', color: null, position: 2, permissions: P.MANAGE_MESSAGES, hoist: false, mentionable: false }],
    ['vip', { id: 'vip', name: 'VIP', color: null, position: 1, permissions: 0, hoist: false, mentionable: false }],
    ['adm', { id: 'adm', name: 'Adm', color: null, position: 3, permissions: P.ADMINISTRATOR, hoist: false, mentionable: false }],
  ])
  const ctx = { guildId, ownerId: 'dono', roles }
  const channel = (overwrites: Channel['overwrites'], parentId: string | null = null): Channel => ({
    id: 'c',
    name: 'c',
    kind: 'text',
    position: 0,
    parentId,
    topic: '',
    overwrites,
    userLimit: 0,
    slowmode: 0,
  })
  const member = (userId: string, r: string[] = [], timeoutUntil: number | null = null) => ({ userId, roles: r, timeoutUntil })

  it('dono e administrador podem tudo, mesmo com exceção negando', () => {
    const c = channel([{ id: guildId, type: 'role', allow: 0, deny: P.VIEW_CHANNEL }])
    expect(channelPermissions(ctx, member('dono'), c)).toBe(ALL_PERMISSIONS)
    expect(channelPermissions(ctx, member('x', ['adm']), c)).toBe(ALL_PERMISSIONS)
  })

  it('exceção do cargo vence a do @everyone e a da pessoa vence as dos cargos', () => {
    const c = channel([
      { id: guildId, type: 'role', allow: 0, deny: P.VIEW_CHANNEL },
      { id: 'vip', type: 'role', allow: P.VIEW_CHANNEL, deny: 0 },
      { id: 'chato', type: 'member', allow: 0, deny: P.SEND_MESSAGES },
    ])
    expect(channelPermissions(ctx, member('x'), c)).toBe(0)
    expect(channelPermissions(ctx, member('x', ['vip']), c) & P.VIEW_CHANNEL).toBeTruthy()
    const chato = channelPermissions(ctx, member('chato', ['vip']), c)
    expect(chato & P.VIEW_CHANNEL).toBeTruthy()
    expect(chato & P.SEND_MESSAGES).toBe(0)
  })

  it('o canal vale pelas próprias exceções, não pelas da categoria', () => {
    // Nada é herdado na hora: o canal guarda as dele (copiadas ao nascer na categoria).
    const c = channel([], 'cat-privada')
    expect(channelPermissions(ctx, member('x'), c) & P.VIEW_CHANNEL).toBeTruthy()
    expect(sameOverwrites([{ id: 'a', type: 'role', allow: 1, deny: 0 }, { id: 'b', type: 'member', allow: 0, deny: 2 }], [{ id: 'b', type: 'member', allow: 0, deny: 2 }, { id: 'a', type: 'role', allow: 1, deny: 0 }])).toBe(true)
    expect(sameOverwrites([{ id: 'a', type: 'role', allow: 1, deny: 0 }], [{ id: 'a', type: 'role', allow: 3, deny: 0 }])).toBe(false)
  })

  it('castigo deixa só ver e ler', () => {
    const p = channelPermissions(ctx, member('x', ['mod'], Date.now() + 60_000), channel([]))
    expect(p).toBe(P.VIEW_CHANNEL | P.READ_HISTORY)
  })

  it('hierarquia', () => {
    expect(outranks(ctx, member('x', ['mod']), member('y', ['vip']))).toBe(true)
    expect(outranks(ctx, member('x', ['vip']), member('y', ['mod']))).toBe(false)
    expect(outranks(ctx, member('x', ['adm']), member('dono'))).toBe(false)
    expect(outranks(ctx, member('dono'), member('x', ['adm']))).toBe(true)
  })

  it('exceções vindas do app perdem o bit de administrador e ids desconhecidos', () => {
    const clean = sanitizeOverwrites(
      [
        { id: 'vip', type: 'role', allow: P.ADMINISTRATOR | P.VIEW_CHANNEL, deny: 0 },
        { id: 'fantasma', type: 'role', allow: P.VIEW_CHANNEL, deny: 0 },
      ],
      (id: string) => roles.has(id),
      () => true,
    )
    expect(clean).toEqual([{ id: 'vip', type: 'role', allow: P.VIEW_CHANNEL, deny: 0 }])
    expect(sanitizeOverwrites('lixo', () => true, () => true)).toBeNull()
  })
})

describe('validação', () => {
  it('nome de usuário', () => {
    expect(username('Lucas')).toBe('lucas')
    expect(username('lu.cas_2')).toBe('lu.cas_2')
    for (const bad of ['a', '.lucas', 'lucas.', 'lu..cas', 'com espaço', 'everyone', 'x'.repeat(33)]) expect(username(bad)).toBeNull()
    expect(slugUsername('Duarte Zé')).toBe('duarte_ze')
    expect(slugUsername('!')).toMatch(/^user_/)
  })

  it('tira caracteres invisíveis e de troca de direção, mas mantém emoji composto', () => {
    expect(cleanLine('ad‮min', 1, 32)).toBe('admin')
    expect(cleanLine('​zero﻿', 1, 32)).toBe('zero')
    expect(cleanLine('família 👨‍👩‍👧', 1, 32)).toBe('família 👨‍👩‍👧')
    expect(cleanLine('   ', 1, 32)).toBeNull()
  })

  it('nome feito só de preenchimento invisível (hangul, braille, hífen suave) não passa', () => {
    expect(cleanLine('\u3164\u3164', 1, 32)).toBeNull()
    expect(cleanLine('\u2800 \u00ad', 1, 32)).toBeNull()
    expect(cleanLine('Ana\u3164', 1, 32)).toBe('Ana')
    // Emoji sozinho continua valendo.
    expect(cleanLine('🎮', 1, 32)).toBe('🎮')
  })

  it('nome de arquivo sem troca de direção (que disfarça a extensão) nem barra', () => {
    expect(cleanFileName('foto\u202egnp.exe')).toBe('fotognp.exe')
    expect(cleanFileName('a/b\\c.txt')).toBe('a_b_c.txt')
    expect(cleanFileName('\u200b')).toBe('arquivo')
  })

  it('IP: IPv4 inteiro, IPv6 pelo /64', () => {
    expect(ipPrefix('203.0.113.7')).toBe('203.0.113.7')
    expect(ipPrefix('2804:d57:1a2b:3c4d:1111:2222:3333:4444')).toBe('2804:d57:1a2b:3c4d::/64')
    expect(ipPrefix('2804:d57:1a2b:3c4d::1')).toBe(ipPrefix('2804:d57:1a2b:3c4d:ffff::9'))
    expect(ipPrefix('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(ipPrefix('::ffff:198.51.100.2')).toBe('198.51.100.2')
  })

  it('senha', () => {
    expect(passwordProblem('curta', 'x')).toMatch(/8/)
    expect(passwordProblem('password', 'x')).toMatch(/fácil/)
    expect(passwordProblem('aaaaaaaaaa', 'x')).toMatch(/fácil/)
    expect(passwordProblem('lucaslucas', 'lucaslucas')).toMatch(/fácil/)
    expect(passwordProblem('cavalo-bateria-grampo', 'lucas')).toBeNull()
  })

  it('emoji de reação', () => {
    for (const ok of ['👍', '❤️', '1️⃣', '👨‍👩‍👧', '🇧🇷', '👋🏽']) expect(validEmoji(ok)).toBe(ok)
    for (const bad of ['a', 'oi', '<script>', '', '1', '#', '👍'.repeat(20)]) expect(validEmoji(bad)).toBeNull()
  })
})

describe('prévia de link', () => {
  it('acha os links e ignora os entre <> e os de código', () => {
    expect(extractUrls('olha https://exemplo.com/a, e https://b.com/x_(y).')).toEqual(['https://exemplo.com/a', 'https://b.com/x_(y)'])
    expect(extractUrls('sem prévia <https://exemplo.com> e `https://c.com`')).toEqual([])
    expect(extractUrls('```\nhttps://d.com\n```')).toEqual([])
    expect(extractUrls('1 https://a.com 2 https://b.com 3 https://c.com 4 https://d.com')).toHaveLength(3)
  })

  it('não busca endereço interno (SSRF)', () => {
    for (const bad of [
      'http://localhost/x',
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'https://user:pass@exemplo.com/',
      'https://exemplo.com:8443/',
      'file:///etc/passwd',
      'http://roteador.local/',
    ]) {
      expect(safeUrl(bad), bad).toBeNull()
    }
    expect(safeUrl('https://www.youtube.com/watch?v=1')?.hostname).toBe('www.youtube.com')
  })
})

describe('URLs assinadas', () => {
  it('arquivo: vence, e o link de um lugar não serve pra outro', async () => {
    const now = Date.UTC(2026, 9, 5)
    const url = new URL(await signFileUrl('k', { kind: 'g', id: 'g1' }, 'abc', 'a.png', now), BASE)
    const exp = url.searchParams.get('exp')
    const sig = url.searchParams.get('sig')
    expect(await verifyFileSignature('k', { kind: 'g', id: 'g1' }, 'abc', exp, sig, now)).toBe(true)
    expect(await verifyFileSignature('k', { kind: 'g', id: 'g2' }, 'abc', exp, sig, now)).toBe(false)
    expect(await verifyFileSignature('k', { kind: 'c', id: 'g1' }, 'abc', exp, sig, now)).toBe(false)
    expect(await verifyFileSignature('k', { kind: 'g', id: 'g1' }, 'abd', exp, sig, now)).toBe(false)
    expect(await verifyFileSignature('k', { kind: 'g', id: 'g1' }, 'abc', exp, sig, now + 30 * 86400_000)).toBe(false)
    expect(await verifyFileSignature('outra', { kind: 'g', id: 'g1' }, 'abc', exp, sig, now)).toBe(false)
  })

  it('proxy de imagem', async () => {
    const url = new URL(await signProxyUrl('k', 'https://img.com/a.png'), BASE)
    const [u, exp, sig] = ['u', 'exp', 'sig'].map((k) => url.searchParams.get(k))
    expect(await verifyProxyUrl('k', u, exp, sig)).toBe('https://img.com/a.png')
    expect(await verifyProxyUrl('k', u!.slice(1), exp, sig)).toBeNull()
  })
  it('a imagem da prévia é assinada de novo a cada leitura (a guardada vence em 2 a 3 dias)', async () => {
    const old = await signProxyUrl('k', 'https://img.com/a.png', Date.parse('2026-01-01T00:00:00Z'))
    const now = Date.parse('2026-02-01T00:00:00Z')
    const url = new URL(await resignProxyUrl('k', old, now), 'https://x')
    const [u, exp, sig] = ['u', 'exp', 'sig'].map((k) => url.searchParams.get(k))
    expect(await verifyProxyUrl('k', u, exp, sig, now)).toBe('https://img.com/a.png')
    expect(await resignProxyUrl('k', '/outra/coisa')).toBe('/outra/coisa')
  })
})

describe('alarme', () => {
  const storage = (at: number | null) => {
    const set: number[] = []
    return { set, storage: { getAlarm: async () => at, setAlarm: async (when: number) => void set.push(when) } as unknown as DurableObjectStorage }
  }

  it('arma sem alarme, antecipa um mais tarde e deixa um mais cedo', async () => {
    const now = 1_000_000
    for (const [at, want] of [[null, [now + 16_000]], [now + 60_000, [now + 16_000]], [now + 5_000, []]] as const) {
      const s = storage(at)
      await armAlarm(s.storage, now + 16_000, now)
      expect(s.set).toEqual(want)
    }
  })

  it('alarme vencido há mais de 1 min (desistido depois das falhas) conta como sem alarme', async () => {
    const now = 1_000_000
    const stuck = storage(now - 15 * 3_600_000)
    await armAlarm(stuck.storage, now + 16_000, now)
    expect(stuck.set).toEqual([now + 16_000])
    // Vencido há pouco: ainda vai disparar, não mexe.
    const due = storage(now - 5_000)
    await armAlarm(due.storage, now + 16_000, now)
    expect(due.set).toEqual([])
  })
})
