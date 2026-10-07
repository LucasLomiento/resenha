import { describe, expect, it } from 'vitest'
import type { Channel, ImportedStructure } from '../../shared/protocol'
import { MAX_IMPORT_CHANNELS, cleanStructure, parseModelReply } from '../src/discord-import'
import { api, signup, tick, world } from './helpers'

// O que o modelo respondeu de verdade pro print de teste (com ```json em volta).
const REPLY = `\`\`\`json
{
  "server": "Resenha dos Amigos ✨",
  "categories": [
    { "name": "BATE-PAPO", "channels": [{ "name": "💬┃geral", "type": "text" }, { "name": "😂┃memes", "type": "text" }] },
    { "name": "CALLS", "channels": [{ "name": "🎮 Jogatina", "type": "voice" }, { "name": "💤 AFK", "type": "voice" }] }
  ],
  "uncategorized": [{ "name": "📜┃regras", "type": "text" }]
}
\`\`\``

describe('importar do Discord: leitura da resposta do modelo', () => {
  it('tira o JSON do meio do texto e mantém nomes, emojis e tipos', () => {
    expect(parseModelReply(REPLY)).toEqual({
      server: 'Resenha dos Amigos ✨',
      channels: [{ name: '📜┃regras', kind: 'text' }],
      categories: [
        { name: 'BATE-PAPO', channels: [{ name: '💬┃geral', kind: 'text' }, { name: '😂┃memes', kind: 'text' }] },
        { name: 'CALLS', channels: [{ name: '🎮 Jogatina', kind: 'voice' }, { name: '💤 AFK', kind: 'voice' }] },
      ],
    })
  })

  it('resposta sem JSON, ou JSON quebrado: nada', () => {
    expect(parseModelReply('Não consigo ver canais nessa imagem.')).toBeNull()
    expect(parseModelReply('{"categories": [')).toBeNull()
  })

  it('confere tudo: nome vazio sai, tipo estranho vira texto, nome longo sai, limite de canais', () => {
    const many = Array.from({ length: MAX_IMPORT_CHANNELS + 20 }, (_, i) => ({ name: `c${i}`, type: 'text' }))
    const clean = cleanStructure({
      server: '',
      uncategorized: [{ name: '   ', type: 'text' }, { name: 'ok', type: 'stage' }, { name: 'x'.repeat(101) }],
      categories: [{ name: 'Muitos', channels: many }, { name: '', channels: [] }],
    })!
    expect(clean.server).toBeNull()
    expect(clean.channels).toEqual([{ name: 'ok', kind: 'text' }])
    expect(clean.categories).toHaveLength(1)
    expect(clean.channels.length + clean.categories[0].channels.length).toBe(MAX_IMPORT_CHANNELS)
  })
})

describe('importar do Discord: criar os canais', () => {
  const STRUCTURE: ImportedStructure = {
    server: null,
    channels: [{ name: '📜┃regras', kind: 'text' }],
    categories: [
      { name: 'Bate-papo', channels: [{ name: '💬┃geral', kind: 'text' }, { name: '😂┃memes', kind: 'text' }] },
      { name: 'Calls', channels: [{ name: '🎮 Jogatina', kind: 'voice' }] },
    ],
  }

  it('cria tudo de uma vez, na ordem do print, e todo mundo vê', async () => {
    const { a, b } = await world()
    a.send({ t: 'channel.import', structure: STRUCTURE })
    const seen = new Map<string, Channel>()
    while (seen.size < 6) {
      const { channel } = await b.next('channel.upsert')
      seen.set(channel.name, channel)
    }
    const chat = seen.get('Bate-papo')!
    const calls = seen.get('Calls')!
    expect(chat.kind).toBe('category')
    expect(seen.get('📜┃regras')).toMatchObject({ kind: 'text', parentId: null })
    expect(seen.get('💬┃geral')).toMatchObject({ kind: 'text', position: 0 })
    expect(seen.get('😂┃memes')).toMatchObject({ kind: 'text', position: 1 })
    expect(seen.get('💬┃geral')!.parentId).toBe(chat.id)
    expect(seen.get('🎮 Jogatina')!.parentId).toBe(calls.id)
    expect(seen.get('🎮 Jogatina')).toMatchObject({ kind: 'voice', position: 0 })
    expect(calls.position).toBeGreaterThan(chat.position)
  })

  it('só quem pode criar canais importa', async () => {
    const { b } = await world()
    b.send({ t: 'channel.import', structure: STRUCTURE })
    expect((await b.next('error')).message).toMatch(/não pode criar/)
  })

  it('não passa do limite de canais do servidor', async () => {
    const { a } = await world()
    const big: ImportedStructure = {
      server: null,
      channels: [],
      categories: Array.from({ length: 50 }, (_, i) => ({ name: `cat ${i}`, channels: Array.from({ length: 6 }, (_, j) => ({ name: `c${j}`, kind: 'text' as const })) })),
    }
    a.send({ t: 'channel.import', structure: big })
    a.send({ t: 'channel.import', structure: big })
    expect((await a.next('error')).message).toMatch(/limite/)
  })
})

describe('importar do Discord: rota do print', () => {
  it('pede login e uma imagem de verdade', async () => {
    expect((await api('/api/import/discord', { method: 'POST', body: 'x' })).status).toBe(401)
    const me = await signup('lucas')
    const notImage = await api('/api/import/discord', {
      method: 'POST',
      headers: { Authorization: `Bearer ${me.token}` },
      body: new Uint8Array(2_000_000),
    })
    expect(notImage.status).toBe(413)
    // Nos testes não tem o Workers AI: o print válido volta com erro, sem travar.
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))
    const read = await api('/api/import/discord', { method: 'POST', headers: { Authorization: `Bearer ${me.token}` }, body: png })
    expect([502, 503]).toContain(read.status)
    expect(read.body.error).toBeTruthy()
    await tick()
  })
})
