import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

// O app importa sem extensão (quem resolve é o Vite); aqui o Node tenta de novo com `.ts`
// (a busca lê os catálogos de lib/i18n).
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (err) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/.test(specifier)) throw err
      return next(`${specifier}.ts`, context)
    }
  },
})

const { SETTINGS, searchSettings } = await import('../src/renderer/lib/settings-search.ts')
const catalogs = {
  pt: (await import('../src/renderer/lib/i18n/pt/settings.ts')).default,
  en: (await import('../src/renderer/lib/i18n/en/settings.ts')).default,
  es: (await import('../src/renderer/lib/i18n/es/settings.ts')).default,
}

const everyone = { staff: false, platform: false, desktop: true, hyprland: true, locale: 'pt' as const }
const first = (query: string, context: Parameters<typeof searchSettings>[1] = everyone) => searchSettings(query, context)[0]?.id

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
  assert.equal(first('rabisco'), 'voice.ink')
  assert.equal(first('desenhar na tela'), 'voice.ink')
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
  assert.equal(first('cadastro', { ...everyone, staff: true, platform: true }), 'platform.signup')
  // O melhor amigo do dono vê os números, mas não o cadastro nem as contas.
  assert.equal(first('convites', { ...everyone, platform: true }), 'platform.invites')
  assert.equal(first('cadastro', { ...everyone, platform: true }), undefined)
  assert.equal(first('banir', { ...everyone, platform: true }), undefined)
  assert.equal(first('bandeja', { ...everyone, desktop: false }), undefined)
  assert.ok(!searchSettings('hyprland', { ...everyone, hyprland: false }).some((e) => e.id === 'shortcuts.hyprland'))
})

test('busca vazia não lista nada', () => {
  assert.deepEqual(searchSettings('   ', everyone), [])
})

test('procura no idioma da interface e mostra o texto nele', () => {
  const english = { ...everyone, locale: 'en' as const }
  const spanish = { ...everyone, locale: 'es' as const }
  assert.equal(first('noise suppression', english), 'voice.noise')
  assert.equal(searchSettings('noise suppression', english)[0].label, 'Noise suppression')
  assert.equal(searchSettings('noise suppression', english)[0].where, 'Voice & video · Audio')
  assert.equal(first('echo cancellation', english), 'voice.echo')
  assert.equal(first('cancelación de eco', spanish), 'voice.echo')
  assert.equal(searchSettings('reduccion de ruido', spanish)[0].label, 'Reducción de ruido')
  assert.equal(first('contraseña', spanish), 'password.change')
  // Sem idioma no contexto, português.
  assert.equal(searchSettings('ruido', { ...everyone, locale: undefined })[0].label, 'Redução de ruído')
  assert.equal(searchSettings('ruido', everyone)[0].where, 'Voz e vídeo · Áudio')
})

test('as palavras dos outros idiomas também acham (com peso menor)', () => {
  assert.equal(first('idioma'), 'app.language')
  assert.equal(first('language'), 'app.language')
  assert.equal(first('idioma', { ...everyone, locale: 'en' }), 'app.language')
  assert.equal(first('english', { ...everyone, locale: 'es' }), 'app.language')
  assert.equal(first('español', { ...everyone, locale: 'en' }), 'app.language')
  // "webcam" em inglês, português ou espanhol: a câmera.
  assert.equal(first('webcam', { ...everyone, locale: 'es' }), 'voice.camera')
  assert.equal(first('microfone', { ...everyone, locale: 'en' }), 'voice.input')
})

test('todo item do índice tem texto nos três idiomas, e nenhum texto sobra', () => {
  const ids = SETTINGS.map((e) => e.id).sort()
  for (const [locale, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(catalog.search.entries).sort(), ids, `índice e catálogo ${locale} diferentes`)
    for (const id of ids) {
      const text = catalog.search.entries[id]
      assert.ok(text.label.trim() && text.keywords.length, `${locale}: ${id} sem nome ou palavras`)
    }
  }
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
