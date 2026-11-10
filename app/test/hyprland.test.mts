import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

// O app importa sem extensão (quem resolve é o Vite); aqui o Node tenta de novo com `.ts`.
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

const { hyprCombo, hyprEvent, talkBinds } = await import('../src/main/hyprland.ts')

test('accelerator do Electron vira a combinação do Hyprland (com o modmask que o `hyprctl binds` mostra)', () => {
  assert.deepEqual(hyprCombo('CommandOrControl+Shift+M'), { keys: 'CTRL + SHIFT + M', modmask: 5, key: 'M' })
  assert.deepEqual(hyprCombo('CommandOrControl+Alt+Shift+F12'), { keys: 'CTRL + ALT + SHIFT + F12', modmask: 13, key: 'F12' })
  assert.deepEqual(hyprCombo('Super+Space'), { keys: 'SUPER + space', modmask: 64, key: 'space' })
  assert.equal(hyprCombo('Alt+`')?.keys, 'ALT + grave')
  assert.equal(hyprCombo('CommandOrControl+PageDown')?.keys, 'CTRL + Next')
  assert.equal(hyprCombo('Shift+num5')?.keys, 'SHIFT + KP_5')
  assert.equal(hyprCombo('Pause')?.keys, 'Pause')
})

test('o que o Hyprland não entende fica de fora', () => {
  assert.equal(hyprCombo('Hyper+M'), null)
  assert.equal(hyprCombo('CommandOrControl+MediaPlayPause'), null)
  assert.equal(hyprCombo(''), null)
})

test('apertar pra falar: um bind quando a tecla desce e outro quando sobe, sem "comer" a tecla', () => {
  const [down, up] = talkBinds(hyprCombo('V')!, 'apertar pra falar')
  assert.equal(down, 'hl.bind("V", hl.dsp.event("resenha:ptt-down"), { description = "Resenha: apertar pra falar", non_consuming = true, ignore_mods = true })')
  assert.equal(up, 'hl.bind("V", hl.dsp.event("resenha:ptt-up"), { description = "Resenha: apertar pra falar", release = true, non_consuming = true, ignore_mods = true })')
  // Com modificador, só a combinação abre; a subida vale sempre (soltar o Ctrl antes não deixa o microfone aberto).
  const [modDown, modUp] = talkBinds(hyprCombo('CommandOrControl+Shift+V')!, 'push "to" talk')
  assert.ok(modDown.startsWith('hl.bind("CTRL + SHIFT + V", hl.dsp.event("resenha:ptt-down"), { description = "Resenha: push \\"to\\" talk", non_consuming = true })'), modDown)
  assert.ok(!modDown.includes('ignore_mods'))
  assert.ok(modUp.includes('release = true') && modUp.includes('ignore_mods = true'))
})

test('eventos do Hyprland: ação de um toque, tecla de falar descendo e subindo, e o resto fica de fora', () => {
  assert.deepEqual(hyprEvent('custom>>resenha:toggle-mute'), { action: 'toggle-mute' })
  assert.deepEqual(hyprEvent('custom>>resenha:ptt-down'), { talk: true })
  assert.deepEqual(hyprEvent('custom>>resenha:ptt-up'), { talk: false })
  assert.equal(hyprEvent('custom>>resenha:push-to-talk'), null)
  assert.equal(hyprEvent('custom>>resenha:apagar-tudo'), null)
  assert.equal(hyprEvent('custom>>outro:toggle-mute'), null)
  assert.equal(hyprEvent('configreloaded>>'), null)
})
