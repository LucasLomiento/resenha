// Capturas dos protótipos de interface (ui/proto): abre o app escondido no modo
// protótipo, passa por cada tela e salva um PNG por tela. Não fala com servidor.
//
// Uso: npx electron-vite build && node test/proto-shots.mjs <pasta> [tela ...]
//   PROTO_SMALL=1  também captura na janela mínima (940x560)

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const OUT = process.argv[2]
if (!OUT) {
  console.error('Uso: node test/proto-shots.mjs <pasta> [tela ...]')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
const only = process.argv.slice(3)
const APP_DIR = new URL('..', import.meta.url).pathname
const PROFILE = 'proto-shots'

rmSync(join(homedir(), '.config', `resenha-${PROFILE}`), { recursive: true, force: true })
const app = await electron.launch({
  executablePath: electronPath,
  args: [APP_DIR],
  env: { ...process.env, RESENHA_PROFILE: PROFILE, RESENHA_HIDDEN: '1' },
})
const page = await app.firstWindow()
page.on('pageerror', (err) => console.log(`   pageerror: ${err.message}`))
page.on('console', (msg) => msg.type() === 'error' && console.log(`   console: ${msg.text()}`))

async function shot(name) {
  await page.waitForTimeout(450)
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  )
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(png, 'base64'))
}

// Entra no modo protótipo (a âncora não recarrega a página nem passa pelo will-navigate).
// Sem /clean aparece o seletor de telas: serve pra conferir que a lista abaixo está completa.
await page.evaluate(() => (location.hash = '#proto/server'))
await page.waitForSelector('.proto', { timeout: 10_000 })
await page.locator('.picker').click({ force: true })
const ids = await page.evaluate(() => [...document.querySelectorAll('[role=menu] button[role=menuitem]')].length)
await page.keyboard.press('Escape')

const ALL = [
  'server', 'server-reply', 'profile', 'pins', 'search', 'switcher', 'server-menu', 'menus', 'status',
  'home', 'home-pending', 'home-add', 'dm', 'create-server', 'create-server-form', 'join-server',
  'server-settings', 'server-roles', 'server-members', 'server-invites', 'server-bans', 'server-audit',
  'account', 'account-devices', 'account-password', 'account-privacy', 'profile-style', 'kit', 'update',
]
if (ids !== ALL.length) console.log(`   aviso: o seletor tem ${ids} telas e o script conhece ${ALL.length}`)

const size = (width, height) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [width, height])

let n = 0
for (const id of only.length ? only : ALL) {
  // As galerias são compridas: captura inteira numa janela alta.
  const tall = id === 'kit' || id === 'profile-style'
  if (tall) await size(1280, id === 'kit' ? 2000 : 1900)
  await page.evaluate((hash) => (location.hash = hash), `#proto/${id}/clean`)
  await shot(`${String(++n).padStart(2, '0')}-${id}`)
  if (tall) await size(1280, 820)
  console.log(`✔ ${id}`)
}

if (process.env.PROTO_SMALL === '1') {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(940, 560))
  for (const id of ['server', 'home', 'server-roles', 'account']) {
    await page.evaluate((hash) => (location.hash = hash), `#proto/${id}/clean`)
    await shot(`small-${id}`)
    console.log(`✔ ${id} (janela mínima)`)
  }
}

await app.close()
console.log(`\nCapturas em ${OUT}`)
