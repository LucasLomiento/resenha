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

const { shortcutId, usesPortalShortcuts, xdgTrigger } = await import('../src/main/portal-shortcuts.ts')

test('accelerator do Electron vira o gatilho do portal (SHIFT, CTRL, ALT, LOGO + tecla do xkb)', () => {
  assert.equal(xdgTrigger('CommandOrControl+Shift+M'), 'CTRL+SHIFT+M')
  assert.equal(xdgTrigger('Super+Alt+F5'), 'LOGO+ALT+F5')
  assert.equal(xdgTrigger('CommandOrControl+`'), 'CTRL+grave')
  assert.equal(xdgTrigger('Shift+num0'), 'SHIFT+KP_0')
  assert.equal(xdgTrigger('Hyper+M'), null)
})

test('o id do atalho leva a tecla: trocar a tecla vira outro atalho no sistema', () => {
  assert.equal(shortcutId('toggle-mute', 'CTRL+SHIFT+M'), 'toggle-mute@CTRL+SHIFT+M')
  assert.notEqual(shortcutId('toggle-mute', 'CTRL+SHIFT+M'), shortcutId('toggle-mute', 'CTRL+SHIFT+N'))
})

test('o portal só vale no Wayland fora do Hyprland, e nunca num perfil de teste', () => {
  const saved = { ...process.env }
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'linux' })
  try {
    for (const key of ['RESENHA_PROFILE', 'HYPRLAND_INSTANCE_SIGNATURE', 'XDG_SESSION_TYPE', 'WAYLAND_DISPLAY']) delete process.env[key]
    process.env.XDG_SESSION_TYPE = 'wayland'
    assert.equal(usesPortalShortcuts(), true)
    process.env.HYPRLAND_INSTANCE_SIGNATURE = 'x'
    assert.equal(usesPortalShortcuts(), false)
    delete process.env.HYPRLAND_INSTANCE_SIGNATURE
    process.env.RESENHA_PROFILE = 'e2e-a'
    assert.equal(usesPortalShortcuts(), false)
    delete process.env.RESENHA_PROFILE
    process.env.XDG_SESSION_TYPE = 'x11'
    assert.equal(usesPortalShortcuts(), false)
  } finally {
    process.env = saved
    Object.defineProperty(process, 'platform', platform)
  }
})
