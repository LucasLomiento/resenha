import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SETTINGS, searchSettings } from '../src/renderer/lib/settings-search.ts'

const everyone = { staff: false, desktop: true, hyprland: true }
const first = (query: string, context = everyone) => searchSettings(query, context)[0]?.id

test('acha pelo nome, sem acento e sem maiúscula', () => {
  assert.equal(first('redução de ruído'), 'voice.noise')
  assert.equal(first('reducao de ruido'), 'voice.noise')
  assert.equal(first('BANNER'), 'profile.banner')
  assert.equal(first('cancelamento'), 'voice.echo')
})

test('acha pelas palavras-chave (sinônimos, inglês, Discord)', () => {
  assert.equal(first('avatar'), 'profile.photo')
  assert.equal(first('webcam'), 'voice.camera')
  assert.equal(first('dm'), 'privacy.dms')
  assert.equal(first('lgpd'), 'privacy.export')
  assert.equal(first('zoom'), 'app.zoom')
  assert.equal(first('bandeja'), 'app.tray')
  assert.equal(first('h264'), 'voice.codec')
  assert.equal(first('fone'), 'voice.output')
})

test('aguenta erro de digitação e palavra pela metade', () => {
  assert.equal(first('microfnoe'), 'voice.input')
  assert.equal(first('ruidp'), 'voice.noise')
  assert.equal(first('atualizaçao'), 'app.update')
  assert.ok(searchSettings('notifica', everyone).slice(0, 3).some((e) => e.id === 'notify.content'))
  assert.equal(first('estatis'), 'voice.stats')
})

test('várias palavras: todas precisam bater', () => {
  assert.equal(first('atalho mutar'), 'shortcuts.toggle-mute')
  assert.equal(first('som mensagem'), 'notify.message')
  assert.deepEqual(searchSettings('banner webcam', everyone), [])
})

test('esconde o que não vale pra pessoa', () => {
  assert.equal(first('cadastro'), undefined)
  assert.equal(first('cadastro', { ...everyone, staff: true }), 'platform.signup')
  assert.equal(first('bandeja', { ...everyone, desktop: false }), undefined)
  assert.ok(!searchSettings('hyprland', { ...everyone, hyprland: false }).some((e) => e.id === 'shortcuts.hyprland'))
})

test('busca vazia não lista nada', () => {
  assert.deepEqual(searchSettings('   ', everyone), [])
})

test('toda configuração do índice tem a âncora na página', () => {
  const dir = new URL('../src/renderer/ui/settings/', import.meta.url).pathname
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith('.svelte'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
  const ids = new Set(SETTINGS.map((e) => e.id))
  assert.equal(ids.size, SETTINGS.length, 'id repetido no índice')
  for (const entry of SETTINGS) {
    // Atalhos: uma linha por ação, com o id montado no template.
    const dynamic = entry.id.startsWith('shortcuts.') && pages.includes('setting="shortcuts.{action.id}"')
    const found = pages.includes(`setting="${entry.id}"`) || pages.includes(`data-setting="${entry.id}"`)
    assert.ok(found || (dynamic && !['shortcuts.all', 'shortcuts.hyprland'].includes(entry.id)), `falta a âncora de ${entry.id}`)
  }
})
