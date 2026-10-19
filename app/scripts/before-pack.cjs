// Roda antes de o electron-builder juntar o node_modules do pacote (`beforePack`).
//
// O dbus-next lista o `usocket` como dependência opcional. Ele só serve pra socket abstrato do
// D-Bus (a sessão de hoje é por caminho, e aí o dbus-next cai sozinho no `net` do Node) e precisa
// ser compilado: o build do GitHub instala sem scripts, então ele nunca carrega. Mesmo assim, ia
// pro pacote com o que ele arrasta (node-gyp, request, tar…, uns 5 MB de código morto). Sem a
// pasta dele, o electron-builder nem vê essa árvore. Compilado (alguém rodou o build dele), fica.

const { existsSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

function compiled(dir) {
  const release = join(dir, 'build', 'Release')
  return existsSync(release) && readdirSync(release).some((file) => file.endsWith('.node'))
}

exports.default = async function beforePack() {
  for (const root of [join(__dirname, '..'), join(__dirname, '..', '..')]) {
    const dir = join(root, 'node_modules', 'usocket')
    if (existsSync(dir) && !compiled(dir)) {
      rmSync(dir, { recursive: true, force: true })
      console.log(`  • usocket sem compilar fora do pacote: ${dir}`)
    }
  }
}
