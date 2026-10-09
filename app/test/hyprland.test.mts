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

const { hyprCombo } = await import('../src/main/hyprland.ts')

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
